// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $, file, write } from 'bun'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from 'bun:test'
import { dirname, join } from 'node:path'
import { suggestInputFactory } from '#tests/factories/engine-input'
import { jobRowFactory } from '#tests/factories/jobs'
import { createTestDb, type TestDb } from '#tests/setup/db'

import { engineRuns } from '#/server/db/schema/jobs'

import { createAgentCommandEngine, parseCommandTemplate } from './agent-cli'
import { EngineError, redactPrivate, type Engine, type EngineResult } from './contract'

const answer = { categories: ['technology'], senses: [], language: 'en' }

const printAnswer = `printf '%s' '${JSON.stringify(answer)}'`

const wrapped = {
	structured_output: answer,
	model: 'model-a',
	usage: { input_tokens: 1200, output_tokens: 300, searches: 2, cost_usd: 0.004 },
}

/* Fake agents. Each takes the spec's output folder as its first argument, then whatever the template
 * passes, and writes what the test checks there. */
const fakeAgents = {
	'inspect.sh': `cp "$2" "$1/schema.json"
printf '%s' "$3" > "$1/tier"
pwd > "$1/cwd"
ls -A > "$1/listing"
cat > "$1/stdin"
${printAnswer}`,
	'prompt-file.sh': `cp "$2" "$1/prompt"
cat > "$1/stdin"
${printAnswer}`,
	'wrapped.sh': `printf '%s' '${JSON.stringify(wrapped)}'`,
	'not-json.sh': `printf 'Thinking about it...'`,
	'wrong-shape.sh': `printf '%s' '{"categories":[],"senses":[],"language":"en"}'`,
	'limit.sh': `printf '%s' '{"error":{"kind":"rate_limited","resets_at":"2026-11-19T15:00:00Z"}}'; exit 1`,
	'limit-no-reset.sh': `printf '%s' '{"error":{"kind":"rate_limited"}}'; exit 1`,
	'login.sh': `printf '%s' '{"error":{"kind":"auth"}}'; exit 1`,
	'crash.sh': `pwd > "$1/cwd"; echo 'out of memory' >&2; exit 3`,
	'hang.sh': `pwd > "$1/cwd"; echo $$ > "$1/pid"; exec sleep 30`,
	'slow.sh': `echo start >> "$1/log"; sleep 0.1; echo end >> "$1/log"; ${printAnswer}`,
}

type FakeAgent = keyof typeof fakeAgents

const options = { tier: 'fast', timeoutMs: 10_000 } as const

async function temporaryDirectory() {
	const created = await $`mktemp -d`.text()

	return created.trim()
}

/** The error a call failed with; fails the test when the call succeeds. */
async function errorOf<T>(call: Promise<T>): Promise<Error> {
	try {
		await call
	} catch (error) {
		if (error instanceof Error) {
			return error
		}

		throw error
	}

	throw new Error('Expected the call to fail')
}

