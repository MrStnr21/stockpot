// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest } from 'bun:test'
import { listedNoteFactory, notesPageFactory } from '#tests/factories/listed-notes'
import { NotesHarness } from '#tests/setup/notes-controller'
import type { NotesFetchCall } from '#tests/setup/notes-fetch'

import { noFilters } from '../shared/filters'
import type { NoteRow } from '../shared/types'

const failure = { error: { code: 'internal', message: 'x' } }

function ids(rows: readonly NoteRow[]) {
	return rows.map(({ id }) => id)
}

describe('NotesController', () => {
	let harness: NotesHarness

	beforeEach(() => {
		jest.useFakeTimers()
	})

	afterEach(() => {
		harness.controller.destroy()
		jest.useRealTimers()
	})

	describe('bulk actions', () => {
		let rows: NoteRow[]

		beforeEach(() => {
			rows = [
				listedNoteFactory.build({ status: 'archived' }),
				listedNoteFactory.build({ status: 'new' }),
				listedNoteFactory.build({ status: 'read' }),
			]
			harness = new NotesHarness({
				initial: notesPageFactory.build({ notes: rows, nextCursor: 'c' }),
			})
			harness.select(rows[0].id, rows[1].id, rows[2].id)
		})

		it('sends once when pressed twice, and waits with every button', async () => {
			const first = harness.controller.run({ kind: 'research' })
			const second = harness.controller.run({ kind: 'archive' })

			expect(harness.requests.calls).toHaveLength(1)
			expect(harness.controller).toMatchObject({ running: 'research', canAct: false })

			harness.requests.call(0).answer({ results: [] })
			await Promise.all([first, second])

			expect(harness.requests.to('/api/notes')).toHaveLength(0)
			expect(harness.controller.running).toBeNull()
		})

		it('sends the selected ids in the order they were picked', () => {
			harness.controller.run({ kind: 'move', categoryId: 2 }).catch(() => null)

			expect(harness.requests.call(0).body).toEqual({ ids: ids(rows), categoryId: 2 })
		})

		it('changes no row before the answer', () => {
			harness.controller.run({ kind: 'archive' }).catch(() => null)

			expect(harness.controller.view.rows).toEqual(rows)
		})

		it('maps research outcomes, bringing archived notes back', async () => {
			const running = harness.controller.run({ kind: 'research' })

			harness.requests.call(0).answer({
				results: [
					{ id: rows[0].id, outcome: 'done' },
					{ id: rows[1].id, outcome: 'queued' },
					{ id: rows[2].id, outcome: 'done' },
				],
			})
			await running

			expect(harness.controller.view.rows.map(({ status }) => status)).toEqual([
				'ready',
				'queued',
				'read',
			])
			expect(harness.controller.selection).toEqual({ isActive: false, ids: [] })
			expect(harness.toast()).toBe('Researching 3 notes')
			expect(harness.requests.to('/api/notes/counts')).toHaveLength(1)
		})

		it('keeps conflicts selected and drops what left the filter, keeping the cursor', async () => {
			harness = new NotesHarness({
				initial: notesPageFactory.build({ notes: rows.slice(1), nextCursor: 'c' }),
				filters: { ...noFilters, status: 'new' },
			})
			harness.select(rows[0].id, rows[1].id, rows[2].id)

			const running = harness.controller.run({ kind: 'archive' })

			harness.requests.call(0).answer({
				results: [
					{ id: rows[0].id, outcome: 'not_found', note: null },
					{ id: rows[1].id, outcome: 'changed', note: { ...rows[1], status: 'archived' } },
					{ id: rows[2].id, outcome: 'conflict', note: { ...rows[2], status: 'queued' } },
				],
			})
			await running

			expect(ids(harness.controller.view.rows)).toEqual([rows[2].id])
			expect(harness.controller.view.nextCursor).toBe('c')
			expect(harness.controller.selection).toEqual({ isActive: true, ids: [rows[2].id] })
			expect(harness.controller.toasts.current).toMatchObject({
				title: 'Archived 1 note',
				detail: '1 note is being researched and was not archived. 1 note was deleted elsewhere.',
			})
		})

		it('names the category a move went to', async () => {
			const running = harness.controller.run({ kind: 'move', categoryId: 2 })

			harness.requests.call(0).answer({
				results: rows.map((row) => ({
					id: row.id,
					outcome: 'changed',
					note: { ...row, categoryId: 2 },
				})),
			})
			await running

			expect(harness.toast()).toBe('Moved 3 notes to Concept')
			expect(harness.controller.view.rows.map(({ categoryId }) => categoryId)).toEqual([2, 2, 2])
		})

		it.each([['research'], ['archive']] as const)(
			'tells the page once its notes changed after %s, without reloading the list',
			async (kind) => {
				const running = harness.controller.run({ kind })

				harness.requests.call(0).answer({ results: [] })
				await running

				const reloads = harness.requests.to('/api/notes').filter(({ method }) => method === 'GET')

				expect([harness.notesChanged, reloads]).toEqual([1, []])
			},
		)

		it.each<[string, (call: NotesFetchCall) => void]>([
			[
				'a 500',
				(call) => {
					call.answer(failure, 500)
				},
			],
			[
				'a 400',
				(call) => {
					call.answer(failure, 400)
				},
			],
			[
				'an unparsable answer',
				(call) => {
					call.respond(new Response('<html>'))
				},
			],
			[
				'a network error',
				(call) => {
					call.fail(new TypeError('Load failed'))
				},
			],
		])('changes nothing after %s and keeps the selection', async (_name, answer) => {
			const running = harness.controller.run({ kind: 'archive' })

			answer(harness.requests.call(0))
			await running

			expect(harness.controller.view.rows).toEqual(rows)
			expect(harness.controller.selection.ids).toEqual(ids(rows))
			expect(harness.toast()).toBe('Couldn’t reach your server. Nothing changed.')
			expect([harness.requests.calls.length, harness.notesChanged]).toEqual([1, 0])
		})

		it('sends a 401 to the sign-in page', async () => {
			const running = harness.controller.run({ kind: 'research' })

			harness.requests.call(0).answer(failure, 401)
			await running

			expect(harness.signIns).toBe(1)
			expect(harness.toast()).toBeUndefined()
		})

		it('lets no list answer sent before the bulk answer undo it', async () => {
			harness.controller.notesChanged()

			const running = harness.controller.run({ kind: 'archive' })
			const archive = harness.requests.last('/api/notes')

			archive.answer({
				results: rows.map((row) => ({
					id: row.id,
					outcome: 'changed',
					note: { ...row, status: 'archived' },
				})),
			})
			await running
			harness.requests.call(0).answer(notesPageFactory.build({ notes: rows }))

			expect(harness.requests.call(0).method).toBe('GET')
			expect(harness.controller.view.rows.map(({ status }) => status)).toEqual([
				'archived',
				'archived',
				'archived',
			])
		})

		it('asks again for a page the bulk request interrupted, after the answer', async () => {
			harness.controller.loadMore()

			const running = harness.controller.run({ kind: 'research' })

			expect(harness.requests.call(0).signal?.aborted).toBe(true)

			harness.requests.call(1).answer({ results: [] })
			await running

			expect(harness.requests.to('/api/notes').map(({ url }) => url)).toEqual([
				'/api/notes?cursor=c',
				'/api/notes?cursor=c',
			])
		})
	})
})
