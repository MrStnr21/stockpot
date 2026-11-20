// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'
import { briefCardFactory } from '#tests/factories/cards'
import { categoryRowFactory } from '#tests/factories/categories'
import { explanationRowFactory } from '#tests/factories/explanations'
import { noteRowFactory } from '#tests/factories/notes'
import { configuredSettingsFactory } from '#tests/factories/settings'
import { termRowFactory } from '#tests/factories/terms'
import { createTestDb, type TestDb } from '#tests/setup/db'
import { eq } from 'drizzle-orm'

import { explanations } from '#/server/db/schema/explanations'
import { notes } from '#/server/db/schema/notes'
import { promptVersion } from '#/server/engines/prompt'

import { assemble, type ResearchTask } from './assemble'
import { save } from './save'

function answer() {
	return {
		output: briefCardFactory.build({ uncertain: true }),
		engine: 'gemini',
		model: configuredSettingsFactory.build().engines.gemini.models.standard,
		searchSuggestions: `<div>${faker.lorem.sentence()}</div>`,
		elapsedMs: faker.number.int({ min: 1, max: 1000 }),
		draft: false as const,
	}
}

describe('save', () => {
	let db: TestDb
	let task: ResearchTask

	beforeEach(async () => {
		;({ db } = await createTestDb())
		const term = await termRowFactory.transient({ db }).create()
		const note = await noteRowFactory.transient({ db }).create({ termId: term.id })

		const assembled = assemble(db, {
			noteId: note.id,
			language: () => configuredSettingsFactory.build().cardLanguage,
		})

		if (assembled === null) {
			throw new Error('Expected a research task')
		}

		task = assembled
	})

	function savedCards() {
		return db
			.select()
			.from(explanations)
			.where(eq(explanations.noteId, task.noteId))
			.orderBy(explanations.depth)
			.all()
	}

	it('files the card with the current term, prompt version, sources, grounding HTML and uncertainty', async () => {
		const term = await termRowFactory.transient({ db }).create()
		db.update(notes).set({ termId: term.id }).where(eq(notes.id, task.noteId)).run()
		const result = answer()
		expect(save(db, task, result)).toEqual({ termId: term.id })
		const { sources, uncertain, ...body } = result.output
		const [card] = savedCards()
		expect(card).toMatchObject({
			noteId: task.noteId,
			termId: term.id,
			format: 'brief',
			depth: 1,
			language: task.input.language,
			sources,
			isUncertain: uncertain,
			isDraft: false,
			engine: result.engine,
			model: result.model,
			searchSuggestions: result.searchSuggestions,
			promptVersion,
		})
		expect(card.body).toEqual(body)
		expect(db.select().from(notes).where(eq(notes.id, task.noteId)).get()).toMatchObject({
			categoryId: task.categoryId,
			status: 'ready',
		})
	})

	it('replaces only the drafts for this note at depth one', async () => {
		const cards = explanationRowFactory.transient({ db })
		const deeper = await cards.create({ noteId: task.noteId, depth: 2, isDraft: true })
		const other = await noteRowFactory.transient({ db }).create()
		const otherDraft = await cards.create({ noteId: other.id, isDraft: true })
		const result = answer()
		save(db, task, { ...result, draft: true, redoAt: faker.date.future() })
		expect(savedCards()).toMatchObject([{ isDraft: true }, deeper])
		expect(db.select().from(notes).where(eq(notes.id, task.noteId)).get()?.status).toBe('ready')
		const redo = answer()
		save(db, task, { ...redo, searchSuggestions: null })
		expect(savedCards()).toMatchObject([
			{ isDraft: false, sources: redo.output.sources, searchSuggestions: null },
			deeper,
		])
		expect(db.select().from(explanations).where(eq(explanations.id, otherDraft.id)).get()).toEqual(
			otherDraft,
		)
	})

	it.each(['archived', 'read'] as const)(
		'keeps the owner’s %s status and category',
		async (status) => {
			const category = await categoryRowFactory.transient({ db }).create()
			db.update(notes)
				.set({ status, categoryId: category.id })
				.where(eq(notes.id, task.noteId))
				.run()
			save(db, task, answer())
			expect(savedCards()).toHaveLength(1)
			expect(db.select().from(notes).where(eq(notes.id, task.noteId)).get()).toMatchObject({
				status,
				categoryId: category.id,
			})
		},
	)

	it('discards the result and retains the draft when the note was soft-deleted', async () => {
		const draft = await explanationRowFactory
			.transient({ db })
			.create({ noteId: task.noteId, isDraft: true })

		db.update(notes).set({ deletedAt: faker.date.past() }).where(eq(notes.id, task.noteId)).run()
		expect(save(db, task, answer())).toBeNull()
		expect(savedCards()).toEqual([draft])
	})

	it('discards the result when the note no longer exists', () => {
		db.delete(notes).where(eq(notes.id, task.noteId)).run()
		expect(save(db, task, answer())).toBeNull()
		expect(savedCards()).toEqual([])
	})
})
