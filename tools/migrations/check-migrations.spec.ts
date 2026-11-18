// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { findMigrationProblems } from './check-migrations.ts'

const schemaV1 = '20261118105539_schema-v1'

const digestOrder = '20261201090000_digest-order'

describe('findMigrationProblems', () => {
	describe('with nothing on main yet', () => {
		it('accepts any new migration', () => {
			expect(
				findMigrationProblems({
					shipped: [],
					current: [schemaV1],
					changes: [{ status: 'A', path: `${schemaV1}/migration.sql` }],
				}),
			).toEqual([])
		})
	})

	describe('with migrations on main', () => {
		it('accepts a new migration after the last one', () => {
			expect(
				findMigrationProblems({
					shipped: [schemaV1],
					current: [schemaV1, digestOrder],
					changes: [
						{ status: 'A', path: `${digestOrder}/migration.sql` },
						{ status: 'A', path: `${digestOrder}/snapshot.json` },
					],
				}),
			).toEqual([])
		})

		it('ignores files outside the migration folders', () => {
			expect(
				findMigrationProblems({
					shipped: [schemaV1],
					current: [schemaV1],
					changes: [{ status: 'M', path: 'README.md' }],
				}),
			).toEqual([])
		})

		it('reports every file changed, deleted or added in a migration on main', () => {
			expect(
				findMigrationProblems({
					shipped: [schemaV1, digestOrder],
					current: [schemaV1],
					changes: [
						{ status: 'M', path: `${schemaV1}/migration.sql` },
						{ status: 'A', path: `${schemaV1}/extra.sql` },
						{ status: 'D', path: `${digestOrder}/migration.sql` },
						{ status: 'T', path: `${schemaV1}/snapshot.json` },
					],
				}),
			).toEqual([
				{
					path: `${schemaV1}/migration.sql`,
					reason: 'changed in a migration that is on main',
				},
				{ path: `${schemaV1}/extra.sql`, reason: 'added to a migration that is on main' },
				{
					path: `${digestOrder}/migration.sql`,
					reason: 'deleted from a migration that is on main',
				},
				{
					path: `${schemaV1}/snapshot.json`,
					reason: 'changed in a migration that is on main',
				},
			])
		})

		it('reports a new migration that sorts before the last one on main', () => {
			const early = '20261120120000_note-tags'

			expect(
				findMigrationProblems({
					shipped: [schemaV1, digestOrder],
					current: [schemaV1, early, digestOrder],
					changes: [{ status: 'A', path: `${early}/migration.sql` }],
				}),
			).toEqual([
				{ path: early, reason: `sorts before ${digestOrder}, the last migration on main` },
			])
		})
	})
})
