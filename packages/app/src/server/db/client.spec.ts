// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $, Glob, write } from 'bun'
import { Database } from 'bun:sqlite'
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	spyOn,
	type Mock,
} from 'bun:test'
import { join } from 'node:path'
import { migrationsFolder } from '#tests/setup/db'

import { openDatabase } from './client'

async function temporaryDirectory() {
	const created = await $`mktemp -d`.text()

	return created.trim()
}

/** The message an opening fails with, or '' when it succeeds. */
async function failureOf(opening: Promise<unknown>) {
	try {
		await opening
	} catch (error) {
		return error instanceof Error ? error.message : 'a value that is not an Error'
	}

	return ''
}

describe('openDatabase', () => {
	describe('with a file that does not exist yet', () => {
		let directory: string
		let path: string
		let sqlite: Database

		beforeAll(async () => {
			directory = await temporaryDirectory()
			path = join(directory, 'stockpot.db')
			;({ sqlite } = await openDatabase({ path, migrationsFolder }))
		})

		afterAll(async () => {
			sqlite.close()
			await $`rm -rf ${directory}`
		})

		it('creates the file in write-ahead log mode', () => {
			expect(sqlite.query('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
		})

		it('enforces foreign keys', () => {
			expect(sqlite.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
		})

		it('waits for a locked database instead of failing at once', () => {
			expect(sqlite.query('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 })
		})

		it('applies each migration once when the file is opened again', async () => {
			const migrated = 'SELECT name FROM __drizzle_migrations ORDER BY id'
			const before = sqlite.query(migrated).all()

			sqlite.close()
			;({ sqlite } = await openDatabase({ path, migrationsFolder }))

			expect(sqlite.query(migrated).all()).toEqual(before)
		})
	})

	describe('with nothing pending', () => {
		let directory: string
		let path: string
		let run: Mock<Database['run']>

		beforeEach(async () => {
			directory = await temporaryDirectory()
			path = join(directory, 'stockpot.db')

			const { sqlite } = await openDatabase({ path, migrationsFolder })

			sqlite.close()
			run = spyOn(Database.prototype, 'run')
		})

		afterEach(async () => {
			run.mockRestore()
			await $`rm -rf ${directory}`
		})

		it('takes no backup', async () => {
			const { sqlite } = await openDatabase({ path, migrationsFolder })

			sqlite.close()

			expect(run.mock.calls.map(([query]) => query)).not.toContain('VACUUM INTO ?')
		})
	})

	describe('with a migration that leaves an orphan row', () => {
		let directory: string
		let path: string
		let orphanFolder: string

		beforeEach(async () => {
			directory = await temporaryDirectory()
			path = join(directory, 'stockpot.db')
			orphanFolder = join(directory, 'migrations')
			await $`cp -R ${migrationsFolder} ${orphanFolder}`

			const { sqlite } = await openDatabase({ path, migrationsFolder })

			sqlite.run("INSERT INTO notes (text) VALUES ('Bun')")
			sqlite.close()

			// A digest item for a digest and a note that do not exist.
			await write(
				join(orphanFolder, '29990101000000_orphan', 'migration.sql'),
				'INSERT INTO digest_items (digest_id, note_id, position) VALUES (404, 404, 0);',
			)
		})

		afterEach(async () => {
			await $`rm -rf ${directory}`
		})

		it('throws with the violations listed', async () => {
			const failure = await failureOf(openDatabase({ path, migrationsFolder: orphanFolder }))

			expect(failure).toMatch(/foreign key violations.*"table":"digest_items"/u)
		})

		it('puts the file back as it was before the migration, without the backup', async () => {
			await failureOf(openDatabase({ path, migrationsFolder: orphanFolder }))

			const { sqlite } = await openDatabase({ path, migrationsFolder })

			const state = {
				notes: sqlite.query('SELECT text FROM notes').all(),
				digestItems: sqlite.query('SELECT count(*) AS rows FROM digest_items').get(),
				migrations: sqlite.query('SELECT count(*) AS rows FROM __drizzle_migrations').get(),
			}

			sqlite.close()

			// The -wal and -shm files may stay: macOS builds of SQLite keep them after closing.
			const backups = await Array.fromAsync(new Glob('*.pre-migration').scan({ cwd: directory }))

			expect({ state, backups }).toEqual({
				state: { notes: [{ text: 'Bun' }], digestItems: { rows: 0 }, migrations: { rows: 1 } },
				backups: [],
			})
		})
	})
})
