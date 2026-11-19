// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $ } from 'bun'
import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { join } from 'node:path'

import { runProcess, splitWords, type ProcessExit, type ProcessRun } from './agent-process'

/** The error a run failed with; fails the test when it succeeds. */
async function errorOf(run: Promise<ProcessExit>): Promise<Error> {
	try {
		await run
	} catch (error) {
		if (error instanceof Error) {
			return error
		}

		throw error
	}

	throw new Error('Expected the run to fail')
}

/** Waits for the process to write its id. It polls with a process, as timers may be fake. */
async function pidIn(directory: string): Promise<number> {
	let pid = ''

	while (pid === '') {
		// oxlint-disable-next-line no-await-in-loop -- Each check waits for the one before it.
		const read = await $`cat ${join(directory, 'pid')}`.nothrow().quiet()

		pid = read.exitCode === 0 ? read.text().trim() : ''
	}

	return Number(pid)
}

async function isRunning(pid: number) {
	const probe = await $`kill -0 ${pid}`.nothrow().quiet()

	return probe.exitCode === 0
}

const hang = 'echo $$ > pid; exec sleep 30'

describe('agent-process', () => {
	describe('splitWords', () => {
		it('splits on whitespace and keeps quoted spaces', () => {
			expect(splitWords(`agent  --flag "two words" 'it''s' {schema_file}`)).toEqual([
				'agent',
				'--flag',
				'two words',
				'its',
				'{schema_file}',
			])
		})

		it('keeps an empty quoted word and leaves backslashes alone', () => {
			expect(splitWords(String.raw`agent '' C:\agents`)).toEqual([
				'agent',
				'',
				String.raw`C:\agents`,
			])
		})

		it('rejects an unclosed quote', () => {
			expect(() => splitWords(`agent "open`)).toThrow('unclosed " quote')
		})
	})

	describe('runProcess', () => {
		let cwd: string

		async function run(script: string, options: Partial<ProcessRun> = {}) {
			return runProcess({
				cmd: ['sh', '-c', script],
				cwd,
				stdin: null,
				timeoutMs: 10_000,
				signal: undefined,
				graceMs: 100,
				...options,
			})
		}

		beforeEach(async () => {
			const created = await $`mktemp -d`.text()

			cwd = created.trim()
		})

		afterEach(async () => {
			jest.useRealTimers()
			await $`rm -rf ${cwd}`
		})

		it('returns the exit status, stdout and stderr, with stdin delivered', async () => {
			const exit = await run('cat; echo warning >&2; exit 2', { stdin: 'the prompt' })

			expect(exit).toEqual({ exitCode: 2, stdout: 'the prompt', stderr: 'warning\n' })
		})

		describe('with a process that hangs', () => {
			let pid: number
			let error: Error

			beforeEach(async () => {
				jest.useFakeTimers()

				const running = run(hang, { timeoutMs: 3000 })

				pid = await pidIn(cwd)
				jest.advanceTimersByTime(3000)
				error = await errorOf(running)
			})

			it('fails with timeout once the process is gone', async () => {
				expect(error).toMatchObject({ failure: { kind: 'timeout', afterMs: 3000 } })
				expect(await isRunning(pid)).toBe(false)
			})
		})

		describe('with a process that ignores SIGINT', () => {
			let pid: number
			let error: Error

			beforeEach(async () => {
				jest.useFakeTimers()

				const running = run(`trap '' INT; ${hang}`, { timeoutMs: 3000 })

				pid = await pidIn(cwd)
				jest.advanceTimersByTime(3000)
				jest.advanceTimersByTime(100)
				error = await errorOf(running)
			})

			it('stops it with SIGTERM after the grace period', async () => {
				expect(error).toMatchObject({ failure: { kind: 'timeout' } })
				expect(await isRunning(pid)).toBe(false)
			})
		})

		describe('when the run is aborted', () => {
			const reason = new Error('The runner stopped')
			let pid: number
			let error: Error

			beforeEach(async () => {
				const controller = new AbortController()
				const running = run(hang, { signal: controller.signal })

				pid = await pidIn(cwd)
				controller.abort(reason)
				error = await errorOf(running)
			})

			it('fails with the abort reason once the process is gone', async () => {
				expect(error).toBe(reason)
				expect(await isRunning(pid)).toBe(false)
			})
		})

		describe('with a signal that already aborted', () => {
			let error: Error

			beforeEach(async () => {
				error = await errorOf(run('touch started', { signal: AbortSignal.abort() }))
			})

			it('fails without starting the process', async () => {
				const started = await $`test -e ${join(cwd, 'started')}`.nothrow()

				expect(error.name).toBe('AbortError')
				expect(started.exitCode).not.toBe(0)
			})
		})
	})
})
