// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'
import { aliasRowFactory, termRowFactory } from '#tests/factories/terms'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { asc, eq } from 'drizzle-orm'

import { aliases, terms } from '#/server/db/schema/notes'

import { learnAliases, learnSense } from './learn'

describe('learning from cards', () => {
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
			const own = [' “Queries” ', 'query', 'querie', 'querys']
			const seeded = ['K8s', 'Kubernetes', 'JavaScripts', 'Localizations']

			expect(learnAliases(db, id, [...invalid, ...own, ...seeded])).toEqual([])
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
			const rows = termRowFactory.transient({ db })
			const { id } = await rows.create({ term: 'store' })
			await rows.create({ term: 'cache' })

			expect(learnAliases(db, id, ['Cache', 'caches'])).toEqual([])
			expect(db.select().from(aliases).all()).toEqual([])
		})

		it('skips an alias of another term and forms that would match it', async () => {
			const rows = termRowFactory.transient({ db })
			const { id } = await rows.create({ term: 'store' })
			const { id: termId } = await rows.create({ term: 'buffer' })
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

	describe('learnSense', () => {
		let db: TestDb
		let sqlite: Database

		beforeEach(async () => {
			;({ db, sqlite } = await createTestDb())
		})

		afterEach(() => {
			sqlite.close()
		})

		function storedTerms() {
			return db.select().from(terms).orderBy(asc(terms.id)).all()
		}

		it('fills an empty meaning with the trimmed sense', async () => {
			const row = await termRowFactory.transient({ db }).create()
			const sense = faker.lorem.words(3)

			learnSense(db, row.id, `  ${sense} `)

			expect(storedTerms()).toMatchObject([{ id: row.id, term: row.term, meaning: sense }])
		})

		it('keeps a meaning the term already has', async () => {
			const row = await termRowFactory.transient({ db }).create({ meaning: faker.lorem.words(2) })

			learnSense(db, row.id, faker.lorem.words(3))

			expect(storedTerms()).toEqual([row])
		})

		it('changes nothing when another row of the term holds the sense', async () => {
			const rows = termRowFactory.transient({ db })
			const sense = faker.lorem.words(3)
			const unsensed = await rows.create()
			const holder = await rows.create({ term: unsensed.term, meaning: sense })

			learnSense(db, unsensed.id, sense)

			expect(storedTerms()).toEqual([unsensed, holder])
		})

		it.each(['', '   '])('ignores the blank sense %p', async (sense) => {
			const row = await termRowFactory.transient({ db }).create()

			learnSense(db, row.id, sense)

			expect(storedTerms()).toEqual([row])
		})

		it('creates no row for an unknown term id', () => {
			learnSense(db, faker.number.int({ min: 1, max: 1000 }), faker.lorem.words(3))

			expect(storedTerms()).toEqual([])
		})
	})
})
