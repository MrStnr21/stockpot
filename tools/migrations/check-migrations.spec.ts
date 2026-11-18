// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $, write } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { join } from 'node:path'

import {
	checkMigrations,
	findMigrationProblems,
	migrationsPath,
	type MigrationProblem,
	type MigrationState,
} from './check-migrations.ts'

const schemaV1 = '20261118105539_schema-v1'

const digestOrder = '20261201090000_digest-order'

type ProblemCase = [string, MigrationState, MigrationProblem[]]

/** A case where one file in a migration on main has the given `git diff` status. */
function shippedChange(status: string, path: string, reason: string): ProblemCase {
	const state = {
		shipped: [schemaV1, digestOrder],
		current: [schemaV1, digestOrder],
		changes: [{ status, path }],
	}

	return [`reports a file ${reason}`, state, [{ path, reason }]]
}

const problemCases: ProblemCase[] = [
	[
		'accepts a first migration',
		{
			shipped: [],
			current: [schemaV1],
			changes: [{ status: 'A', path: `${schemaV1}/migration.sql` }],
		},
		[],
	],
	[
		'accepts a new migration after the last one',
		{
			shipped: [schemaV1],
			current: [schemaV1, digestOrder],
			changes: [{ status: 'A', path: `${digestOrder}/migration.sql` }],
		},
		[],
	],
	[
		'ignores files outside the migration folders',
		{ shipped: [schemaV1], current: [schemaV1], changes: [{ status: 'M', path: 'README.md' }] },
		[],
	],
	shippedChange('D', `${digestOrder}/migration.sql`, 'deleted from a migration that is on main'),
	shippedChange('T', `${schemaV1}/snapshot.json`, 'changed in a migration that is on main'),
]

const one = '20260101000000_one'

const two = '20260201000000_two'

const git = ['git', '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid']

const commit = [
	...git,
	'-c',
	'commit.gpgsign=false',
	'-c',
	'core.hooksPath=/dev/null',
	'commit',
	'-qm',
]

/** A throwaway repository on `main` whose first commit holds migration `one`. */
async function repository() {
	const created = await $`mktemp -d`.text()
	const root = created.trim()

	await $`git init -q -b main`.cwd(root)
	await addMigration(root, one)

	return root
}

async function addMigration(root: string, folder: string) {
	await write(join(root, migrationsPath, folder, 'migration.sql'), 'SELECT 1;')
	await $`git add ${migrationsPath}`.cwd(root)
	await $`${commit} ${folder}`.cwd(root)
}

describe('check-migrations', () => {
	describe('findMigrationProblems', () => {
		it.each(problemCases)('%s', (_name, state, problems) => {
			expect(findMigrationProblems(state)).toEqual(problems)
		})
	})

	describe('checkMigrations', () => {
		let root: string
		let problems: MigrationProblem[]

		afterAll(async () => {
			await $`rm -rf ${root}`
		})

		describe('on a branch that main has moved ahead of', () => {
			beforeAll(async () => {
				root = await repository()
				await $`git switch -q -c branch`.cwd(root)
				await write(join(root, 'notes.txt'), 'a dependency update')
				await $`git add notes.txt`.cwd(root)
				await $`${commit} update`.cwd(root)
				await $`git switch -q main`.cwd(root)
				await addMigration(root, two)
				await $`git switch -q branch`.cwd(root)
				problems = await checkMigrations({ root, base: 'main', push: false })
			})

			it("does not take main's newer migration for the branch's edit", () => {
				expect(problems).toEqual([])
			})
		})

		describe('on a branch that edits a migration on main', () => {
			beforeAll(async () => {
				root = await repository()
				await $`git switch -q -c branch`.cwd(root)
				await write(join(root, migrationsPath, one, 'migration.sql'), 'SELECT 2;')
				await write(join(root, migrationsPath, one, 'заметка.sql'), 'SELECT 3;')
				problems = await checkMigrations({ root, base: 'main', push: false })
			})

			it('reports each edited file, whatever its name', () => {
				expect(problems).toEqual([
					{ path: `${one}/migration.sql`, reason: 'changed in a migration that is on main' },
					{ path: `${one}/заметка.sql`, reason: 'added to a migration that is on main' },
				])
			})
		})

		describe('on a push that adds a migration sorting before the last one', () => {
			const early = '20251201000000_early'

			beforeAll(async () => {
				root = await repository()
				await addMigration(root, two)
				await addMigration(root, early)
				problems = await checkMigrations({ root, base: 'main', push: true })
			})

			it('reports the new migration', () => {
				expect(problems).toEqual([
					{ path: early, reason: `sorts before ${two}, the last migration on main` },
				])
			})
		})
	})
})
