// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { env } from 'bun'
import { resolve } from 'node:path'
import * as v from 'valibot'

/*
 * The environment, validated once when the server starts: what an instance needs before it can
 * open its database or answer a request. Everything the owner changes in the app lives in settings
 * instead (src/features/settings/server.ts). The variables are listed in the README.
 */

export interface Config {
	/** Absolute path of the folder that holds the database. */
	readonly dataDir: string
	/** The port the server listens on; the Node adapter reads the same `PORT`. */
	readonly port: number
	/** The address the owner opens the app at, such as `https://stockpot.example.ts.net`. */
	readonly publicOrigin: string
	/** Where the source of this instance is published, as AGPL-3.0 section 13 asks. */
	readonly sourceUrl: string
	/**
	 * The command line that runs the owner's agent (the agent command engine), or `null` when that
	 * engine is not configured. It is set here and never in settings: a shell command that could be
	 * edited over HTTP would turn any stolen session into shell access on the owner's machine, and
	 * stockpot must withstand the open internet (D6). Clients only learn whether it is set.
	 */
	readonly agentCommand: string | null
}

const defaults = {
	STOCKPOT_DATA_DIR: 'data',
	PORT: '4321',
	STOCKPOT_SOURCE_URL: 'https://github.com/MrStnr21/stockpot',
}

function parseUrl(value: string) {
	return URL.canParse(value) ? new URL(value) : null
}

function isHttpUrl(url: URL | null) {
	return url !== null && (url.protocol === 'http:' || url.protocol === 'https:')
}

/** An origin: scheme, host and port, with nothing after them but an optional slash. */
function isOrigin(value: string) {
	const url = parseUrl(value)

	return (
		isHttpUrl(url) &&
		url?.pathname === '/' &&
		url.search === '' &&
		url.hash === '' &&
		url.username === '' &&
		url.password === ''
	)
}

const portMessage = 'must be a port number from 1 to 65535'

const port = v.pipe(
	v.string(),
	v.regex(/^\d+$/u, portMessage),
	v.transform(Number),
	v.minValue(1, portMessage),
	v.maxValue(65_535, portMessage),
)

const origin = v.pipe(
	v.string(),
	v.check(isOrigin, 'must be an http or https origin, such as https://stockpot.example.com'),
	v.transform((value) => new URL(value).origin),
)

const httpUrl = v.pipe(
	v.string(),
	v.check((value) => isHttpUrl(parseUrl(value)), 'must be an http or https URL'),
)

const variables = v.object({
	STOCKPOT_DATA_DIR: v.optional(v.string(), defaults.STOCKPOT_DATA_DIR),
	PORT: v.optional(port, defaults.PORT),
	STOCKPOT_PUBLIC_ORIGIN: v.optional(origin),
	STOCKPOT_SOURCE_URL: v.optional(httpUrl, defaults.STOCKPOT_SOURCE_URL),
	STOCKPOT_AGENT_COMMAND: v.optional(v.string()),
})

function toConfig(environment: v.InferOutput<typeof variables>): Config {
	return {
		dataDir: resolve(environment.STOCKPOT_DATA_DIR),
		port: environment.PORT,
		publicOrigin: environment.STOCKPOT_PUBLIC_ORIGIN ?? `http://localhost:${environment.PORT}`,
		sourceUrl: environment.STOCKPOT_SOURCE_URL,
		agentCommand: environment.STOCKPOT_AGENT_COMMAND ?? null,
	}
}

const environmentSchema = v.pipe(variables, v.transform(toConfig))

export class ConfigError extends Error {
	public override readonly name = 'ConfigError'
}

/** One line per invalid variable. Only the value's length is shown, in case a secret went into it. */
function describeIssue(issue: v.BaseIssue<unknown>) {
	const { length } = String(issue.input)

	return `- ${v.getDotPath(issue) ?? 'environment'} ${issue.message}, got ${length} characters`
}

/**
 * Validates the environment. Empty variables count as unset, as compose files often leave them.
 * Throws a `ConfigError` that names every invalid variable.
 */
export function parseConfig(source: Readonly<Record<string, string | undefined>>): Config {
	const environment = Object.fromEntries(
		Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''),
	)

	const result = v.safeParse(environmentSchema, environment)

	if (result.success) {
		return result.output
	}

	const lines = result.issues.map(describeIssue).join('\n')

	throw new ConfigError(`stockpot cannot start: invalid environment.\n${lines}`)
}

function loadConfig(): Config {
	try {
		return parseConfig(env)
	} catch (error) {
		if (error instanceof ConfigError) {
			// oxlint-disable-next-line no-console -- Startup stops before any logger exists, so the owner reads this on the console.
			console.error(error.message)
			// oxlint-disable-next-line no-undef -- process is a Bun global; docs/guidelines/runtime.md allows process.exit.
			process.exit(1)
		}

		throw error
	}
}

/** The validated environment. An invalid one stops the process with a message naming each variable. */
export const config: Config = loadConfig()
