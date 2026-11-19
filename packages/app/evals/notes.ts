// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The eval set (evals/README.md): public notes in `notes.jsonl`, plus any `local/*.jsonl` the owner
 * keeps out of the repository. A local line either adds a whole note or, with only an id and some of
 * `context` and `url`, adds private details to a public note, so a note's term can be public while
 * what the owner wrote about it stays on their machine.
 */
import { file, Glob } from 'bun'
import { basename, join } from 'node:path'
import * as v from 'valibot'

import { formatIds, type FormatId } from '#/lib/format-ids'

const nonEmpty = v.pipe(v.string(), v.nonEmpty())

const noteId = v.pipe(v.string(), v.regex(/^[a-z\d]+(?:-[a-z\d]+)*$/u, 'Use a kebab-case id'))

const optionalText = v.nullable(v.pipe(v.string(), v.nonEmpty(), v.maxLength(1000)))

const httpUrl = v.nullable(v.pipe(v.string(), v.url(), v.regex(/^https?:\/\//u)))

const format = v.picklist(formatIds)

const formatList = v.array(format)

const senseList = v.array(nonEmpty)

/** What a good answer looks like for the note. */
const expectedSchema = v.strictObject({
	/** The format of the built-in category the note belongs to. */
	format,
	/** Other formats that are a fair choice too, for a note between two categories. */
	alsoAccept: v.optional(formatList, []),
	/** For an ambiguous term: the meaning the card should explain. */
	sense: v.optional(nonEmpty),
	/** For an ambiguous term: the meanings a suggestion should list. */
	senses: v.optional(senseList, []),
	/** The note is composed to be unknowable, so the card must say it is uncertain. */
	uncertain: v.optional(v.boolean(), false),
})

export const evalNoteSchema = v.strictObject({
	id: noteId,
	/** The note as typed, recorded exactly as given, typos included. */
	text: v.pipe(v.string(), v.nonEmpty(), v.maxLength(500)),
	context: optionalText,
	url: httpUrl,
	private: v.boolean(),
	/** The ISO 639-1 code of the language the note is written in. */
	language: v.pipe(v.string(), v.regex(/^[a-z]{2}$/u, 'Use an ISO 639-1 code')),
	/** `owner` for the owner's real notes, `composed` for every note written for the set. */
	source: v.picklist(['owner', 'composed']),
	expected: expectedSchema,
	/** What the note tests, for whoever reads the report. */
	tests: nonEmpty,
})

export type EvalNote = v.InferOutput<typeof evalNoteSchema>

/** A note as the loader returns it: `local` when any of it came from a local file. */
export type LoadedNote = EvalNote & { readonly local: boolean }

const localAdditionSchema = v.strictObject({
	id: noteId,
	context: v.optional(optionalText),
	url: v.optional(httpUrl),
})

type LocalAddition = v.InferOutput<typeof localAdditionSchema>

const localLineSchema = v.union([evalNoteSchema, localAdditionSchema])

function describeIssues(issues: readonly v.BaseIssue<unknown>[]): string {
	return issues
		.map((issue) => {
			const path = v.getDotPath(issue)

			return path === null ? issue.message : `${path}: ${issue.message}`
		})
		.join('; ')
}

function parseLine<TSchema extends v.GenericSchema>(
	line: string,
	schema: TSchema,
	where: string,
): v.InferOutput<TSchema> {
	const result = v.safeParse(v.pipe(v.string(), v.parseJson(), schema), line)

	if (!result.success) {
		throw new Error(`${where}: ${describeIssues(result.issues)}`)
	}

	return result.output
}

function parseLines<TSchema extends v.GenericSchema>(
	text: string,
	schema: TSchema,
	name: string,
): v.InferOutput<TSchema>[] {
	return text.split('\n').flatMap((line, index) => {
		if (line.trim() === '') {
			return []
		}

		return [parseLine(line, schema, `${name}:${index + 1}`)]
	})
}

/** Parses the lines of the public file; every line must be a whole note. */
export function parseNotes(text: string, name: string): EvalNote[] {
	return parseLines(text, evalNoteSchema, name)
}

/**
 * Merges local lines into the public notes: an addition fills in its note's private details, a
 * whole note joins the set. An id may appear only once as a whole note.
 */
export function mergeLocal(
	notes: readonly EvalNote[],
	local: readonly (EvalNote | LocalAddition)[],
): LoadedNote[] {
	const byId = new Map<string, LoadedNote>()

	for (const note of notes) {
		if (byId.has(note.id)) {
			throw new Error(`The note "${note.id}" is listed twice`)
		}

		byId.set(note.id, { ...note, local: false })
	}

	for (const line of local) {
		const existing = byId.get(line.id)

		if ('text' in line) {
			if (existing !== undefined) {
				throw new Error(`The note "${line.id}" is listed twice`)
			}

			byId.set(line.id, { ...line, local: true })
		} else {
			if (existing === undefined) {
				throw new Error(`The local addition "${line.id}" names no public note`)
			}

			// Details kept out of the repository belong to a private note, or they would reach an engine.
			if (!existing.private) {
				throw new Error(`The local addition "${line.id}" is for a note that is not private`)
			}

			byId.set(line.id, {
				...existing,
				context: line.context ?? existing.context,
				url: line.url ?? existing.url,
				local: true,
			})
		}
	}

	return [...byId.values()]
}

async function readLocal(localDir: string): Promise<(EvalNote | LocalAddition)[]> {
	try {
		const names = await Array.fromAsync(
			new Glob('*.jsonl').scan({ cwd: localDir, onlyFiles: true }),
		)

		const files = await Promise.all(
			names.toSorted().map(async (name) => ({
				name,
				text: await file(join(localDir, name)).text(),
			})),
		)

		return files.flatMap(({ name, text }) => parseLines(text, localLineSchema, name))
	} catch (error) {
		// No local folder is the usual case outside the owner's machine.
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
			return []
		}

		throw error
	}
}

export interface LoadNotesOptions {
	/** The public file, `evals/notes.jsonl` unless `--notes` names another. */
	readonly publicFile: string
	/** The folder of local notes; a missing folder adds nothing. */
	readonly localDir: string
}

export async function loadNotes({ publicFile, localDir }: LoadNotesOptions): Promise<LoadedNote[]> {
	const notes = parseNotes(await file(publicFile).text(), basename(publicFile))

	return mergeLocal(notes, await readLocal(localDir))
}

/**
 * The order a run takes notes in: one note of each format in turn, local notes first within a
 * format, so a run cut short by `--limit` still samples every format and the owner's own notes.
 */
export function sampleOrder(notes: readonly LoadedNote[]): LoadedNote[] {
	const groups = formatIds.map((id: FormatId) => {
		const group = notes.filter((note) => note.expected.format === id)

		// A stable sort: local notes first, each side in file order.
		return group.toSorted((a, b) => Number(b.local) - Number(a.local))
	})

	const rounds = Math.max(0, ...groups.map((group) => group.length))

	return Array.from({ length: rounds }, (_, round) =>
		groups.flatMap((group) => group.slice(round, round + 1)),
	).flat()
}
