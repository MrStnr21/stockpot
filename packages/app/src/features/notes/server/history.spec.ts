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

import { notes, type NoteStatus } from '#/server/db/schema/notes'

import { findTermRows, matchHistory } from './history'
import { learnAliases } from './learn'

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
			const known = [{ termId: row.id, state: 'known', note: null }]
			expect(matchHistory(db, 'Vessels')).toMatchObject(known)
			expect(matchHistory(db, row.term, false)).toMatchObject(known)

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

		it('uses the newest eligible note with the requested privacy', async () => {
			const { id: termId, term } = await termRowFactory.transient({ db }).create()
			const captures = noteRowFactory.transient({ db }).params({ termId })
			await captures.create({ createdAt: earlier })
			await captures.create({ createdAt: latest, status: 'archived' })
			await captures.create({ createdAt: latest, deletedAt: latest })
			await captures.create({ createdAt: latest, status: 'ready', firstShownAt: latest })
			const privateNote = await captures.create({ createdAt: later, isPrivate: true })
			const publicNote = await captures.create({ createdAt: later, status: 'ready' })

			const publicMatch = [{ state: 'saved', note: { id: publicNote.id } }]
			const privateMatch = [{ state: 'saved', note: { id: privateNote.id } }]
			expect(matchHistory(db, term)).toMatchObject(publicMatch)
			expect(matchHistory(db, term, false)).toMatchObject(publicMatch)
			expect(matchHistory(db, term, true)).toMatchObject(privateMatch)
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

		it('requires a live note or card to keep a term known', async () => {
			const { id: termId, term } = await termRowFactory.transient({ db }).create()
			const captures = noteRowFactory.transient({ db })
			const { id } = await captures.create({ termId, status: 'archived', isPrivate: true })
			const cards = explanationRowFactory.transient({ db })
			const known = [{ state: 'known', note: null, lastCard: null }]

			expect(matchHistory(db, term)).toMatchObject(known)
			db.update(notes).set({ deletedAt: latest }).where(eq(notes.id, id)).run()
			await cards.create({ termId, noteId: id })
			expect(matchHistory(db, term)).toEqual([])
			await cards.create({ termId, depth: 2 })
			expect(matchHistory(db, term)).toMatchObject(known)
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
			await captures.create({ termId: known.id, createdAt: earlier, status: 'archived' })
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

			expect(matchHistory(db, term)).toMatchObject([
				{
					state: 'known',
					note: null,
					lastCard: {
						id: lastCard.id,
						noteId: archived.id,
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
})
