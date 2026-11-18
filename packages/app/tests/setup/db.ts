// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'

export const migrationsFolder = join(import.meta.dir, '../../src/server/db/migrations')

/**
 * A fresh in-memory database with every migration applied and foreign keys enforced, the way the
 * server opens its file. Each call is isolated, so specs never share rows.
 */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- The Drizzle client type is long; callers use TestDb.
export function createTestDb() {
	const sqlite = new Database(':memory:', { strict: true })
	const db = drizzle({ client: sqlite })

	migrate(db, { migrationsFolder })

	// A migration that rebuilds a table runs with foreign keys off; make sure it left no orphans behind.
	const violations = sqlite.query('PRAGMA foreign_key_check').all()

	if (violations.length > 0) {
		throw new Error(`Migrations left foreign key violations: ${JSON.stringify(violations)}`)
	}

	sqlite.run('PRAGMA foreign_keys = ON')

	return { sqlite, db }
}

export type TestDb = ReturnType<typeof createTestDb>['db']
