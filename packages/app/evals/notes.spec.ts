// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $, write } from 'bun'
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadNotes, mergeLocal, parseNotes, type EvalNote } from './notes'

function noteLine(overrides: Partial<EvalNote> = {}): string {
	return JSON.stringify({
		id: 'albeit',
		text: 'albeit',
		context: null,
		url: null,
		private: false,
		language: 'en',
		source: 'composed',
		expected: { format: 'vocabulary' },
		tests: 'A formal conjunction.',
		...overrides,
	})
}

describe('eval notes', () => {
	describe('parseNotes', () => {
		it('fills in the optional expectations', () => {
			expect(parseNotes(noteLine(), 'notes.jsonl')).toEqual([
				{
					id: 'albeit',
					text: 'albeit',
					context: null,
					url: null,
					private: false,
					language: 'en',
					source: 'composed',
					expected: { format: 'vocabulary', alsoAccept: [], senses: [], uncertain: false },
					tests: 'A formal conjunction.',
				},
			])
		})

		it('names the line of a note that breaks the schema', () => {
			const text = `${noteLine()}\n\n${noteLine({ id: 'bad', language: 'english' })}`

			expect(() => parseNotes(text, 'notes.jsonl')).toThrow('notes.jsonl:3: language')
		})

		it('rejects a line that is not JSON', () => {
			expect(() => parseNotes('{', 'notes.jsonl')).toThrow('notes.jsonl:1:')
		})
	})

	describe('mergeLocal', () => {
		const notes = parseNotes(noteLine({ id: 'ferritin', private: true }), 'notes.jsonl')

		it('adds private details to a public note', () => {
			const merged = mergeLocal(notes, [{ id: 'ferritin', context: 'from a lab report' }])

			expect(merged).toMatchObject([{ id: 'ferritin', context: 'from a lab report', url: null }])
		})

		it('adds a whole local note to the set', () => {
			const local = parseNotes(noteLine({ id: 'local-only' }), 'local.jsonl')

			expect(mergeLocal(notes, local).map(({ id }) => id)).toEqual(['ferritin', 'local-only'])
		})

		it('rejects an addition to a note that does not exist', () => {
			expect(() => mergeLocal(notes, [{ id: 'missing', context: 'x' }])).toThrow('names no public')
		})

		it('rejects a whole note listed twice', () => {
			expect(() => mergeLocal(notes, notes)).toThrow('listed twice')
		})

		it('rejects an id listed twice in the public notes', () => {
			expect(() => mergeLocal([...notes, ...notes], [])).toThrow('listed twice')
		})

		it('refuses private details for a note that is not private', () => {
			const publicNote = parseNotes(noteLine({ id: 'open' }), 'notes.jsonl')

			expect(() => mergeLocal(publicNote, [{ id: 'open', context: 'x' }])).toThrow('not private')
		})
	})

	describe('loadNotes', () => {
		const folder = join(tmpdir(), `stockpot-eval-notes-${crypto.randomUUID()}`)
		const publicFile = join(folder, 'notes.jsonl')
		const localDir = join(folder, 'local')

		beforeAll(async () => {
			await write(publicFile, `${noteLine()}\n`)
			await write(join(localDir, 'mine.jsonl'), `${noteLine({ id: 'private-one' })}\n`)
		})

		afterAll(async () => {
			await $`rm -rf ${folder}`
		})

		it('includes the local notes when the folder exists', async () => {
			const notes = await loadNotes({ publicFile, localDir })

			expect(notes.map(({ id }) => id)).toEqual(['albeit', 'private-one'])
		})

		it('reads only the public notes when there is no local folder', async () => {
			const notes = await loadNotes({ publicFile, localDir: join(folder, 'absent') })

			expect(notes.map(({ id }) => id)).toEqual(['albeit'])
		})
	})

	describe('the committed set', () => {
		it('parses and keeps every id unique', async () => {
			const notes = await loadNotes({
				publicFile: join(import.meta.dir, 'notes.jsonl'),
				localDir: join(tmpdir(), 'stockpot-eval-no-local'),
			})

			expect(new Set(notes.map(({ id }) => id)).size).toBe(notes.length)
		})
	})
})
