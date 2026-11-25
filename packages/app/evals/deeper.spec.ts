// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { answeredCard, checkRepeats } from './deeper'
import type { CallRecord } from './report'

const levelOne = {
	sense: 'a fast runtime for scripts',
	aliases: ['bun'],
	summary: 'Bun runs JavaScript files and bundles them, all in one tool that starts quickly.',
	sources: [{ title: 'Bun documentation for the whole runtime tool', url: 'https://bun.sh/docs' }],
	uncertain: false,
}

function levelTwo(howItWorks: string, sources = levelOne.sources) {
	return { howItWorks, tradeoffs: ['It is young.'], sources, uncertain: false }
}

describe('deeper', () => {
	describe('checkRepeats', () => {
		it('fails a run of 8 words copied from level 1, and names the fragment', () => {
			const second = levelTwo(
				'As said, runs javascript files and bundles them, all in one tool. More.',
			)

			expect(checkRepeats(levelOne, second)).toEqual({
				check: 'repeats',
				passed: false,
				detail: 'repeats "runs javascript files and bundles them all in"',
			})
		})

		it('passes when only 7 words in a row are shared', () => {
			const second = levelTwo('Here: runs JavaScript files and bundles them, all, differently.')

			expect(checkRepeats(levelOne, second)).toMatchObject({ passed: true, detail: null })
		})

		it('still matches when letter case and punctuation differ', () => {
			const second = levelTwo('RUNS... javascript   FILES, and (bundles) them; all-in-one tool')

			expect(checkRepeats(levelOne, second)).toMatchObject({ passed: false })
		})

		it('counts the sense and the aliases of level 1 as its text', () => {
			const first = { ...levelOne, sense: 'one two three four five six seven eight' }

			expect(
				checkRepeats(first, levelTwo('Then one two three four five six seven eight.')),
			).toMatchObject({ passed: false })
		})

		it('ignores the sources of both cards', () => {
			const title = levelOne.sources[0]?.title ?? ''
			const sources = [{ title, url: 'https://example.com/other' }]

			expect(checkRepeats(levelOne, levelTwo(`See ${title} first.`, sources))).toMatchObject({
				passed: true,
			})
			expect(checkRepeats(levelOne, levelTwo('Nothing shared.', sources))).toMatchObject({
				passed: true,
			})
		})

		it('does not join two fields of level 2 into one run', () => {
			const first = { ...levelOne, summary: 'alpha beta gamma delta epsilon zeta eta theta' }

			const second = {
				...levelTwo('alpha beta gamma delta'),
				tradeoffs: ['epsilon zeta eta theta'],
			}

			expect(checkRepeats(first, second)).toMatchObject({ passed: true })
		})

		describe('with Cyrillic text', () => {
			const first = {
				...levelOne,
				summary: 'Это среда выполнения для запуска кода на сервере и в консоли.',
			}

			it('splits it into words and fails an 8-word run', () => {
				const second = levelTwo(
					'Итак: среда выполнения для запуска кода на сервере и в других местах.',
				)

				expect(checkRepeats(first, second)).toMatchObject({
					passed: false,
					detail: 'repeats "среда выполнения для запуска кода на сервере и"',
				})
			})

			it('passes 7 shared words', () => {
				expect(
					checkRepeats(
						first,
						levelTwo('Среда выполнения для запуска кода на сервере, потом другое.'),
					),
				).toMatchObject({ passed: true })
			})
		})
	})

	describe('answeredCard', () => {
		const record: CallRecord = {
			noteId: 'note',
			task: 'explain',
			format: 'technology',
			depth: 1,
			elapsedMs: 1,
			error: null,
			checks: [{ check: 'schema', passed: true, detail: null }],
			answer: levelOne,
		}

		it('returns the card of a call that answered and passed its schema', () => {
			expect(answeredCard(record)).toEqual(levelOne)
		})

		it.each<[string, Partial<CallRecord>]>([
			['an error', { error: 'timeout', answer: null }],
			['no answer', { answer: null }],
			['a schema failure', { checks: [{ check: 'schema', passed: false, detail: 'x' }] }],
			['an answer that is no object', { answer: ['text'] }],
		])('returns nothing for %s', (_name, overrides) => {
			expect(answeredCard({ ...record, ...overrides })).toBeNull()
		})
	})
})
