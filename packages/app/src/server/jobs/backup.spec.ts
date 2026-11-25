// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $, file, write } from 'bun'
import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it, spyOn, type Mock } from 'bun:test'
import { join } from 'node:path'
import { noteRowFactory } from '#tests/factories/notes'
import { createTestDb, migrationsFolder, type TestDb } from '#tests/setup/db'

import { openDatabase } from '#/server/db/client'
import { notes } from '#/server/db/schema/notes'
import { log, type Logger } from '#/server/log'

import { createBackupJob } from './backup'

const { signal } = new AbortController()

async function temporaryDirectory() {
	const created = await $`mktemp -d`.text()

	return created.trim()
}

/** The message a run fails with, or '' when it succeeds. */
async function failureOf(running: Promise<unknown>) {
	try {
		await running
	} catch (error) {
		return error instanceof Error ? error.message : 'a value that is not an Error'
	}

	return ''
}

/** Every entry, directories, links and dotfiles included. */
async function listed(directory: string) {
	const names = await $`ls -A ${directory}`.text()

	return names.split('\n').filter(Boolean).toSorted()
}

describe('createBackupJob', () => {
	let directory: string
	let backups: string
	let sqlite: Database
	let db: TestDb
	let info: Mock<Logger['info']>

	async function backUp(day: string, keep = 7) {
		return createBackupJob({ db, directory: backups, keep }).run(
			{ day },
			{ id: 1, attempt: 1, signal },
		)
	}

	beforeEach(async () => {
		directory = await temporaryDirectory()
		backups = join(directory, 'backups')
		;({ sqlite, db } = await createTestDb())
		info = spyOn(log, 'info').mockImplementation(() => {
			// Keep the run's report out of the test output.
		})
	})

	afterEach(async () => {
		info.mockRestore()
		sqlite.close()
		await $`rm -rf ${directory}`
	})

	describe('a restore from the backup', () => {
		it('opens as a database that holds the notes and passes its checks', async () => {
			const saved = await noteRowFactory.transient({ db }).createList(3)

			await backUp('2026-11-24')

			const restored = join(directory, 'stockpot.db')

			await write(restored, file(join(backups, 'stockpot-2026-11-24.db')))

			const reopened = await openDatabase({ path: restored, migrationsFolder })

			expect(reopened.db.select().from(notes).all()).toEqual(saved)
			expect(reopened.sqlite.query('PRAGMA integrity_check').all()).toEqual([
				{ integrity_check: 'ok' },
			])

			reopened.sqlite.close()
		})
	})

	describe('the backup files', () => {
		it('are named for the day and leave no partial copy behind', async () => {
			await backUp('2026-11-24')

			expect(await listed(backups)).toEqual(['stockpot-2026-11-24.db'])
		})

		it('are readable by the owner only', async () => {
			await backUp('2026-11-24')

			const directoryStat = await file(backups).stat()
			const fileStat = await file(join(backups, 'stockpot-2026-11-24.db')).stat()
			const directoryMode = directoryStat.mode % 0o1000
			const fileMode = fileStat.mode % 0o1000

			expect({ directoryMode, fileMode }).toEqual({ directoryMode: 0o700, fileMode: 0o600 })
		})

		it('are replaced by a second run for the same day, even after a run that stopped midway', async () => {
			await write(join(backups, 'stockpot-2026-11-24.db.partial'), 'half a file')
			await backUp('2026-11-24')
			await noteRowFactory.transient({ db }).create({ text: 'later' })
			await backUp('2026-11-24')

			const reopened = new Database(join(backups, 'stockpot-2026-11-24.db'), { readonly: true })

			expect(reopened.query('SELECT count(*) AS count FROM notes').get()).toEqual({ count: 1 })
			expect(await listed(backups)).toEqual(['stockpot-2026-11-24.db'])

			reopened.close()
		})
	})

	describe('retention', () => {
		beforeEach(async () => {
			await $`mkdir -p ${backups}`
			await Promise.all(
				['2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23'].map(async (day) =>
					write(join(backups, `stockpot-${day}.db`), day),
				),
			)
		})

		it('keeps the newest backups and removes the older ones', async () => {
			await backUp('2026-11-24', 3)

			expect(await listed(backups)).toEqual([
				'stockpot-2026-11-22.db',
				'stockpot-2026-11-23.db',
				'stockpot-2026-11-24.db',
			])
		})

		it('never touches a file that is not a daily backup', async () => {
			const others = [
				'stockpot.db',
				'stockpot-latest.db',
				'stockpot-2026-11-19.db.bak',
				'notes.txt',
			]

			await Promise.all(others.map(async (name) => write(join(backups, name), name)))
			await backUp('2026-11-24', 1)

			expect(await listed(backups)).toEqual([...others, 'stockpot-2026-11-24.db'].toSorted())
		})

		it('keeps the new backup when newer files already fill the count', async () => {
			await Promise.all(
				['2027-01-01', '2027-01-02', '2027-01-03'].map(async (day) =>
					write(join(backups, `stockpot-${day}.db`), day),
				),
			)
			await backUp('2026-11-24', 3)

			expect(await listed(backups)).toContain('stockpot-2026-11-24.db')
		})

		it('leaves a directory or a link named like a backup alone', async () => {
			await $`mkdir ${join(backups, 'stockpot-2026-11-01.db')} && ln -s ${directory} ${join(backups, 'stockpot-2026-11-02.db')}`
			await backUp('2026-11-24', 1)

			expect(await listed(backups)).toEqual([
				'stockpot-2026-11-01.db',
				'stockpot-2026-11-02.db',
				'stockpot-2026-11-24.db',
			])
			expect(await listed(directory)).toContain('backups')
		})

		it('removes nothing when the new backup fails', async () => {
			sqlite.close()

			expect(await failureOf(backUp('2026-11-24', 1))).not.toBe('')

			expect(await listed(backups)).toHaveLength(4)

			;({ sqlite, db } = await createTestDb())
		})
	})

	describe('a count that keeps no backup', () => {
		it.each([0, -1, 1.5, Number.NaN])('is refused for %p', (keep) => {
			expect(() => createBackupJob({ db, directory: backups, keep })).toThrow('Backups to keep')
		})
	})

	describe('a day that is not a date', () => {
		it('is refused before anything is written', async () => {
			expect(await failureOf(backUp('../2026-11-24'))).toContain('Not a date to back up')

			const { exitCode } = await $`test -e ${backups}`.nothrow().quiet()

			expect(exitCode).toBe(1)
		})
	})
})
