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

/* An answer is a few kilobytes of JSON; a process that prints more than this is runaway, and reading it
 * all would hold it in memory. Only the end of stderr is kept, for the error message. */
export const stdoutCapBytes = 1024 * 1024

const stderrTailChars = 8192

/** Reads a stream to its end as text, or returns `null` (and cancels it) past `capBytes`. */
async function readCapped(
	stream: ReadableStream<Uint8Array>,
	capBytes: number,
): Promise<string | null> {
	const decoder = new TextDecoder()
	let text = ''
	let bytes = 0

	for await (const chunk of stream) {
		bytes += chunk.byteLength

		if (bytes > capBytes) {
			return null
		}

		text += decoder.decode(chunk, { stream: true })
	}

	return text + decoder.decode()
}

/** Reads a stream to its end, keeping only its last `maxChars` characters. */
async function readTail(stream: ReadableStream<Uint8Array>, maxChars: number): Promise<string> {
	const decoder = new TextDecoder()
	let tail = ''

	for await (const chunk of stream) {
		tail = (tail + decoder.decode(chunk, { stream: true })).slice(-maxChars)
	}

	return (tail + decoder.decode()).slice(-maxChars)
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
	/** The last 8 KB or so of stderr. */
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
 * Runs a process to its exit and returns what it printed. On the timeout, an abort or stdout past
 * `stdoutCapBytes` it sends its group SIGINT, then SIGTERM and SIGKILL a grace period apart, and fails
 * once the process is gone with `timeout`, the abort reason or `invalid`, without waiting for output
 * that a child may still hold open.
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

	function stop(reason: Error) {
		// A stop starts the escalation, so a second way in finds it started and leaves it be.
		if (escalations.length > 0) {
			return
		}

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

	async function readStdout() {
		const text = await readCapped(agent.stdout, stdoutCapBytes)

		if (text === null) {
			const issue = `The agent printed more than ${stdoutCapBytes} bytes`

			stop(new EngineError({ kind: 'invalid', issues: [issue] }, issue))
		}

		return text ?? ''
	}

	const output = Promise.all([readStdout(), readTail(agent.stderr, stderrTailChars), agent.exited])

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
