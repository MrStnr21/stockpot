// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import {
	cardInputFactory,
	privateNoteFactory,
	suggestInputFactory,
} from '#tests/factories/engine-input'

import { redactPrivate } from './contract'
import { buildPrompt } from './prompt'

const searching = { canSearch: true }

describe('buildPrompt', () => {
	describe('for a card', () => {
		const input = redactPrivate(cardInputFactory.build({ language: 'ru' }))
		const prompt = buildPrompt(input, searching)

		it('puts the sections in the documented order', () => {
			const headings = prompt.split('\n').filter((line) => line.startsWith('# '))

			expect(headings).toEqual([
				'# Rules',
				'# Task',
				'# Format',
				'# Category',
				'# Note',
				'# Earlier cards',
			])
		})

		it('names the card language', () => {
			expect(prompt).toContain('Write for the reader in Russian (ru).')
		})

		it('carries the note, the category and the earlier cards', () => {
			expect(prompt).toContain(`Term: ${input.note.term}`)
			expect(prompt).toContain(`As typed: ${input.note.text}`)
			expect(prompt).toContain(input.category.instructions ?? '')
			expect(prompt).toContain(JSON.stringify(input.previous))
		})

		it('keeps the JSON Schema out of the prompt', () => {
			expect(prompt).not.toContain('"additionalProperties"')
		})
	})

	describe('for a private note', () => {
		const input = redactPrivate(cardInputFactory.build({ note: privateNoteFactory.build() }))
		const prompt = buildPrompt(input, searching)

		it('gives only the term', () => {
			expect(prompt).toEndWith(`# Note\nTerm: ${input.note.term}`)
			expect(prompt).not.toContain('As typed:')
			expect(prompt).not.toContain('# Earlier cards')
		})
	})

	describe('for a suggestion', () => {
		const prompt = buildPrompt(redactPrivate(suggestInputFactory.build()), searching)

		it('lists the categories with their hints', () => {
			expect(prompt).toContain(
				'- technology: Technology\n- english: English, Words and phrases to learn',
			)
		})
	})

	describe('for an engine that cannot search', () => {
		const prompt = buildPrompt(redactPrivate(cardInputFactory.build()), { canSearch: false })

		it('asks for no sources', () => {
			expect(prompt).toContain('leave every list of sources empty')
			expect(prompt).not.toContain('Link only to pages you opened')
		})
	})
})
