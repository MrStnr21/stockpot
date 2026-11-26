// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'

import { pushPayload } from '#/features/push/shared/payload'

import { digestMessage, readyMessage, type PushMessage, type ReadyMessageInput } from './messages'

const origin = 'https://stockpot.example.ts.net'

function readyInput(input: Partial<ReadyMessageInput> = {}): ReadyMessageInput {
	return {
		noteId: faker.number.int({ min: 1, max: 10_000 }),
		term: faker.lorem.words(2),
		isPrivate: false,
		category: faker.lorem.word(),
		report: null,
		...input,
	}
}

function payloadBytes(message: PushMessage | null, lang: string) {
	if (message === null) {
		throw new Error('Expected a message')
	}

	return new TextEncoder().encode(JSON.stringify(pushPayload(message, { origin, lang }))).length
}

describe('push messages', () => {
	describe('readyMessage', () => {
		it('names the term and the category of a card', () => {
			expect(
				readyMessage(readyInput({ noteId: 12, term: 'Kafka', category: 'Technology' }), 'en'),
			).toEqual({
				title: 'Ready: Kafka',
				body: 'Technology · tap to read',
				path: '/notes/12',
				tag: 'ready-12',
				ttl: 86_400,
				urgency: 'normal',
			})
		})

		it('gives the pages read and the reading time of a report', () => {
			const report = readyInput({
				term: 'Voice capture from the Action button',
				report: { pages: 31, minutes: 6 },
			})

			expect(readyMessage(report, 'en')).toMatchObject({
				title: 'Report ready: Voice capture from the Action button',
				body: '31 pages read · about 6 min',
			})
		})

		it.each([
			[{ pages: 1, minutes: 2 }, '1 page read · about 2 min'],
			[{ pages: null, minutes: 6 }, 'About 6 min'],
			[{ pages: 31, minutes: null }, 'Tap to read'],
		])('writes the body of the report %p as %p', (report, body) => {
			expect(readyMessage(readyInput({ report }), 'en').body).toBe(body)
		})

		it('says only "tap to read" without a category', () => {
			expect(readyMessage(readyInput({ category: null }), 'en').body).toBe('Tap to read')
		})

		describe('for a private note', () => {
			it('reads "a private note" with no category', () => {
				expect(readyMessage(readyInput({ isPrivate: true }), 'en')).toMatchObject({
					title: 'Ready: a private note',
					body: 'Tap to read',
				})
			})

			it('puts no part of the note into a card or a report message', () => {
				const card = readyInput({
					noteId: 1,
					isPrivate: true,
					term: 'Kafka',
					category: 'Technology',
				})

				const report = { ...card, report: { pages: 31, minutes: 6 } }

				for (const message of [readyMessage(card, 'en'), readyMessage(report, 'ru')]) {
					const json = JSON.stringify(message)

					expect(json).not.toContain('Kafka')
					expect(json).not.toContain('Technology')
					expect(json).not.toContain('31')
				}

				expect(readyMessage(report, 'en')).toMatchObject({
					title: 'Report ready: a private note',
					body: 'Tap to read',
				})
			})
		})

		describe('in Russian', () => {
			it('translates the title and the body', () => {
				expect(
					readyMessage(readyInput({ term: 'Kafka', category: 'Технологии' }), 'ru'),
				).toMatchObject({ title: 'Готово: Kafka', body: 'Технологии · нажмите, чтобы прочитать' })
				expect(readyMessage(readyInput({ isPrivate: true }), 'ru').title).toBe(
					'Готово: личная заметка',
				)
			})

			it.each([
				[1, 'Прочитана 1 страница · около 6 мин'],
				[2, 'Прочитано 2 страницы · около 6 мин'],
				[5, 'Прочитано 5 страниц · около 6 мин'],
				[21, 'Прочитана 21 страница · около 6 мин'],
			])('counts %p pages', (pages, body) => {
				expect(readyMessage(readyInput({ report: { pages, minutes: 6 } }), 'ru').body).toBe(body)
			})
		})

		describe('with a long or untidy term', () => {
			it('cuts a term to 60 code points with an ellipsis', () => {
				const { title } = readyMessage(readyInput({ term: '🍲'.repeat(500) }), 'en')

				// 59 code points and the ellipsis.
				expect(title.slice('Ready: '.length)).toBe(`${'🍲'.repeat(59)}…`)
			})

			it('collapses line breaks and runs of spaces', () => {
				expect(readyMessage(readyInput({ term: '  event\n\n  sourcing\t ' }), 'en').title).toBe(
					'Ready: event sourcing',
				)
			})

			it('keeps placeholders and replacement patterns in a term as typed', () => {
				expect(readyMessage(readyInput({ term: '{term} $& {category}' }), 'en').title).toBe(
					'Ready: {term} $& {category}',
				)
			})
		})
	})

	describe('digestMessage', () => {
		it('names the first three terms and how many more', () => {
			const notes = [
				{ term: 'Bun', isPrivate: false },
				{ term: 'Kafka', isPrivate: true },
				{ term: 'Idempotency', isPrivate: false },
				...Array.from({ length: 4 }, () => ({ term: faker.lorem.word(), isPrivate: false })),
			]

			expect(digestMessage({ notes, minutes: 8 }, 'en')).toEqual({
				title: 'Digest: 7 notes, ~8 min',
				body: 'Bun, a private note, Idempotency and 4 more',
				path: '/',
				tag: 'digest',
				ttl: 43_200,
				urgency: 'normal',
				topic: 'digest',
			})
		})

		it('says "1 note" for one', () => {
			const notes = [{ term: 'serendipity', isPrivate: false }]

			expect(digestMessage({ notes, minutes: 1 }, 'en')).toMatchObject({
				title: 'Digest: 1 note, ~1 min',
				body: 'serendipity',
			})
		})

		it('names every term when there are three or fewer', () => {
			const notes = [
				{ term: 'Bun', isPrivate: false },
				{ term: 'Kafka', isPrivate: false },
			]

			expect(digestMessage({ notes, minutes: 3 }, 'en')?.body).toBe('Bun, Kafka')
		})

		it('rounds the reading time to whole minutes, at least one', () => {
			const notes = [{ term: 'Bun', isPrivate: false }]

			expect(digestMessage({ notes, minutes: 0.2 }, 'en')?.title).toBe('Digest: 1 note, ~1 min')
			expect(digestMessage({ notes, minutes: 7.6 }, 'en')?.title).toBe('Digest: 1 note, ~8 min')
		})

		it('keeps the term of a private note out of the message', () => {
			const notes = [
				{ term: 'Bun', isPrivate: false },
				{ term: 'Kafka', isPrivate: true },
			]

			for (const locale of ['en', 'ru'] as const) {
				expect(JSON.stringify(digestMessage({ notes, minutes: 2 }, locale))).not.toContain('Kafka')
			}
		})

		it('is null for no notes', () => {
			expect(digestMessage({ notes: [], minutes: 0 }, 'en')).toBeNull()
		})

		describe('in Russian', () => {
			it.each([
				[1, 'Дайджест: 1 заметка, ~4 мин'],
				[2, 'Дайджест: 2 заметки, ~4 мин'],
				[5, 'Дайджест: 5 заметок, ~4 мин'],
				[21, 'Дайджест: 21 заметка, ~4 мин'],
			])('counts %p notes', (count, title) => {
				const notes = Array.from({ length: count }, () => ({
					term: faker.lorem.word(),
					isPrivate: false,
				}))

				expect(digestMessage({ notes, minutes: 4 }, 'ru')?.title).toBe(title)
			})

			it('says how many more in Russian', () => {
				const notes = ['Bun', 'Kafka', 'Idempotency', 'Raft', 'Paxos'].map((term) => ({
					term,
					isPrivate: false,
				}))

				expect(digestMessage({ notes, minutes: 5 }, 'ru')?.body).toBe(
					'Bun, Kafka, Idempotency и ещё 2',
				)
			})
		})
	})

	describe('the largest payload', () => {
		/* A lone surrogate is the costliest code point a term can hold: JSON writes it as a six-byte
		 * `\udXXX` escape. */
		const widest = '\uD800'.repeat(500)

		it('stays under 3 000 bytes for a ready report', () => {
			const message = readyMessage(
				{
					noteId: Number.MAX_SAFE_INTEGER,
					term: widest,
					isPrivate: false,
					category: widest,
					report: { pages: Number.MAX_SAFE_INTEGER, minutes: Number.MAX_SAFE_INTEGER },
				},
				'ru',
			)

			const card = readyMessage(
				readyInput({ noteId: Number.MAX_SAFE_INTEGER, term: widest, category: widest }),
				'ru',
			)

			expect(payloadBytes(message, 'ru')).toBeLessThan(3000)
			expect(payloadBytes(card, 'ru')).toBeLessThan(3000)
		})

		it('stays under 3 000 bytes for a digest', () => {
			const notes = Array.from({ length: 10_000 }, () => ({ term: widest, isPrivate: false }))
			const message = digestMessage({ notes, minutes: Number.MAX_SAFE_INTEGER }, 'ru')

			expect(payloadBytes(message, 'ru')).toBeLessThan(3000)
		})
	})
})
