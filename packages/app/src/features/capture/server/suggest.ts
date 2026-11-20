// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { formatHints, isFormatId } from '#/lib/format-ids'
import { normalizeTerm } from '#/lib/normalize'
import type { Db } from '#/server/db/client'
import { categories } from '#/server/db/schema/notes'
import {
	EngineError,
	redactPrivate,
	type EngineNote,
	type SuggestInput,
} from '#/server/engines/contract'
import type { Router } from '#/server/engines/router'
import { suggestionFormat, type Suggestion } from '#/server/engines/suggestion'
import { log } from '#/server/log'

/* The server budget is p95 < 1.5 s (docs/principles.md). Leave room for history and the
 * categories query before the engine wait. */
export const suggestionWaitMs = 1200

const warningIntervalMs = 10 * 60 * 1000

interface CaptureNote {
	readonly text: string
	readonly context: string | null
	readonly url: string | null
	readonly isPrivate: boolean
}

interface HistoryEntry {
	readonly categoryId: number | null
	readonly meaning: string
}

interface Sense {
	readonly sense: string
	readonly categoryId: number
}

export interface CategorySuggestion {
	readonly categories: number[]
	readonly senses: Sense[]
	readonly language: string | null
	readonly source: 'history' | 'engine' | 'none'
	readonly pending: boolean
}

export interface SuggestRequest {
	readonly note: CaptureNote
	readonly history: readonly HistoryEntry[]
	readonly language: string
}

export interface Suggester {
	suggest: (db: Db, request: SuggestRequest) => Promise<CategorySuggestion>
}

interface SuggesterOptions {
	readonly router: Pick<Router, 'suggest'>
	readonly waitMs?: number
	readonly cacheSize?: number
}

type Input = SuggestInput<ReturnType<typeof suggestionFormat>['schema']>

type Call = Promise<Suggestion | null>

function empty(pending = false): CategorySuggestion {
	return { categories: [], senses: [], language: null, source: 'none', pending }
}

function distinctSenses(entries: readonly Sense[]): Sense[] {
	const senses = new Map<string, Sense>()

	for (const entry of entries) {
		if (entry.sense !== '' && !senses.has(entry.sense)) {
			senses.set(entry.sense, entry)
		}

		if (senses.size === 4) {
			break
		}
	}

	return [...senses.values()]
}

function fromHistory(
	history: readonly HistoryEntry[],
	current: ReadonlySet<number>,
): CategorySuggestion | null {
	const hits = history.flatMap(({ categoryId, meaning }) =>
		categoryId !== null && current.has(categoryId) ? [{ categoryId, sense: meaning }] : [],
	)

	if (hits.length === 0) {
		return null
	}

	const senses = distinctSenses(hits)

	return {
		categories: [...new Set(hits.map(({ categoryId }) => categoryId))].slice(0, 3),
		senses: senses.length >= 2 ? senses : [],
		language: null,
		source: 'history',
		pending: false,
	}
}

function fromEngine(db: Db, output: Suggestion): CategorySuggestion {
	// A category can be removed while the engine is answering.
	const rows = db.select({ id: categories.id }).from(categories).all()
	const current = new Set(rows.map(({ id }) => id))
	const ids = output.categories.map(Number).filter((id) => current.has(id))

	const senses = output.senses.map(({ sense, category }) => ({
		sense,
		categoryId: Number(category),
	}))

	return {
		categories: [...new Set(ids)].slice(0, 3),
		senses: distinctSenses(senses.filter(({ categoryId }) => current.has(categoryId))),
		language: output.language,
		source: 'engine',
		pending: false,
	}
}

function warnUnexpected(message: string, note: EngineNote, lastLogged: Map<string, number>): void {
	// A provider may echo a field from its input in the error message.
	const fields = [note.term, note.text, note.context, note.url]

	const echoesNote = fields.some(
		(field) => field !== null && field !== '' && message.includes(field),
	)

	const line = echoesNote ? 'Category suggestion failed' : message
	const now = Date.now()
	const cutoff = now - warningIntervalMs
	const previous = lastLogged.get(line)

	if (previous !== undefined && previous > cutoff) {
		return
	}

	for (const [warning, loggedAt] of lastLogged) {
		if (loggedAt <= cutoff) {
			lastLogged.delete(warning)
		}
	}

	lastLogged.set(line, now)
	log.warn(line)
}

const pending = Symbol('pending')

async function waitForAnswer(call: Call, waitMs: number) {
	const { promise, resolve } = Promise.withResolvers<typeof pending>()

	const timer = setTimeout(() => {
		resolve(pending)
	}, waitMs)

	try {
		return await Promise.race([call, promise])
	} finally {
		clearTimeout(timer)
	}
}

export function createSuggester({
	router,
	waitMs = suggestionWaitMs,
	cacheSize = 500,
}: SuggesterOptions): Suggester {
	const cache = new Map<string, Call>()
	const lastLogged = new Map<string, number>()

	async function run(input: Input): Call {
		try {
			const { output } = await router.suggest(input)

			return output
		} catch (error) {
			if (!(error instanceof EngineError)) {
				warnUnexpected(
					error instanceof Error ? error.message : 'Category suggestion failed',
					input.note,
					lastLogged,
				)
			}

			return null
		}
	}

	async function cachedAnswer(input: Input) {
		const { note, language, categories: choices } = redactPrivate(input)
		const key = JSON.stringify({ note, language, categories: choices })
		const cached = cache.get(key)

		const call =
			cached ??
			run(input).then((output) => {
				if (output === null && cache.get(key) === call) {
					cache.delete(key)
				}

				return output
			})

		cache.delete(key)
		cache.set(key, call)

		if (cache.size > cacheSize) {
			const oldest = cache.keys().next().value

			if (oldest !== undefined) {
				cache.delete(oldest)
			}
		}

		return waitForAnswer(call, waitMs)
	}

	return {
		async suggest(db, { note, history, language }) {
			const term = normalizeTerm(note.text)

			if (term === null) {
				return empty()
			}

			const rows = db
				.select({ id: categories.id, name: categories.name, format: categories.format })
				.from(categories)
				.orderBy(categories.position, categories.id)
				.all()

			const hit = fromHistory(history, new Set(rows.map(({ id }) => id)))

			if (hit !== null || rows.length === 0) {
				return hit ?? empty()
			}

			const text = note.text.trim()

			const choices = rows.map(({ id, name, format }) => ({
				id: String(id),
				name,
				hint: isFormatId(format) ? formatHints[format] : null,
			}))

			const answer = await cachedAnswer({
				task: 'suggest',
				note: { ...note, term, text: text === term ? null : text },
				language,
				categories: choices,
				output: suggestionFormat(choices.map(({ id }) => id)),
			})

			if (answer === pending) {
				return empty(true)
			}

			return answer === null ? empty() : fromEngine(db, answer)
		},
	}
}
