// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Fails when a migration that is already on main changed. Instances record each migration by its
 * folder name and never run it again, so an edit would reach fresh installs only and split the schema
 * in two. A new migration must also sort after every migration on main, so that every instance
 * applies them in the same order.
 *
 * On a branch, the shipped folders come from `origin/main` (or the ref passed as an argument), but the
 * edits come from the branch alone: its diff since the merge base. Main may be ahead of a branch, as on
 * a re-run of an old merge commit or a run that notices.yml dispatches on a pull request's head, and
 * main's newer migrations are not the branch's edits. With `--push`, it checks the commit a push to
 * main added against the commit before it; squash merges make every push one commit.
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

export interface CheckOptions {
	/** The repository root. */
	root: string
	/** The ref whose migrations count as shipped on a branch. */
	base: string
	/** Check the commit a push to main added against the commit before it. */
	push: boolean
}

// NUL-separated output keeps paths outside ASCII exactly as they are.
async function git(root: string, args: string[]) {
	return $`git -c core.quotePath=false ${args}`.cwd(root).quiet().text()
}

function entries(output: string) {
	return output.split('\0').filter((entry) => entry !== '')
}

async function editsSince(root: string, base: string, push: boolean) {
	if (push) {
		return 'HEAD^'
	}

	const found = await $`git merge-base ${base} HEAD`.cwd(root).nothrow().quiet()

	if (found.exitCode !== 0) {
		throw new Error(
			`No merge base of ${base} and HEAD: fetch their history (git fetch --unshallow).`,
		)
	}

	return found.text().trim()
}

export async function collectMigrationState({
	root,
	base,
	push,
}: CheckOptions): Promise<MigrationState> {
	const prefix = `${migrationsPath}/`
	const since = await editsSince(root, base, push)

	const [tree, diff, untracked] = await Promise.all([
		git(root, ['ls-tree', '-d', '--name-only', '-z', push ? 'HEAD^' : base, prefix]),
		git(root, ['diff', '--no-renames', '--name-status', '-z', since, '--', migrationsPath]),
		git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', migrationsPath]),
	])

	const diffEntries = entries(diff)

	const changes = [
		...diffEntries.flatMap((status, index) =>
			index % 2 === 0
				? [{ status, path: (diffEntries[index + 1] ?? '').slice(prefix.length) }]
				: [],
		),
		...entries(untracked).map((path) => ({ status: 'A', path: path.slice(prefix.length) })),
	]

	const migrationFiles = await Array.fromAsync(
		new Glob('*/migration.sql').scan({ cwd: posix.join(root, migrationsPath) }),
	)

	return {
		shipped: entries(tree).map((path) => posix.basename(path)),
		current: migrationFiles.map((path) => posix.dirname(path)),
		changes,
	}
}

export async function checkMigrations(options: CheckOptions): Promise<MigrationProblem[]> {
	return findMigrationProblems(await collectMigrationState(options))
}

async function main() {
	const root = posix.join(import.meta.dir, '../..')
	const push = argv.includes('--push')
	const base = argv.slice(2).find((argument) => !argument.startsWith('--')) ?? 'origin/main'
	const shippedRef = push ? 'HEAD^' : base

	const known = await $`git rev-parse --verify --quiet ${`${shippedRef}^{commit}`}`
		.cwd(root)
		.nothrow()
		.quiet()

	if (known.exitCode !== 0) {
		console.error(`${shippedRef} is not available here: fetch the history of main first.`)
		process.exit(1)
	}

	const state = await collectMigrationState({ root, base, push })
	const problems = findMigrationProblems(state)

	if (problems.length === 0) {
		const added = state.current.filter((folder) => !state.shipped.includes(folder)).length

		console.log(
			`The ${state.shipped.length} migration(s) on ${shippedRef} are unchanged; ${added} new.`,
		)

		return
	}

	const report = problems.map(({ path, reason }) => `${migrationsPath}/${path}: ${reason}`)

	console.error(
		`${report.join('\n')}\n\nA migration on main is never edited: restore it and add a new one. ` +
			'A new migration that sorts too early: rebase, delete its folder and generate it again.',
	)
	process.exit(1)
}

if (import.meta.main) {
	await main()
}
