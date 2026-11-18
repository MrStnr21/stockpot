// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Database } from 'bun:sqlite'
import { beforeEach, describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'
import { Factory } from 'fishery'

import { createTestDb } from './db'

interface Pot {
	id: number
	label: string
}

// Throwaway tables: the harness must work before, and independently of, the real schema.
const potFactory = Factory.define<Pot>(({ sequence }) => ({
	id: sequence,
	label: faker.food.dish(),
}))

describe('createTestDb', () => {
	let sqlite: Database

	beforeEach(async () => {
		;({ sqlite } = await createTestDb())
		sqlite.run('CREATE TABLE pot (id INTEGER PRIMARY KEY, label TEXT NOT NULL)')
		sqlite.run(
			'CREATE TABLE scrap (id INTEGER PRIMARY KEY, pot_id INTEGER NOT NULL REFERENCES pot (id))',
		)
	})

	it('rejects a row that references a missing parent', () => {
		expect(() => sqlite.run('INSERT INTO scrap (pot_id) VALUES (?)', [404])).toThrow(
			/FOREIGN KEY constraint failed/u,
		)
	})

	it('accepts a row whose parent exists', () => {
		const soupPot = potFactory.build()

		sqlite.run('INSERT INTO pot (id, label) VALUES (?, ?)', [soupPot.id, soupPot.label])
		sqlite.run('INSERT INTO scrap (pot_id) VALUES (?)', [soupPot.id])

		expect(sqlite.query('SELECT count(*) AS scraps FROM scrap').get()).toEqual({ scraps: 1 })
	})

	it('applies the migrations folder', () => {
		expect(
			sqlite.query("SELECT name FROM sqlite_schema WHERE name = '__drizzle_migrations'").get(),
		).toEqual({ name: '__drizzle_migrations' })
	})

	it('gives every call a database of its own', async () => {
		const { sqlite: otherSqlite } = await createTestDb()

		expect(otherSqlite.query("SELECT name FROM sqlite_schema WHERE name = 'pot'").get()).toBeNull()
	})
})
