// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { SettingsFetch } from '#tests/setup/settings-fetch'

import { en } from '#/lib/i18n/en'

import {
	CategoryEditor,
	newCategoryDraft,
	type CategoryDraft,
} from './category-editor-state.svelte'
import { createSettingsApi } from './settings-api'
import { SettingsToasts } from './settings-toasts.svelte'

const technology: CategoryDraft = {
	name: 'Technology',
	icon: 'tech',
	color: 'tech',
	format: 'technology',
	instructions: '',
	engine: null,
}

const record = {
	id: 2,
	name: 'Technology',
	icon: 'tech',
	color: 'tech',
	format: 'technology',
	instructions: '',
	position: 1,
}

const others = [
	{ id: 1, name: 'English' },
	{ id: 3, name: 'Concept' },
]

const strings = { ...en.settings.errors, nameTaken: en.settings.editor.nameTaken }

describe('CategoryEditor', () => {
	let requests: SettingsFetch
	let toasts: SettingsToasts
	let done: ReturnType<typeof mock<() => void>>

	function editor(id: number | null, initial: CategoryDraft, noteCount = 0) {
		return new CategoryEditor({
			id,
			initial,
			noteCount,
			others,
			api: createSettingsApi({ fetch: requests.fetch, signIn: mock<() => void>() }),
			toasts,
			strings,
			done,
		})
	}

	beforeEach(() => {
		requests = new SettingsFetch()
		toasts = new SettingsToasts()
		done = mock<() => void>()
	})

	afterEach(() => {
		toasts.destroy()
	})

	describe('an existing category', () => {
		let subject: CategoryEditor

		beforeEach(() => {
			subject = editor(2, technology)
		})

		it('cannot save until something changes', () => {
			expect(subject.canSave).toBe(false)

			subject.set('name', ' Technology ')

			expect(subject.canSave).toBe(false)

			subject.set('icon', 'flask')

			expect(subject.canSave).toBe(true)
		})

		it('sends only the changed fields, then goes back to the list', async () => {
			requests.answer({ ...record, name: 'Tech', format: 'brief' })
			subject.set('name', '  Tech ')
			subject.set('format', 'brief')

			await subject.save()

			expect(requests.calls).toEqual([
				{ url: '/api/categories/2', method: 'PATCH', body: { name: 'Tech', format: 'brief' } },
			])
			expect(done).toHaveBeenCalledTimes(1)
		})

		it('sends the engine only when it changed', async () => {
			subject.set('engine', 'openai-compatible')

			await subject.save()

			expect(requests.calls).toEqual([
				{
					url: '/api/categories/2/engine',
					method: 'PUT',
					body: { engine: 'openai-compatible' },
				},
			])
			expect(done).toHaveBeenCalledTimes(1)
		})

		it('shows a taken name under Name and keeps the form', async () => {
			requests.refuse(409, 'category_exists')
			subject.set('name', 'English')

			await subject.save()

			expect(subject.nameError).toBe('A category already has that name')
			expect(subject.draft.name).toBe('English')
			expect(toasts.current).toBeNull()
			expect(done).not.toHaveBeenCalled()
		})

		it('shows a toast for any other failure', async () => {
			requests.fail()
			subject.set('color', 'idea')

			await subject.save()

			expect(toasts.current).toMatchObject({ title: 'Could not save. Try again' })
			expect(done).not.toHaveBeenCalled()
		})

		it('sends only the engine on a retry after the fields were saved', async () => {
			requests.answer({ ...record, color: 'idea' }).refuse(500, 'internal')
			subject.set('color', 'idea')
			subject.set('engine', 'gemini')
			await subject.save()
			requests.empty()

			await subject.save()

			expect(requests.calls.map(({ method }) => method)).toEqual(['PATCH', 'PUT', 'PUT'])
			expect(done).toHaveBeenCalledTimes(1)
		})
	})

	describe('a new category', () => {
		let subject: CategoryEditor

		beforeEach(() => {
			subject = editor(null, newCategoryDraft)
		})

		it('needs a name', () => {
			subject.set('icon', 'leaf')

			expect(subject.canSave).toBe(false)
		})

		it('creates it without an engine call when the engine is the default', async () => {
			requests.answer({ ...record, id: 7, name: 'Cooking' }, 201)
			subject.set('name', 'Cooking')

			await subject.save()

			expect(requests.calls).toEqual([
				{
					url: '/api/categories',
					method: 'POST',
					body: {
						name: 'Cooking',
						icon: 'other',
						color: 'other',
						format: 'brief',
						instructions: '',
					},
				},
			])
			expect(done).toHaveBeenCalledTimes(1)
		})

		it('sets the engine of the category it created', async () => {
			requests.answer({ ...record, id: 7, name: 'Cooking' }, 201)
			subject.set('name', 'Cooking')
			subject.set('engine', 'agent-command')

			await subject.save()

			expect(requests.call(1)).toEqual({
				url: '/api/categories/7/engine',
				method: 'PUT',
				body: { engine: 'agent-command' },
			})
		})
	})

	describe('delete', () => {
		it('deletes a category without notes', async () => {
			const subject = editor(2, technology)

			subject.askDelete()
			await subject.confirmDelete()

			expect(requests.calls).toEqual([{ url: '/api/categories/2', method: 'DELETE', body: null }])
			expect(done).toHaveBeenCalledTimes(1)
		})

		it('moves the notes to the picked category', async () => {
			const subject = editor(2, technology, 23)

			subject.askDelete()

			expect(subject.question).toEqual({ notes: 23, moveTo: 1 })

			subject.pickTarget(3)
			await subject.confirmDelete()

			expect(requests.call(0).url).toBe('/api/categories/2?moveTo=3')
		})

		it('asks again when notes were filed meanwhile', async () => {
			const subject = editor(2, technology)

			requests.refuse(409, 'category_in_use', { notes: 2 })
			subject.askDelete()
			await subject.confirmDelete()

			expect(subject.question).toEqual({ notes: 2, moveTo: 1 })
			expect(done).not.toHaveBeenCalled()
		})

		it('keeps the question and shows a toast when the delete fails', async () => {
			const subject = editor(2, technology)

			requests.fail()
			subject.askDelete()
			await subject.confirmDelete()

			expect(subject.question).not.toBeNull()
			expect(toasts.current).toMatchObject({ title: 'Could not delete. Try again' })
		})
	})
})
