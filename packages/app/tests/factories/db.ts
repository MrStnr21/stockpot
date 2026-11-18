// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { TestDb } from '#tests/setup/db'

/**
 * Transient parameters of a factory that persists rows: pass the spec's database with
 * `rowFactory.transient({ db }).create()`.
 */
export interface DbTransientParams {
	db: TestDb
}
