// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Makes real Gemini calls through the engine and records Google's responses as the fixtures the
 * Gemini specs answer from (docs/engines.md, "The Gemini engine"). It costs the owner's quota, so it
 * runs by hand, with the key from an env file that never enters the repository:
 *
 *   bun --env-file <env file> tests/recordings/gemini.ts record    # the fixtures, 4 requests
 *   bun --env-file <env file> tests/recordings/gemini.ts latency   # 20 suggestions on the fast tier
 *
 * The key is replaced with `[key]` in everything this writes, and only response bodies are kept.
 */
import { argv, env, stdout, write } from 'bun'
import { join } from 'node:path'
import { createTestDb } from '#tests/setup/db'

import { cardFormat } from '#/features/research/shared/formats'
import { engineRuns } from '#/server/db/schema/jobs'
import { EngineError, redactPrivate, type EngineResult } from '#/server/engines/contract'
import { createGeminiEngine } from '#/server/engines/gemini'
import { defaultEngines } from '#/server/engines/settings'
import { suggestionFormat } from '#/server/engines/suggestion'

const fixtures = join(import.meta.dir, 'gemini')

const apiKey = env.GEMINI_API_KEY ?? ''

const mode = argv.at(2)

function redacted(text: string) {
	return apiKey === '' ? text : text.replaceAll(apiKey, '[key]')
}

async function say(line: string) {
	await write(stdout, `${redacted(line)}\n`)
}

if (apiKey === '' || (mode !== 'record' && mode !== 'latency')) {
	throw new Error('Usage: bun --env-file <env file> tests/recordings/gemini.ts record|latency')
}

/** Names the response of each request in turn; a request past the names is not kept. */
function recordingFetch(names: string[]): typeof fetch {
	async function recording(input: RequestInfo | URL, init?: RequestInit) {
		const response = await fetch(input, init)
		const name = names.shift()

		if (name !== undefined) {
			const body: unknown = await response.clone().json()
			const fixture = JSON.stringify({ status: response.status, body }, null, '\t')

			await write(join(fixtures, `${name}.json`), `${redacted(fixture)}\n`)
		}

		return response
	}

	return Object.assign(recording, { preconnect: fetch.preconnect })
}

const categories = [
	{ id: 'technology', name: 'Technology', hint: null },
	{ id: 'english', name: 'English', hint: 'Words and phrases to learn' },
	{ id: 'concept', name: 'Concept', hint: null },
]

function suggestInput(term: string) {
	const note = { term, text: null, context: null, url: null, isPrivate: false }
	const output = suggestionFormat(categories.map(({ id }) => id))

	return redactPrivate({ task: 'suggest', note, language: 'en', categories, output })
}

const cardInput = redactPrivate({
	task: 'explain',
	note: {
		term: 'webassembly',
		text: 'WebAssembly',
		context: null,
		url: 'https://webassembly.org/',
		isPrivate: false,
	},
	language: 'en',
	category: { name: 'Technology', instructions: null },
	depth: 1,
	previous: [],
	output: cardFormat('technology', 1),
})

const { db } = await createTestDb()

const { models, limits } = defaultEngines().gemini

function runRows() {
	return db.select().from(engineRuns).all()
}

function engineWith(key: string, names: string[]) {
	const fetch = recordingFetch(names)

	return createGeminiEngine({ db, settings: () => ({ apiKey: key, models, limits }), fetch })
}

function describe(result: EngineResult<unknown>) {
	const hasSuggestions = result.searchSuggestions !== null

	return `ok in ${result.elapsedMs} ms from ${result.model}, search suggestions: ${hasSuggestions}`
}

async function attempt(label: string, call: () => Promise<EngineResult<unknown>>) {
	try {
		await say(`${label}: ${describe(await call())}`)
	} catch (error) {
		const kind = error instanceof EngineError ? error.kind : 'error'

		await say(`${label}: ${kind}: ${error instanceof Error ? error.message : String(error)}`)
	}
}

if (mode === 'record') {
	const suggestOptions = { tier: 'fast', timeoutMs: 30_000 } as const
	const cardOptions = { tier: 'standard', timeoutMs: 180_000 } as const

	await attempt('suggest', async () =>
		engineWith(apiKey, ['suggest']).suggest(suggestInput('serendipity'), suggestOptions),
	)
	await attempt('explain', async () =>
		engineWith(apiKey, ['explain-facts', 'explain-card']).explain(cardInput, cardOptions),
	)
	await attempt('bad key', async () =>
		engineWith('not-a-real-key', ['bad-key']).suggest(suggestInput('quorum'), suggestOptions),
	)

	const runs = runRows().map(
		({ task, model, outcome, inputTokens, outputTokens, searches }) =>
			`run ${task} ${model} ${outcome}: ${inputTokens} in, ${outputTokens} out, ${searches} searches`,
	)

	await say(runs.join('\n'))
}

if (mode === 'latency') {
	const terms = [
		'kubernetes',
		'ephemeral',
		'idempotence',
		'serendipity',
		'rust',
		'backpressure',
		'zeitgeist',
		'monad',
		'sonder',
		'graphql',
		'entropy',
		'quorum',
		'ubiquitous',
		'webassembly',
		'hysteresis',
		'petrichor',
		'raft consensus',
		'memoization',
		'liminal',
		'sharding',
	]

	const engine = engineWith(apiKey, [])
	const times: number[] = []
	const lines: string[] = []

	for (const term of terms) {
		const started = performance.now()

		try {
			// oxlint-disable-next-line no-await-in-loop -- Latency is measured one call at a time.
			const result = await engine.suggest(suggestInput(term), { tier: 'fast', timeoutMs: 30_000 })

			times.push(result.elapsedMs)
			lines.push(`${term}: ${result.elapsedMs} ms from ${result.model}`)
		} catch (error) {
			// A failed run is reported, not retried: every run costs a request.
			const elapsed = Math.round(performance.now() - started)

			lines.push(
				`${term}: failed after ${elapsed} ms: ${error instanceof Error ? error.message : ''}`,
			)
		}
	}

	const sorted = times.toSorted((a, b) => a - b)

	// Nearest rank: the p95 of 20 runs is the 19th fastest.
	const [p50, p95] = [0.5, 0.95].map((share) => sorted[Math.ceil(share * sorted.length) - 1])

	await say(lines.join('\n'))
	await say(
		`${times.length} of ${terms.length} ok: p50 ${p50} ms, p95 ${p95} ms, max ${sorted.at(-1)} ms`,
	)
}
