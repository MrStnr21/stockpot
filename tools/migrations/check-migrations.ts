// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Fails when a migration that is already on main changed. Instances record each migration by its
 * folder name and never run it again, so an edit would reach fresh installs only and split the schema
 * in two. A new migration must also sort after every migration on main, so that every instance
 * applies them in the same order. Compares the working tree with `origin/main`, or the ref passed as
 * the first argument.
 */
import { $, argv, Glob } from 'bun'
import { posix } from 'node:path'

export const migrationsPath = 'packages/app/src/server/db/migrations'

/** A line of `git diff --name-status`, with the path relative to the migrations folder. */
export interface MigrationChange {
	status: string
	path: string
}

export interface MigrationProblem {
	path: string
	reason: string
}

export interface MigrationState {
	/** The migration folders on the base ref. */
	shipped: readonly string[]
	/** The migration folders in the working tree. */
	current: readonly string[]
	changes: readonly MigrationChange[]
}

const changedReason = 'changed in a migration that is on main'

/** What each `git diff --name-status` letter means for a file in a migration on main. */
function changeReason(status: string) {
	if (status === 'A') {
		return 'added to a migration that is on main'
	}

	return status === 'D' ? 'deleted from a migration that is on main' : changedReason
}

// Drizzle's migrator sorts folders the same way before it applies them.
function byName(first: string, second: string) {
	return first.localeCompare(second)
}

export function findMigrationProblems({
	shipped,
	current,
	changes,
}: MigrationState): MigrationProblem[] {
	const shippedFolders = new Set(shipped)
	const last = shipped.toSorted(byName).at(-1)

	const edited = changes.flatMap(({ status, path }) => {
		const [folder = ''] = path.split('/', 1)

		if (!shippedFolders.has(folder)) {
			return []
		}

		return [{ path, reason: changeReason(status) }]
	})

	const misplaced = current
		.filter((folder) => !shippedFolders.has(folder))
		.toSorted(byName)
		.flatMap((folder) =>
			last !== undefined && byName(folder, last) <= 0
				? [{ path: folder, reason: `sorts before ${last}, the last migration on main` }]
				: [],
		)

	return [...edited, ...misplaced]
}

function lines(output: string) {
	return output.split('\n').filter((line) => line !== '')
}

async function main() {
	const root = posix.join(import.meta.dir, '../..')
	const base = argv[2] ?? 'origin/main'

	const known = await $`git rev-parse --verify --quiet ${`${base}^{commit}`}`
		.cwd(root)
		.nothrow()
		.quiet()

	if (known.exitCode !== 0) {
		console.error(`${base} is not available here: fetch it first (git fetch origin main).`)
		process.exit(1)
	}

	const prefix = `${migrationsPath}/`

	const tree = await $`git ls-tree -d --name-only ${base} ${prefix}`.cwd(root).text()

	const diff = await $`git diff --no-renames --name-status ${base} -- ${migrationsPath}`
		.cwd(root)
		.text()

	const untracked = await $`git ls-files --others --exclude-standard -- ${migrationsPath}`
		.cwd(root)
		.text()

	const changes = [
		...lines(diff).map((line) => {
			const [status = '', path = ''] = line.split('\t')

			return { status, path: path.slice(prefix.length) }
		}),
		...lines(untracked).map((path) => ({ status: 'A', path: path.slice(prefix.length) })),
	]

	const migrationFiles = await Array.fromAsync(
		new Glob('*/migration.sql').scan({ cwd: posix.join(root, migrationsPath) }),
	)

	const shipped = lines(tree).map((path) => posix.basename(path))
	const current = migrationFiles.map((path) => posix.dirname(path))
	const problems = findMigrationProblems({ shipped, current, changes })

	if (problems.length === 0) {
		const added = current.filter((folder) => !shipped.includes(folder)).length

		console.log(`The ${shipped.length} migration(s) on ${base} are unchanged; ${added} new.`)

		return
	}

	const report = problems.map(({ path, reason }) => `${prefix}${path}: ${reason}`)

	console.error(
		`${report.join('\n')}\n\nA migration on main is never edited: restore it and add a new one. ` +
			'A new migration that sorts too early: rebase, delete its folder and generate it again.',
	)
	process.exit(1)
}

if (import.meta.main) {
	await main()
}
