// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Starting and stopping the agent command's process, for `agent-cli.ts`: splitting the template into
 * words, and the timeout, abort and signals around one run. What the agent prints is read there.
 */
import { spawn } from 'bun'

import { EngineError } from './contract'
import { abortReason } from './runs'

/**
 * Splits a command into words as a shell would, with single and double quotes and nothing else: no
 * variables, escapes, pipes or redirections. A script can do those.
 */
export function splitWords(command: string): string[] {
	const words: string[] = []
	let word = ''
	let isInWord = false
	let quote: string | null = null

	for (const char of command) {
		if (quote !== null) {
			if (char === quote) {
				quote = null
			} else {
				word += char
			}
		} else if (char === "'" || char === '"') {
			quote = char
			isInWord = true
		} else if (/\s/u.test(char)) {
			if (isInWord) {
				words.push(word)
				word = ''
				isInWord = false
			}
		} else {
			word += char
			isInWord = true
		}
	}

	if (quote !== null) {
		throw new Error(`The agent command has an unclosed ${quote} quote`)
	}

	if (isInWord) {
		words.push(word)
	}

	return words
}

type StopSignal = 'SIGINT' | 'SIGTERM' | 'SIGKILL'

/**
 * Signals the process's whole group. The agent runs in a group of its own, so a wrapper script and
 * the agent it started stop together, which signalling the script alone would not do.
 */
function signalGroup(pid: number, signal: StopSignal) {
	try {
		// oxlint-disable-next-line no-undef -- process is a Bun global; docs/guidelines/runtime.md allows process.kill for a process group.
		process.kill(-pid, signal)
	} catch {
		// The group is gone already.
	}
}

export interface ProcessExit {
	readonly exitCode: number
	readonly stdout: string
	readonly stderr: string
}

export interface ProcessRun {
	readonly cmd: readonly string[]
	readonly cwd: string
	/** Written to the process's stdin, or `null` to give it none. */
	readonly stdin: string | null
	readonly timeoutMs: number
	readonly signal: AbortSignal | undefined
	/** How long the process gets after SIGINT, and again after SIGTERM, before the next signal. */
	readonly graceMs: number
}

/**
 * Runs a process to its exit and returns what it printed. On the timeout or an abort it sends its group
 * SIGINT, then SIGTERM and SIGKILL a grace period apart, and fails once the process is gone with
 * `timeout` or the abort reason, without waiting for output that a child may still hold open.
 */
export async function runProcess({
	cmd,
	cwd,
	stdin,
	timeoutMs,
	signal,
	graceMs,
}: ProcessRun): Promise<ProcessExit> {
	signal?.throwIfAborted()

	const agent = spawn({
		cmd: [...cmd],
		cwd,
		detached: true,
		stdin: stdin === null ? 'ignore' : new Blob([stdin]),
		stdout: 'pipe',
		stderr: 'pipe',
	})

	const { promise: stopped, reject: stopWith } = Promise.withResolvers<never>()
	const escalations: ReturnType<typeof setTimeout>[] = []

	function escalate() {
		signalGroup(agent.pid, 'SIGTERM')
		escalations.push(
			setTimeout(() => {
				signalGroup(agent.pid, 'SIGKILL')
			}, graceMs),
		)
	}

	// Runs at most once: each way in removes the other.
	function stop(reason: Error) {
		clearTimeout(timeout)
		signal?.removeEventListener('abort', onAbort)
		signalGroup(agent.pid, 'SIGINT')
		escalations.push(setTimeout(escalate, graceMs))
		stopWith(reason)
	}

	function onAbort() {
		if (signal !== undefined) {
			stop(abortReason(signal))
		}
	}

	const timeout = setTimeout(() => {
		const message = `The agent command did not answer within ${timeoutMs} ms`

		stop(new EngineError({ kind: 'timeout', afterMs: timeoutMs }, message))
	}, timeoutMs)

	signal?.addEventListener('abort', onAbort, { once: true })

	const output = Promise.all([
		new Response(agent.stdout).text(),
		new Response(agent.stderr).text(),
		agent.exited,
	])

	try {
		const [stdout, stderr, exitCode] = await Promise.race([output, stopped])

		return { exitCode, stdout, stderr }
	} finally {
		clearTimeout(timeout)
		signal?.removeEventListener('abort', onAbort)
		// After a stop, the signals keep going until the process is gone, so the next run starts clean.
		await agent.exited

		// Whatever the stopped process left behind in its group goes with it.
		if (escalations.length > 0) {
			signalGroup(agent.pid, 'SIGKILL')
		}

		for (const escalation of escalations) {
			clearTimeout(escalation)
		}
	}
}
