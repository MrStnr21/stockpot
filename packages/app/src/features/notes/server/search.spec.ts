// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { categoryRowFactory } from '#tests/factories/categories'
import { explanationRowFactory } from '#tests/factories/explanations'
import { noteRowFactory } from '#tests/factories/notes'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { asc, sql, type SQL } from 'drizzle-orm'
import * as v from 'valibot'

import { notes as notesTable } from '#/server/db/schema/notes'

import { notesQuerySchema, type NotesQuery } from '../schemas'
import { listNotes, noteFilters } from './list'
import { selectMatches, snippetSegments, toFtsQuery } from './search'

const capturedAt = new Date('2026-11-20T08:00:00Z')

describe('note search', () => {
	describe('toFtsQuery', () => {
		it.each([
			['one word, as a prefix', 'kafka', '"kafka"*'],
			['every word, the last as a prefix', 'event drive', '"event" "drive"*'],
			[
				'words without the punctuation around them',
				' "Event-driven", arch! ',
				'"Event" "driven" "arch"*',
			],
			['quotes and stars as separators', 'a"b*c', '"a" "b" "c"*'],
			['operators as plain words', 'NEAR(a b) OR -x text:y', '"NEAR" "a" "b" "OR" "x" "text" "y"*'],
			['letters of any script', 'Привет мир', '"Привет" "мир"*'],
			['full-width forms as plain ones', 'ｋａｆｋａ', '"kafka"*'],
			['the first eight words only', 'a b c d e f g h i j', '"a" "b" "c" "d" "e" "f" "g" "h"*'],
		])('turns %s into phrases', (_case, input, query) => {
			expect(toFtsQuery(input)).toBe(query)
		})

		it.each([
			['only punctuation', '"*-:()'],
			['only emoji', '🙂'.repeat(200)],
			['nothing', ''],
		])('answers null for %s', (_case, input) => {
			expect(toFtsQuery(input)).toBeNull()
		})
	})

	describe('snippetSegments', () => {
		it.each([
			[
				'marked matches',
				'…the \u0002kafka\u0003 log and \u0002kafka\u0003',
				[
					{ text: '…the ', match: false },
					{ text: 'kafka', match: true },
					{ text: ' log and ', match: false },
					{ text: 'kafka', match: true },
				],
			],
			['no match', 'plain text', [{ text: 'plain text', match: false }]],
			[
				'adjacent matches as one',
				'\u0002event\u0003\u0002drive\u0003 bus',
				[
					{ text: 'eventdrive', match: true },
					{ text: ' bus', match: false },
				],
			],
			['markers alone as nothing', '\u0003\u0002\u0003', []],
		])('splits %s', (_case, snippet, segments) => {
			expect(snippetSegments(snippet)).toEqual(segments)
		})
	})

	describe('listNotes with q', () => {
		let db: TestDb

		beforeEach(async () => {
			;({ db } = await createTestDb())
		})

		function search(q: string, query: NotesQuery = {}) {
			return listNotes(db, { ...query, ...v.parse(notesQuerySchema, { q }) })
		}

		function foundIds(q: string, query: NotesQuery = {}) {
			return search(q, query).notes.map(({ id }) => id)
		}

		async function noteAt(minute: number, fields: Parameters<typeof noteRowFactory.build>[0] = {}) {
			return noteRowFactory
				.transient({ db })
				.create({ createdAt: new Date(capturedAt.getTime() + minute * 60_000), ...fields })
		}

		it('finds a word by its prefix, newest first', async () => {
			const older = await noteAt(0, { text: 'Kafka' })
			const newer = await noteAt(1, { text: 'Kafka Streams' })
			await noteAt(2, { text: 'Pulsar' })

			expect(foundIds('kaf')).toEqual([newer.id, older.id])
		})

		it('finds only notes that hold every word', async () => {
			const both = await noteAt(0, { text: 'event bus', context: 'drives the queue' })
			await noteAt(1, { text: 'event loop', context: 'single thread' })

			expect(foundIds('event drive')).toEqual([both.id])
		})

		it('finds the words in the context and in the card', async () => {
			const inContext = await noteAt(0, { text: 'Raft', context: 'seen in the etcd docs' })
			const inCard = await noteAt(1, { text: 'Paxos', context: null })
			await explanationRowFactory
				.transient({ db })
				.create({ noteId: inCard.id, body: { sense: 'consensus', summary: 'like etcd' } })

			expect(foundIds('etcd')).toEqual([inCard.id, inContext.id])
		})

		it('leaves deleted notes out', async () => {
			await noteAt(0, { text: 'Kafka', deletedAt: capturedAt })

			expect(search('kafka')).toMatchObject({ notes: [], total: 0, nextCursor: null })
		})

		it('applies the status and category filters', async () => {
			const category = await categoryRowFactory.transient({ db }).create()
			const filed = await noteAt(0, { text: 'Kafka', categoryId: category.id, status: 'ready' })
			await noteAt(1, { text: 'Kafka', status: 'ready' })
			await noteAt(2, { text: 'Kafka', categoryId: category.id })

			expect([
				foundIds('kafka', { status: 'ready', categoryId: category.id }),
				search('kafka', { status: 'ready' }).total,
			]).toEqual([[filed.id], 2])
		})

		it('pages through the matches with the cursor, without repeats, counting all of them', async () => {
			// Five matches share one time, so the id alone orders them across pages.
			const same = await noteRowFactory
				.transient({ db })
				.createList(5, { text: 'Kafka', createdAt: capturedAt })

			await noteAt(-1, { text: 'Pulsar' })
			const pages: { ids: number[]; total: number | null }[] = []
			let cursor: string | null | undefined

			do {
				const query = v.parse(notesQuerySchema, { q: 'kafka', limit: '2', cursor })
				const page = listNotes(db, query)

				pages.push({ ids: page.notes.map(({ id }) => id), total: page.total })
				cursor = page.nextCursor ?? undefined
				// A cursor that never ran out would loop forever; three pages hold every match.
			} while (cursor !== undefined && pages.length < 4)

			const ids = same.map(({ id }) => id).toReversed()

			expect(pages).toEqual([
				{ ids: ids.slice(0, 2), total: 5 },
				{ ids: ids.slice(2, 4), total: 5 },
				{ ids: ids.slice(4), total: 5 },
			])
		})

		it('marks the matched words in the snippet', async () => {
			await noteAt(0, { text: 'Raft', context: 'seen in the etcd docs' })

			expect(search('etc').notes[0]?.snippet).toEqual([
				{ text: 'seen in the ', match: false },
				{ text: 'etcd', match: true },
				{ text: ' docs', match: false },
			])
		})

		it('drops the snippet markers a note holds itself', async () => {
			await noteAt(0, { text: 'Raft', context: 'a \u0003b\u0002 etcd' })

			const text = search('etcd')
				.notes[0]?.snippet?.map((segment) => segment.text)
				.join('')

			expect(text).toBe('a b etcd')
		})

		it.each([
			['a quote', '"'],
			['a star', '*'],
			['NEAR', 'NEAR(a b)'],
			['a column filter', 'text:x'],
			['a minus', '-x'],
			['OR', 'OR'],
			['a lone combining mark', '́'],
			['only punctuation', '?!.,;'],
			['200 emoji', '🙂'.repeat(200)],
		])('answers %s without an FTS error', async (_case, q) => {
			await noteAt(0, { text: 'x near a b or text' })

			expect(() => search(q)).not.toThrow()
		})

		it('finds operator words as plain words', async () => {
			const note = await noteAt(0, { text: 'NEAR OR AND NOT', context: 'text column' })
			await noteAt(1, { text: 'unrelated' })

			expect([foundIds('NEAR OR'), foundIds('text:col'), foundIds('-NOT')]).toEqual([
				[note.id],
				[note.id],
				[note.id],
			])
		})

		it('answers an empty page for a search without words, never a list of every note', async () => {
			await noteAt(0)

			expect(search('🙂🙂')).toEqual({ notes: [], nextCursor: null, total: 0 })
		})
	})

	describe('selectMatches with orderBy', () => {
		it('orders the matches as asked, newest created first by default', async () => {
			const { db } = await createTestDb()
			const notes = noteRowFactory.transient({ db })
			const older = await notes.create({ text: 'Kafka', createdAt: capturedAt })

			const newer = await notes.create({
				text: 'Kafka',
				createdAt: new Date(capturedAt.getTime() + 60_000),
			})

			function ids(orderBy?: SQL[]) {
				return selectMatches(db, { match: '"kafka"*', where: undefined, limit: 10, orderBy })
					.all()
					.map(({ note }) => note.id)
			}

			expect([ids(), ids([asc(notesTable.createdAt)])]).toEqual([
				[newer.id, older.id],
				[older.id, newer.id],
			])
		})
	})

	describe('the search query', () => {
		it.each<[string, NotesQuery]>([
			['every match', {}],
			['a status after a cursor', { status: 'ready', cursor: { createdAt: 1, id: 7 } }],
		])('reads the index first and each note by its id for %s', async (_case, query) => {
			const { db } = await createTestDb()
			const matches = selectMatches(db, { match: '"kafka"*', where: noteFilters(query), limit: 51 })
			const rows = db.all<{ detail: string }>(sql`EXPLAIN QUERY PLAN ${matches.getSQL()}`)

			// FTS5 names a full-text MATCH plan `M` with the column of the table itself.
			expect(rows.map(({ detail }) => detail)).toEqual([
				'SCAN note_search VIRTUAL TABLE INDEX 0:M3',
				'SEARCH notes USING INTEGER PRIMARY KEY (rowid=?)',
				'USE TEMP B-TREE FOR ORDER BY',
			])
		})
	})
})
