// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Database } from 'bun:sqlite'
import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { explanationRowFactory } from '#tests/factories/explanations'
import { noteRowFactory } from '#tests/factories/notes'
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

		beforeAll(() => {
			;({ sqlite } = createTestDb())
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

		beforeAll(() => {
			;({ db } = createTestDb())
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
					'SCAN note_search VIRTUAL TABLE INDEX 32:M3',
					'SEARCH notes USING INTEGER PRIMARY KEY (rowid=?)',
				],
			],
		])('reads %s through an index', (_path, query, plan) => {
			const rows = db.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${query(db).getSQL()}`)

			expect(rows.map(({ detail }) => detail)).toEqual(plan)
		})
	})

	describe('note_search', () => {
		let db: TestDb
		let sqlite: Database

		beforeEach(() => {
			;({ db, sqlite } = createTestDb())
		})

		function noteIdsMatching(query: string) {
			return sqlite
				.query<{ id: number }, [string]>(
					'SELECT rowid AS id FROM note_search WHERE note_search MATCH ? ORDER BY rowid',
				)
				.all(query)
				.map(({ id }) => id)
		}

		it('finds a new note by its text and by its context', async () => {
			const note = await noteRowFactory
				.transient({ db })
				.create({ text: 'Bun', context: 'seen in a podcast' })

			expect([noteIdsMatching('bun'), noteIdsMatching('podcast')]).toEqual([[note.id], [note.id]])
		})

		it('follows an edited note', async () => {
			const note = await noteRowFactory.transient({ db }).create({ text: 'Deno' })

			db.update(notes).set({ text: 'Bun' }).where(eq(notes.id, note.id)).run()

			expect([noteIdsMatching('deno'), noteIdsMatching('bun')]).toEqual([[], [note.id]])
		})

		it('forgets a deleted note', async () => {
			const note = await noteRowFactory.transient({ db }).create({ text: 'Bun' })

			db.delete(notes).where(eq(notes.id, note.id)).run()

			expect(sqlite.query('SELECT count(*) AS rows FROM note_search').get()).toEqual({ rows: 0 })
		})

		it("finds a note by its card's values, not by the keys of the card's format", async () => {
			const note = await noteRowFactory.transient({ db }).create({ text: 'Bun' })

			await explanationRowFactory.transient({ db }).create({
				noteId: note.id,
				body: { summary: 'A JavaScript runtime', links: ['zig'] },
			})

			expect([
				noteIdsMatching('runtime'),
				noteIdsMatching('zig'),
				noteIdsMatching('summary'),
			]).toEqual([[note.id], [note.id], []])
		})

		it('follows an edited card', async () => {
			const note = await noteRowFactory.transient({ db }).create({ text: 'Bun' })

			const card = await explanationRowFactory
				.transient({ db })
				.create({ noteId: note.id, body: { summary: 'A bundler' } })

			db.update(explanations)
				.set({ body: { summary: 'A runtime' } })
				.where(eq(explanations.id, card.id))
				.run()

			expect([noteIdsMatching('bundler'), noteIdsMatching('runtime')]).toEqual([[], [note.id]])
		})

		it('moves card text with a card that moves to another note', async () => {
			const [first, second] = await noteRowFactory.transient({ db }).createList(2)

			const card = await explanationRowFactory
				.transient({ db })
				.create({ noteId: first.id, body: { summary: 'A runtime' } })

			db.update(explanations).set({ noteId: second.id }).where(eq(explanations.id, card.id)).run()

			expect(noteIdsMatching('runtime')).toEqual([second.id])
		})

		it('forgets a deleted card', async () => {
			const note = await noteRowFactory.transient({ db }).create({ text: 'Bun' })

			const card = await explanationRowFactory
				.transient({ db })
				.create({ noteId: note.id, body: { summary: 'A runtime' } })

			db.delete(explanations).where(eq(explanations.id, card.id)).run()

			expect([noteIdsMatching('runtime'), noteIdsMatching('bun')]).toEqual([[], [note.id]])
		})

		it('forgets the cards of a deleted note', async () => {
			const note = await noteRowFactory.transient({ db }).create({ text: 'Bun' })

			await explanationRowFactory.transient({ db }).create({ noteId: note.id })
			db.delete(notes).where(eq(notes.id, note.id)).run()

			expect(sqlite.query('SELECT count(*) AS rows FROM note_search').get()).toEqual({ rows: 0 })
		})
	})
})