describe('agent-cli', () => {
	describe('parseCommandTemplate', () => {
		it('rejects an empty command', () => {
			expect(() => parseCommandTemplate('   ')).toThrow('The agent command is empty')
		})
	})

	describe('createAgentCommandEngine', () => {
		const input = redactPrivate(suggestInputFactory.build())
		let agents: string
		let out: string
		let db: TestDb

		function engineWith(agent: FakeAgent, placeholders = '{schema_file} {tier}'): Engine {
			// Through sh rather than run directly: macOS scans each new executable on its first run.
			const command = `sh '${join(agents, agent)}' '${out}' ${placeholders}`

			return createAgentCommandEngine({ command, db, graceMs: 100 })
		}

		function runRows() {
			return db.select().from(engineRuns).all()
		}

		/** Whether the run's temporary directory, the parent of its working directory, is still there. */
		async function isRunDirectoryLeft() {
			const cwd = await file(join(out, 'cwd')).text()
			const probe = await $`test -e ${dirname(cwd.trim())}`.nothrow()

			return probe.exitCode === 0
		}

		/** Waits for the fake agent to write its pid, polling with a process as timers may be fake. */
		async function untilStarted() {
			let pid = ''

			while (pid === '') {
				// oxlint-disable-next-line no-await-in-loop -- Each check waits for the one before it.
				const read = await $`cat ${join(out, 'pid')}`.nothrow().quiet()

				pid = read.exitCode === 0 ? read.text().trim() : ''
			}
		}

		beforeAll(async () => {
			agents = await temporaryDirectory()

			await Promise.all(
				Object.entries(fakeAgents).map(async ([name, body]) =>
					write(join(agents, name), `${body}\n`),
				),
			)
		})

		beforeEach(async () => {
			out = await temporaryDirectory()
			;({ db } = await createTestDb())
		})

		afterEach(async () => {
			jest.useRealTimers()
			await $`rm -rf ${out}`
		})

		afterAll(async () => {
			await $`rm -rf ${agents}`
		})

		describe('with an agent that answers', () => {
			let result: EngineResult<unknown>

			beforeEach(async () => {
				result = await engineWith('inspect.sh').suggest(input, options)
			})

			it('returns the validated answer and records the run', () => {
				expect(result).toMatchObject({ output: answer, engine: 'agent-command', model: null })
				expect(runRows()).toMatchObject([
					{ engine: 'agent-command', task: 'suggest', outcome: 'ok', jobId: null },
				])
			})

			it('passes the schema file, the tier and the prompt on stdin', async () => {
				expect(await file(join(out, 'schema.json')).json()).toEqual(input.output.jsonSchema)
				expect(await file(join(out, 'tier')).text()).toBe('fast')
				expect(await file(join(out, 'stdin')).text()).toContain(`Term: ${input.note.term}`)
			})

			it('runs in an empty working directory and removes it afterwards', async () => {
				expect(await file(join(out, 'listing')).text()).toBe('')
				expect(await isRunDirectoryLeft()).toBe(false)
			})
		})

		describe('with the prompt in a file', () => {
			beforeEach(async () => {
				await engineWith('prompt-file.sh', '{prompt_file}').suggest(input, options)
			})

			it('passes the prompt as a file instead of on stdin', async () => {
				expect(await file(join(out, 'prompt')).text()).toContain(`Term: ${input.note.term}`)
				expect(await file(join(out, 'stdin')).text()).toBe('')
			})
		})

		describe('with an answer wrapped in structured_output', () => {
			let result: EngineResult<unknown>

			beforeEach(async () => {
				result = await engineWith('wrapped.sh').suggest(input, options)
			})

			it('returns the wrapped answer and records the reported model and usage', () => {
				expect(result).toMatchObject({ output: answer, model: 'model-a' })
				expect(runRows()).toMatchObject([
					{ model: 'model-a', inputTokens: 1200, outputTokens: 300, searches: 2, costUsd: 0.004 },
				])
			})
		})

		it.each([
			['not-json.sh', { kind: 'invalid', issues: ['The answer is not JSON'] }],
			['wrong-shape.sh', { kind: 'invalid', issues: [expect.stringContaining('categories')] }],
			['limit.sh', { kind: 'rate_limited', resetsAt: new Date('2026-11-19T15:00:00Z') }],
			['login.sh', { kind: 'auth' }],
		] as const)('maps %s to its failure and records it', async (agent, failure) => {
			const error = await errorOf(engineWith(agent).suggest(input, options))

			expect(error).toBeInstanceOf(EngineError)
			expect(error).toMatchObject({ failure })
			expect(runRows()).toMatchObject([{ outcome: failure.kind }])
		})

		it('assumes a limit without a reset time resets in an hour', async () => {
			jest.useFakeTimers({ now: new Date('2026-11-19T12:00:00Z') })

			const error = await errorOf(engineWith('limit-no-reset.sh').suggest(input, options))

			expect(error).toMatchObject({
				failure: { kind: 'rate_limited', resetsAt: new Date('2026-11-19T13:00:00Z') },
			})
		})

		it('fails a crash with an ordinary error that carries the status and stderr', async () => {
			const error = await errorOf(engineWith('crash.sh').suggest(input, options))

			expect(error).not.toBeInstanceOf(EngineError)
			expect(error.message).toBe('The agent command exited with status 3: out of memory')
			expect(runRows()).toMatchObject([{ outcome: 'error' }])
			expect(await isRunDirectoryLeft()).toBe(false)
		})

		describe('with an agent that hangs', () => {
			let error: Error

			beforeEach(async () => {
				jest.useFakeTimers()

				const call = engineWith('hang.sh').suggest(input, { tier: 'fast', timeoutMs: 3000 })

				await untilStarted()
				jest.advanceTimersByTime(3000)
				error = await errorOf(call)
			})

			it('fails with timeout, records it and removes the run directory', async () => {
				expect(error).toMatchObject({ failure: { kind: 'timeout', afterMs: 3000 } })
				expect(runRows()).toMatchObject([{ outcome: 'timeout', durationMs: 3000 }])
				expect(await isRunDirectoryLeft()).toBe(false)
			})
		})

		describe('when the call is aborted', () => {
			const reason = new Error('The runner stopped')
			let error: Error

			beforeEach(async () => {
				const controller = new AbortController()
				const call = engineWith('hang.sh').suggest(input, { ...options, signal: controller.signal })

				await untilStarted()
				controller.abort(reason)
				error = await errorOf(call)
			})

			it('fails with the reason, records it and removes the run directory', async () => {
				expect(error).toBe(reason)
				expect(runRows()).toMatchObject([{ outcome: 'error' }])
				expect(await isRunDirectoryLeft()).toBe(false)
			})
		})

		describe('with two calls at once', () => {
			beforeEach(async () => {
				const engine = engineWith('slow.sh')

				await Promise.all([engine.suggest(input, options), engine.suggest(input, options)])
			})

			it('runs them one at a time and records each', async () => {
				expect(await file(join(out, 'log')).text()).toBe('start\nend\nstart\nend\n')
				expect(runRows()).toMatchObject([{ outcome: 'ok' }, { outcome: 'ok' }])
			})
		})

		describe('within a job', () => {
			let jobId: number

			beforeEach(async () => {
				const job = await jobRowFactory.transient({ db }).create()

				;({ id: jobId } = job)
				await engineWith('inspect.sh').suggest(input, { ...options, jobId })
			})

			it('records the job with the run', () => {
				expect(runRows()).toMatchObject([{ jobId }])
			})
		})
	})
})
