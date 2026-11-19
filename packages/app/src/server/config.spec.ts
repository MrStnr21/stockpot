// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { argv, env, spawn } from 'bun'
import { beforeAll, describe, expect, it } from 'bun:test'
import { join, resolve } from 'node:path'

import { ConfigError, parseConfig } from './config'

const appFolder = join(import.meta.dir, '../..')

/** The message parsing fails with, or '' when it succeeds. */
function failureOf(source: Record<string, string>) {
	try {
		parseConfig(source)

		return ''
	} catch (error) {
		return error instanceof ConfigError ? error.message : `not a ConfigError: ${String(error)}`
	}
}

describe('parseConfig', () => {
	describe('with nothing set', () => {
		it('falls back to the defaults', () => {
			expect(parseConfig({})).toEqual({
				dataDir: resolve('data'),
				port: 4321,
				publicOrigin: 'http://localhost:4321',
				sourceUrl: 'https://github.com/MrStnr21/stockpot',
				agentCommand: null,
			})
		})

		it('treats empty variables as unset', () => {
			expect(parseConfig({ PORT: '', STOCKPOT_PUBLIC_ORIGIN: ' ' })).toMatchObject({
				port: 4321,
				publicOrigin: 'http://localhost:4321',
			})
		})
	})

	describe('with every variable set', () => {
		it('reads each one', () => {
			const config = parseConfig({
				STOCKPOT_DATA_DIR: '/var/lib/stockpot',
				PORT: '8080',
				STOCKPOT_PUBLIC_ORIGIN: 'https://stockpot.example.com/',
				STOCKPOT_SOURCE_URL: 'https://example.com/stockpot-fork',
				STOCKPOT_AGENT_COMMAND: 'agent --print --tier {tier}',
			})

			expect(config).toEqual({
				dataDir: '/var/lib/stockpot',
				port: 8080,
				publicOrigin: 'https://stockpot.example.com',
				sourceUrl: 'https://example.com/stockpot-fork',
				agentCommand: 'agent --print --tier {tier}',
			})
		})

		it('defaults the public origin to the port', () => {
			expect(parseConfig({ PORT: '8080' }).publicOrigin).toBe('http://localhost:8080')
		})
	})

	describe('with an invalid variable', () => {
		it.each([
			['PORT', 'abc'],
			['PORT', '0'],
			['PORT', '70000'],
			['STOCKPOT_PUBLIC_ORIGIN', 'stockpot.example.com'],
			['STOCKPOT_PUBLIC_ORIGIN', 'https://stockpot.example.com/app'],
			['STOCKPOT_PUBLIC_ORIGIN', 'ftp://stockpot.example.com'],
			['STOCKPOT_SOURCE_URL', 'not a url'],
		])('names %s=%s in the message', (name, value) => {
			const message = failureOf({ [name]: value })

			expect(message).toStartWith('stockpot cannot start: invalid environment.')
			expect(message).toContain(`- ${name} must be`)
			expect(message).toContain(`got "${value}"`)
		})

		it('lists every invalid variable', () => {
			const message = failureOf({ PORT: 'abc', STOCKPOT_SOURCE_URL: 'nope' })

			expect(message.split('\n').slice(1)).toEqual([
				'- PORT must be a port number from 1 to 65535, got "abc"',
				'- STOCKPOT_SOURCE_URL must be an http or https URL, got "nope"',
			])
		})

		it('cuts a long value short', () => {
			const message = failureOf({ STOCKPOT_PUBLIC_ORIGIN: 'x'.repeat(100) })

			expect(message).toContain(`got "${'x'.repeat(40)}…"`)
			expect(message).not.toContain('x'.repeat(41))
		})
	})

	describe('when the server starts with an invalid environment', () => {
		let exitCode: number
		let stderr: string

		beforeAll(async () => {
			const child = spawn([argv[0] ?? 'bun', '-e', "import '#/server/config'"], {
				cwd: appFolder,
				env: { PATH: env.PATH, PORT: 'abc' },
				stdout: 'ignore',
				stderr: 'pipe',
			})

			stderr = await new Response(child.stderr).text()
			exitCode = await child.exited
		})

		it('stops the process', () => {
			expect(exitCode).toBe(1)
		})

		it('prints which variable is wrong', () => {
			expect(stderr).toContain('- PORT must be a port number from 1 to 65535, got "abc"')
		})
	})
})
