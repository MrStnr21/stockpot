// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The server log: one JSON object per line, `info` on stdout and `warn` and `error` on stderr, so a
 * container runtime or `jq` can read it. Each line holds `level`, `time`, `message` and the fields the
 * caller passed. A field whose name looks like a secret is written as `[redacted]` at any depth, so a
 * key, a token or a cookie that ends up in an object never reaches the log.
 */
import { inspect, stderr, stdout, write } from 'bun'

export type Level = 'info' | 'warn' | 'error'

/** What a field may hold. A caught `unknown` becomes an `Error` or a string where it is caught. */
export type FieldValue =
	string | number | boolean | null | undefined | Date | Error | readonly FieldValue[] | Fields

export interface Fields {
	readonly [name: string]: FieldValue
}

export interface Logger {
	info: (message: string, fields?: Fields) => void
	warn: (message: string, fields?: Fields) => void
	error: (message: string, fields?: Fields) => void
}

/** Where a finished line goes; specs pass their own. */
export type Sink = (level: Level, line: string) => void

// Wide on purpose: a field redacted by mistake costs less than a secret in the log.
const secretName = /pass|secret|token|key|auth|cookie|session|credential/iu

export const redacted = '[redacted]'

/** An error as plain data: JSON.stringify would write `{}` for it. */
function describeError(error: Error): Fields {
	const { cause } = error

	return {
		name: error.name,
		message: error.message,
		stack: error.stack,
		...(cause !== undefined && { cause: cause instanceof Error ? cause : inspect(cause) }),
	}
}

/* JSON.stringify calls this for every property at every depth, the properties of what it returns
 * included, so an error's cause is described and redacted the same way. */
function replace(key: string, value: FieldValue): FieldValue {
	if (secretName.test(key)) {
		return redacted
	}

	return value instanceof Error ? describeError(value) : value
}

function serialize(level: Level, message: string, fields: Fields) {
	const time = new Date().toISOString()
	const head = { level, time, message }

	try {
		// The head is spread again after the fields, so a field named `level` cannot replace it.
		return JSON.stringify({ ...head, ...fields, ...head }, replace)
	} catch {
		// A cycle in the fields: the line keeps its message.
		return JSON.stringify({ ...head, fields: '[unserializable]' })
	}
}

function writeToStreams(level: Level, line: string) {
	// A closed stream, such as a pipe whose reader has gone, has nobody left to tell.
	write(level === 'info' ? stdout : stderr, `${line}\n`).catch(() => null)
}

export function createLogger(sink: Sink = writeToStreams): Logger {
	function logAt(level: Level) {
		return (message: string, fields: Fields = {}) => {
			sink(level, serialize(level, message, fields))
		}
	}

	return { info: logAt('info'), warn: logAt('warn'), error: logAt('error') }
}

/** The log of this process. Specs replace its methods with `spyOn(log, 'error')`. */
export const log: Logger = createLogger()
