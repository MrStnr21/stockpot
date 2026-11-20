// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'
import { categoryRowFactory } from '#tests/factories/categories'
import { explanationRowFactory } from '#tests/factories/explanations'
import { noteRowFactory } from '#tests/factories/notes'
import { configuredSettingsFactory } from '#tests/factories/settings'
import { termRowFactory } from '#tests/factories/terms'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { eq } from 'drizzle-orm'

import { formats } from '#/features/research/shared/formats'
import { categories, notes } from '#/server/db/schema/notes'

import { assemble } from './assemble'

const { cardLanguage } = configuredSettingsFactory.build()

describe('assemble', () => {
	let db: TestDb

	beforeEach(async () => {
		;({ db } = await createTestDb())
	})

	function task(noteId: number) {
		return assemble(db, { noteId, language: () => cardLanguage })
	}

	function status(noteId: number) {
		return db.select({ status: notes.status }).from(notes).where(eq(notes.id, noteId)).get()?.status
	}

	it('skips missing, deleted and archived notes', async () => {
		const captures = noteRowFactory.transient({ db })
		const deleted = await captures.create({ deletedAt: faker.date.past() })
		const archived = await captures.create({ status: 'archived' })

		expect([task(archived.id + 1), task(deleted.id), task(archived.id)]).toEqual([null, null, null])
		expect([status(deleted.id), status(archived.id)]).toEqual(['new', 'archived'])
	})

	it.each(['new', 'queued', 'researching', 'failed', 'ready', 'read'] as const)(
		'skips a completed first card when the note is %s',
		async (initial) => {
			const note = await noteRowFactory.transient({ db }).create({ status: initial })
			await explanationRowFactory.transient({ db }).create({ noteId: note.id })
			expect(task(note.id)).toBeNull()
			expect(status(note.id)).toBe(initial === 'read' ? 'read' : 'ready')
		},
	)

	it('uses the note category before the term category and assembles the report', async () => {
		const choices = categoryRowFactory.transient({ db })
		const termCategory = await choices.create({ format: 'brief' })
		const instructions = faker.lorem.sentence()
		const category = await choices.create({ format: 'report', instructions: `  ${instructions}  ` })
		const term = await termRowFactory.transient({ db }).create({ categoryId: termCategory.id })

		const note = await noteRowFactory.transient({ db }).create({
			termId: term.id,
			categoryId: category.id,
			url: faker.internet.url(),
		})

		const assembled = task(note.id)
		expect(assembled).toMatchObject({
			noteId: note.id,
			categoryId: category.id,
			input: {
				task: 'research',
				depth: 1,
				previous: [],
				language: cardLanguage,
				note: {
					term: term.term,
					text: note.text,
					context: note.context,
					url: note.url,
					isPrivate: false,
				},
				category: { name: category.name, instructions },
				output: { id: 'report' },
			},
		})
		expect(assembled?.input.output.schema).toBe(formats.report.levels[1].schema)
		expect(status(note.id)).toBe('researching')
	})

	it('uses the term category and omits repeated text and blank instructions', async () => {
		const category = await categoryRowFactory
			.transient({ db })
			.create({ format: 'concept', instructions: '  ' })

		const term = await termRowFactory.transient({ db }).create({ categoryId: category.id })
		const note = await noteRowFactory.transient({ db }).create({ termId: term.id, text: term.term })
		expect(task(note.id)).toMatchObject({
			categoryId: category.id,
			input: {
				task: 'explain',
				note: { term: term.term, text: null },
				category: { instructions: null },
			},
		})
	})

	it('prefers brief, then the lowest position and id, and uses the text without a term', async () => {
		const choices = categoryRowFactory.transient({ db })
		await choices.create({ format: 'concept', position: -3 })
		await choices.create({ format: 'brief', position: -1 })
		const brief = await choices.create({ format: 'brief', position: -2 })
		await choices.create({ format: 'brief', position: -2 })
		const note = await noteRowFactory.transient({ db }).create()
		expect(task(note.id)).toMatchObject({
			categoryId: brief.id,
			input: { note: { term: note.text, text: null }, output: { id: 'brief' } },
		})
	})

	it('uses the first category by position when none uses brief', async () => {
		db.delete(categories).run()
		const choices = categoryRowFactory.transient({ db })
		await choices.create({ format: 'vocabulary', position: 2 })
		const first = await choices.create({ format: 'technology', position: 1 })
		const note = await noteRowFactory.transient({ db }).create()
		expect(task(note.id)?.categoryId).toBe(first.id)
	})

	it('fails a note when no category exists', async () => {
		db.delete(categories).run()
		const note = await noteRowFactory.transient({ db }).create()
		expect(task(note.id)).toBeNull()
		expect(status(note.id)).toBe('failed')
	})

	it('assembles only the term from a private note', async () => {
		const term = await termRowFactory.transient({ db }).create()
		const context = faker.lorem.sentence()
		const url = faker.internet.url()

		const note = await noteRowFactory
			.transient({ db })
			.create({ termId: term.id, isPrivate: true, context, url })

		const input = task(note.id)?.input
		expect(input).toMatchObject({
			note: { term: term.term, text: null, url: null, context: null, isPrivate: true },
			previous: [],
		})
		const serialized = JSON.stringify(input)
		expect(serialized).not.toContain(note.text)
		expect(serialized).not.toContain(context)
		expect(serialized).not.toContain(url)
	})

	it('keeps the text of a private note local when it has no term', async () => {
		const note = await noteRowFactory.transient({ db }).create({ isPrivate: true })
		expect(task(note.id)).toBeNull()
		expect(status(note.id)).toBe('failed')
	})

	it.each(['read', 'ready'] as const)(
		'prepares a draft redo and keeps the %s status',
		async (initial) => {
			const note = await noteRowFactory.transient({ db }).create({ status: initial })
			const cards = explanationRowFactory.transient({ db }).params({ noteId: note.id })
			await cards.create({ isDraft: true })
			await cards.create({ depth: 2 })
			expect(task(note.id)).not.toBeNull()
			expect(status(note.id)).toBe(initial)
		},
	)
})
