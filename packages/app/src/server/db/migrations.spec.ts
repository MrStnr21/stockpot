// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Database } from 'bun:sqlite'
import { beforeAll, describe, expect, it } from 'bun:test'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { and, asc, desc, eq, isNotNull, lte, sql, type SQLWrapper } from 'drizzle-orm'

import { digestItems } from './schema/digests'
import { explanations } from './schema/explanations'
import { jobs } from './schema/jobs'
import { aliases, notes, terms } from './schema/notes'

const schemaV1Tables = [
	'aliases',
	'categories',
	'devices',
	'digest_items',
	'digests',
	'engine_runs',
	'explanations',
	'jobs',
	'note_search',
	'notes',
	'owner',
	'push_subscriptions',
	'sessions',
	'settings',
	'terms',
]

// The nightly batch time; the job query compares run_at with it.
const nightlyRun = new Date('2026-11-18T06:30:00Z')

describe('migrations', () => {
	describe('on an empty database', () => {
		let sqlite: Database

		beforeAll(async () => {
			;({ sqlite } = await createTestDb())
		})

		it('create every table of schema v1', () => {
			// FTS5 keeps note_search in shadow tables named after it; drizzle keeps its own log.
			const tables = sqlite
				.query<{ name: string }, []>(
					String.raw`SELECT name FROM sqlite_schema WHERE type = 'table'
						AND name NOT LIKE 'note\_search\_%' ESCAPE '\' AND name NOT LIKE '\_\_drizzle%' ESCAPE '\'
						ORDER BY name`,
				)
				.all()

			expect(tables.map(({ name }) => name)).toEqual(schemaV1Tables)
		})

		it('keep the instance to one owner', () => {
			sqlite.run("INSERT INTO owner (id, password_hash) VALUES (1, 'hash')")

			expect(() => sqlite.run("INSERT INTO owner (id, password_hash) VALUES (2, 'hash')")).toThrow(
				/CHECK constraint failed: owner_single_row/u,
			)
		})
	})

	describe('query plans', () => {
		let db: TestDb

		beforeAll(async () => {
			;({ db } = await createTestDb())
		})

		/* Each read on a hot path, as its feature will write it, with the plan SQLite picks for it. A plan
		 * without "USE TEMP B-TREE" reads rows in index order instead of sorting them. */
		it.each<[string, (client: TestDb) => SQLWrapper, string[]]>([
			[
				'the notes list',
				(client) => client.select().from(notes).orderBy(desc(notes.createdAt)).limit(50),
				['SCAN notes USING INDEX notes_created_at_idx'],
			],
			[
				'the notes list by status',
				(client) =>
					client
						.select()
						.from(notes)
						.where(eq(notes.status, 'ready'))
						.orderBy(desc(notes.createdAt))
						.limit(50),
				['SEARCH notes USING INDEX notes_status_created_at_idx (status=?)'],
			],
			[
				'the notes list by category',
				(client) =>
					client
						.select()
						.from(notes)
						.where(eq(notes.categoryId, 1))
						.orderBy(desc(notes.createdAt))
						.limit(50),
				['SEARCH notes USING INDEX notes_category_id_created_at_idx (category_id=?)'],
			],
			[
				'Base',
				(client) =>
					client
						.select()
						.from(notes)
						.where(isNotNull(notes.keptAt))
						.orderBy(desc(notes.keptAt))
						.limit(50),
				['SEARCH notes USING INDEX notes_kept_at_idx (kept_at>?)'],
			],
			[
				'the cards of a note',
				(client) =>
					client
						.select()
						.from(explanations)
						.where(eq(explanations.noteId, 1))
						.orderBy(desc(explanations.createdAt)),
				['SEARCH explanations USING INDEX explanations_note_id_created_at_idx (note_id=?)'],
			],
			[
				'Today',
				(client) =>
					client
						.select()
						.from(digestItems)
						.where(eq(digestItems.digestId, 1))
						.orderBy(asc(digestItems.position)),
				['SEARCH digest_items USING INDEX digest_items_digest_id_position_idx (digest_id=?)'],
			],
			[
				'a repeated term',
				(client) => client.select().from(terms).where(eq(terms.term, 'bun')),
				['SEARCH terms USING INDEX terms_term_meaning_idx (term=?)'],
			],
			[
				'a repeated alias',
				(client) => client.select().from(aliases).where(eq(aliases.alias, 'bunjs')),
				['SEARCH aliases USING COVERING INDEX sqlite_autoindex_aliases_1 (alias=?)'],
			],
			[
				'the next job',
				(client) =>
					client
						.select()
						.from(jobs)
						.where(and(eq(jobs.status, 'queued'), lte(jobs.runAt, nightlyRun)))
						.orderBy(desc(jobs.priority), asc(jobs.runAt))
						.limit(1),
				['SEARCH jobs USING INDEX jobs_queue_idx (status=?)'],
			],
			[
				'search',
				() => sql`SELECT notes.* FROM note_search
					JOIN notes ON notes.id = note_search.rowid
					WHERE note_search MATCH ${'bun*'}
					ORDER BY rank`,
				[
					'SCAN note_search VIRTUAL TABLE INDEX n:M',
					'SEARCH notes USING INTEGER PRIMARY KEY (rowid=?)',
				],
			],
		])('reads %s through an index', (_path, query, plan) => {
			const rows = db.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${query(db).getSQL()}`)

			// FTS5 encodes its plan after INDEX in numbers that are internal to it: keep only the MATCH.
			const details = rows.map(({ detail }) =>
				detail.replace(/(?<=VIRTUAL TABLE INDEX )\d+:M\S*/u, 'n:M'),
			)

			expect(details).toEqual(plan)
		})
	})
})
