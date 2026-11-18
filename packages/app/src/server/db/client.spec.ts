// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $ } from 'bun'
import type { Database } from 'bun:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import { migrationsFolder } from '#tests/setup/db'

import { openDatabase } from './client'

describe('openDatabase', () => {
	describe('with a file that does not exist yet', () => {
		let directory: string
		let path: string
		let sqlite: Database

		beforeAll(async () => {
			const created = await $`mktemp -d`.text()

			directory = created.trim()
			path = join(directory, 'stockpot.db')
			;({ sqlite } = openDatabase({ path, migrationsFolder }))
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

		it('applies each migration once when the file is opened again', () => {
			const migrated = 'SELECT name FROM __drizzle_migrations ORDER BY id'
			const before = sqlite.query(migrated).all()

			sqlite.close()
			;({ sqlite } = openDatabase({ path, migrationsFolder }))

			expect(sqlite.query(migrated).all()).toEqual(before)
		})
	})
})
