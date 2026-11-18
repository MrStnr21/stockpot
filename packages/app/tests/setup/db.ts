// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { join } from 'node:path'

import { openDatabase, type Db } from '#/server/db/client'

export const migrationsFolder = join(import.meta.dir, '../../src/server/db/migrations')

/**
 * A fresh in-memory database with every migration applied and foreign keys enforced, the way the
 * server opens its file. Each call is isolated, so specs never share rows.
 */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- The Drizzle client type is long; callers use TestDb.
export function createTestDb() {
	return openDatabase({ path: ':memory:', migrationsFolder })
}

export type TestDb = Db
