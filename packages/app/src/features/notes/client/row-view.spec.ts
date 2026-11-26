// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'
import { listedNoteFactory } from '#tests/factories/listed-notes'

import { en } from '#/lib/i18n/en'
import { ru } from '#/lib/i18n/ru'

import { listStatuses, type NotesCategory } from '../shared/types'
import type { NotesStrings } from './notes-controller.svelte'
import { otherLook, rowView, statusLabels } from './row-view'

const technology: NotesCategory = { id: 1, name: 'Technology', color: 'tech', icon: 'tech' }

const categories = new Map([[technology.id, technology]])

describe('a row of the notes list', () => {
	it('wears its category’s look, and the Other look without a known category', () => {
		const looks = [1, 7, null].map(
			(categoryId) => rowView(listedNoteFactory.build({ categoryId }), categories).look,
		)

		expect(looks).toEqual([{ color: 'tech', icon: 'tech' }, otherLook, otherLook])
	})

	it('shows the card’s sense, else where the note was seen, else nothing', () => {
		const sense = faker.lorem.words(3)
		const context = faker.lorem.sentence()

		const subtitles = [
			{ sense, context },
			{ sense: null, context },
			{ sense: ' ', context: null },
		].map((fields) => rowView(listedNoteFactory.build(fields), categories).subtitle)

		expect(subtitles).toEqual([sense, context, null])
	})

	it('shows the snippet in search results instead of the sense', () => {
		const snippet = [
			{ text: '…serves them and ', match: false },
			{ text: 'stream', match: true },
		]

		const view = rowView(listedNoteFactory.build({ sense: 'a runner', snippet }), categories)

		expect(view).toMatchObject({ segments: snippet, subtitle: null })
	})

	it('labels every status in both languages', () => {
		for (const strings of [en.notes, ru.notes]) {
			const labels = statusLabels(strings)

			expect(listStatuses.every((status) => labels[status].length > 0)).toBe(true)
		}
	})

	it('carries every text the list’s logic writes in both languages', () => {
		const catalogs: NotesStrings[] = [en.notes, ru.notes]

		expect(catalogs.every((strings) => strings.selectLimitToast.length > 0)).toBe(true)
	})
})
