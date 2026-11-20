// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'
import { categoryRowFactory } from '#tests/factories/categories'
import { explanationRowFactory } from '#tests/factories/explanations'
import { noteRowFactory } from '#tests/factories/notes'
import { aliasRowFactory, termRowFactory } from '#tests/factories/terms'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { eq } from 'drizzle-orm'

import { aliases, type NoteStatus } from '#/server/db/schema/notes'

import { findMergeTarget, findTermRows, learnAliases, matchHistory } from './history'

const earlier = new Date('2026-11-18T08:00:00Z')

const later = new Date('2026-11-19T08:00:00Z')

const latest = new Date('2026-11-20T08:00:00Z')

describe('term history', () => {
	describe('matchHistory', () => {
		let db: TestDb
		let sqlite: Database

		beforeEach(async () => {
			;({ db, sqlite } = await createTestDb())
		})

		afterEach(() => {
			sqlite.close()
		})

		it.each(['', '!?', 'unmatched'])('returns no history for %p', (text) => {
			expect(matchHistory(db, text)).toEqual([])
		})

		it('returns no history for an idea too long to be a term', async () => {
			const term = faker.string.alpha({ length: 81, casing: 'lower' })
			await termRowFactory.transient({ db }).create({ term })

			expect(matchHistory(db, term)).toEqual([])
		})

		it.each([
			['queries', ' “QUERY?” '],
			['query', 'Queries'],
			['kubernetes', 'k8s'],
			['k8s', 'Kubernetes'],
		])('finds a merge target for %s when captured as %s', async (term, text) => {
			const row = await termRowFactory.transient({ db }).create({ term })
			const { id } = await noteRowFactory.transient({ db }).create({ termId: row.id })

			expect(matchHistory(db, text)).toMatchObject([
				{ termId: row.id, state: 'saved', note: { id } },
			])
		})

		it('only offers shown notes for matches through a learned alias', async () => {
			const row = await termRowFactory.transient({ db }).create({ term: 'container' })
			const captures = noteRowFactory.transient({ db }).params({ termId: row.id, isPrivate: true })
			await captures.create({ createdAt: latest })

			expect(learnAliases(db, row.id, [' “Vessel!” '])).toEqual(['vessel'])
			expect(findTermRows(db, 'vessels')).toEqual([{ row, learned: true }])
			expect(matchHistory(db, 'Vessels')).toMatchObject([
				{ termId: row.id, state: 'known', note: null },
			])

			await captures.create({ createdAt: earlier, status: 'read' })
			const { id, text } = await captures.create({ createdAt: later, status: 'read' })

			expect(matchHistory(db, 'Vessels')).toMatchObject([
				{ state: 'seen', note: { id, text, status: 'read', private: true, createdAt: later } },
			])
		})

		it.each<NoteStatus>(['new', 'queued', 'researching', 'ready', 'failed'])(
			'treats an unshown %s note as saved',
			async (status) => {
				const { id: termId, term } = await termRowFactory.transient({ db }).create()
				const { id } = await noteRowFactory.transient({ db }).create({ termId, status })

				expect(matchHistory(db, term)).toMatchObject([{ state: 'saved', note: { id, status } }])
			},
		)

		it('uses the oldest eligible note and can restrict the target by privacy', async () => {
			const { id: termId, term } = await termRowFactory.transient({ db }).create()
			const captures = noteRowFactory.transient({ db }).params({ termId })
			await captures.create({ createdAt: earlier, status: 'archived' })
			await captures.create({ createdAt: earlier, deletedAt: later })
			await captures.create({ createdAt: earlier, status: 'read' })
			await captures.create({ createdAt: earlier, status: 'ready', firstShownAt: later })
			const oldest = await captures.create({ createdAt: later, status: 'failed', isPrivate: true })
			const publicNote = await captures.create({ createdAt: later, status: 'ready' })
			await captures.create({ createdAt: latest })

			expect(matchHistory(db, term)).toMatchObject([{ state: 'saved', note: { id: oldest.id } }])
			expect(findMergeTarget(db, termId, true)).toMatchObject({ id: oldest.id })
			expect(findMergeTarget(db, termId, false)).toMatchObject({ id: publicNote.id })
		})

		it.each<[NoteStatus, Date | null]>([
			['read', null],
			['ready', later],
			['archived', later],
		])(
			'uses the newest shown %s note when there is no merge target',
			async (status, firstShownAt) => {
				const { id: termId, term } = await termRowFactory.transient({ db }).create()
				const captures = noteRowFactory.transient({ db }).params({ termId })
				await captures.create({ status: 'read', createdAt: earlier, firstShownAt: latest })
				const { id } = await captures.create({ status, createdAt: later, firstShownAt })
				await captures.create({ status: 'archived', createdAt: latest })
				await captures.create({ status: 'read', createdAt: latest, deletedAt: latest })

				expect(matchHistory(db, term)).toMatchObject([{ state: 'seen', note: { id, status } }])
			},
		)

		it('keeps a term known when it has only an unshown archive and a deleted note', async () => {
			const { id: termId, term } = await termRowFactory.transient({ db }).create()
			const captures = noteRowFactory.transient({ db }).params({ termId })
			await captures.create({ status: 'archived' })
			await captures.create({ status: 'read', deletedAt: latest })

			expect(matchHistory(db, term)).toMatchObject([{ state: 'known', note: null, lastCard: null }])
		})

		it('deduplicates senses and sorts them by their newest non-deleted notes', async () => {
			const { id: categoryId } = await categoryRowFactory.transient({ db }).create()
			const senses = termRowFactory.transient({ db }).params({ term: 'cache' })
			const seen = await senses.create({ meaning: 'a store of computed results' })
			const saved = await senses.create({ meaning: 'a hidden supply', categoryId })
			const known = await senses.create({ meaning: '' })
			await aliasRowFactory.transient({ db }).create({ alias: 'caches', termId: saved.id })
			const captures = noteRowFactory.transient({ db })
			await captures.create({ termId: known.id, createdAt: latest, deletedAt: latest })
			const read = await captures.create({ termId: seen.id, createdAt: later, status: 'read' })
			const unread = await captures.create({ termId: saved.id, createdAt: earlier })
			await captures.create({ termId: saved.id, createdAt: later, status: 'archived' })

			expect(findTermRows(db, 'caches')).toContainEqual({ row: saved, learned: false })
			expect(matchHistory(db, 'Caches')).toMatchObject([
				{
					termId: saved.id,
					meaning: saved.meaning,
					categoryId,
					state: 'saved',
					note: { id: unread.id },
				},
				{ termId: seen.id, meaning: seen.meaning, state: 'seen', note: { id: read.id } },
				{ termId: known.id, meaning: '', state: 'known', note: null },
			])
		})

		it('returns the newest depth-one card across the term and its non-deleted notes', async () => {
			const { id: termId, term } = await termRowFactory.transient({ db }).create()
			const captures = noteRowFactory.transient({ db })
			const archived = await captures.create({ termId, status: 'archived' })
			const deleted = await captures.create({ deletedAt: latest })
			const cards = explanationRowFactory.transient({ db })
			await cards.create({ termId, createdAt: later })

			const lastCard = await cards.create({
				noteId: archived.id,
				createdAt: later,
				sources: [{ title: faker.lorem.words(), url: faker.internet.url() }],
				isUncertain: true,
				isDraft: true,
			})

			await cards.create({ termId, createdAt: latest, depth: 2 })
			await cards.create({ termId, noteId: deleted.id, createdAt: latest })

			expect(matchHistory(db, term)).toEqual([
				{
					termId,
					term,
					meaning: '',
					categoryId: null,
					state: 'known',
					note: null,
					lastCard: {
						id: lastCard.id,
						noteId: archived.id,
						format: lastCard.format,
						body: lastCard.body,
						sources: lastCard.sources,
						isUncertain: true,
						isDraft: true,
						createdAt: later,
					},
				},
			])
		})

		it('returns a newer term-level card for a seen term', async () => {
			const { id: termId, term } = await termRowFactory.transient({ db }).create()
			const note = await noteRowFactory.transient({ db }).create({ termId, status: 'read' })
			const cards = explanationRowFactory.transient({ db })
			const lastCard = await cards.create({ termId, createdAt: later })
			await cards.create({ noteId: note.id, termId, createdAt: earlier })

			expect(matchHistory(db, term)).toMatchObject([
				{ state: 'seen', lastCard: { id: lastCard.id, noteId: null } },
			])
		})
	})

	describe('learnAliases', () => {
		let db: TestDb
		let sqlite: Database

		beforeEach(async () => {
			;({ db, sqlite } = await createTestDb())
		})

		afterEach(() => {
			sqlite.close()
		})

		it('stores nothing for an unknown term id', () => {
			const termId = faker.number.int({ min: 1, max: 1000 })
			const { alias } = aliasRowFactory.build()

			expect(learnAliases(db, termId, [alias])).toEqual([])
			expect(db.select().from(aliases).all()).toEqual([])
		})

		it('skips invalid text, the term and its variants, and both sides of seeded pairs', async () => {
			const { id } = await termRowFactory.transient({ db }).create({ term: 'queries' })
			const invalid = ['', '!?', faker.string.alpha(81)]
			const reserved = [' “Queries” ', 'query', 'querie', 'querys', 'K8s', 'Kubernetes']

			expect(learnAliases(db, id, [...invalid, ...reserved])).toEqual([])
			expect(db.select().from(aliases).all()).toEqual([])
		})

		it.each([
			[' Go! ', 'golang'],
			['Apple', 'apple inc'],
			['Rust', 'rust language'],
			['Language', 'rust language'],
		])('skips short or partial aliases such as %p for %s', async (alias, term) => {
			const { id } = await termRowFactory.transient({ db }).create({ term })

			expect(learnAliases(db, id, [alias])).toEqual([])
			expect(db.select().from(aliases).all()).toEqual([])
		})

		it('skips a term owned by another row and forms that would match it', async () => {
			const terms = termRowFactory.transient({ db })
			const { id } = await terms.create({ term: 'store' })
			await terms.create({ term: 'cache' })

			expect(learnAliases(db, id, ['Cache', 'caches'])).toEqual([])
			expect(db.select().from(aliases).all()).toEqual([])
		})

		it('skips an alias of another term and forms that would match it', async () => {
			const terms = termRowFactory.transient({ db })
			const { id } = await terms.create({ term: 'store' })
			const { id: termId } = await terms.create({ term: 'buffer' })
			const alias = await aliasRowFactory.transient({ db }).create({ alias: 'cache', termId })

			expect(learnAliases(db, id, ['Cache', 'caches'])).toEqual([])
			expect(db.select().from(aliases).all()).toEqual([alias])
		})

		it('returns only newly stored aliases across duplicate inputs and repeat calls', async () => {
			const { id: termId } = await termRowFactory.transient({ db }).create({ term: 'container' })

			expect(learnAliases(db, termId, [' “Vessel.” ', 'vessel', 'Reservoir'])).toEqual([
				'vessel',
				'reservoir',
			])
			expect(learnAliases(db, termId, ['VESSEL', 'reservoir', 'Tub'])).toEqual(['tub'])
			expect(learnAliases(db, termId, ['tub'])).toEqual([])
			expect(db.select().from(aliases).where(eq(aliases.termId, termId)).all()).toHaveLength(3)
		})

		it('stops after storing the tenth alias even when a request repeats an existing alias', async () => {
			const { id: termId } = await termRowFactory.transient({ db }).create({ term: 'container' })
			const existing = await aliasRowFactory.transient({ db }).create({ termId, alias: 'vessel' })
			await aliasRowFactory.transient({ db }).createList(8, { termId })

			expect(learnAliases(db, termId, [existing.alias, 'reservoir', 'tank'])).toEqual(['reservoir'])
			expect(learnAliases(db, termId, ['tank'])).toEqual([])
			expect(db.select().from(aliases).where(eq(aliases.termId, termId)).all()).toHaveLength(10)
		})
	})
})
