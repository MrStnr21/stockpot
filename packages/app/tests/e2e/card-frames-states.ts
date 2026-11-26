// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The notes of the Cards · 390 board, frames 07–15, and a private English note: every state, with
 * the jobs behind the waiting ones.
 */
import { bunCard, bunDeeper, bunSources, englishCard, type SeedNote } from './card-frames'

export const stateFrames: readonly SeedNote[] = [
	{
		key: '07',
		format: 'concept',
		text: 'CRDT',
		context: 'A talk on local-first apps',
		status: 'new',
	},
	{
		key: '08',
		format: 'concept',
		text: 'Local-first software',
		context: 'Linked from the CRDT talk',
		status: 'queued',
		jobs: [{ kind: 'research', status: 'queued', priority: 'now', runIn: -1 }],
	},
	{
		key: '09',
		format: 'technology',
		text: 'WebTransport',
		context: 'Seen in a browser release note',
		status: 'researching',
		jobs: [{ kind: 'research', status: 'running', priority: 'now', runIn: -1 }],
	},
	{
		key: '10',
		format: 'report',
		text: 'A shared reading list for friends',
		context: 'From a chat with friends',
		status: 'researching',
	},
	{
		key: '11',
		format: 'comparison',
		text: 'MCP',
		context: 'Seen in an editor’s changelog',
		status: 'failed',
		jobs: [
			{
				kind: 'research',
				status: 'failed',
				priority: 'batch',
				runIn: -30,
				attempts: 3,
				lastError: 'The engine failed: timeout',
			},
		],
	},
	{
		key: '12',
		format: 'vocabulary',
		text: 'to hedge',
		context: 'A finance newsletter',
		status: 'ready',
		cards: [
			{
				depth: 1,
				isDraft: true,
				engine: 'openai-compatible',
				language: 'ru',
				body: {
					sense: 'to protect yourself against a loss; to avoid a straight answer',
					aliases: ['hedging'],
					translation: 'подстраховаться; уходить от прямого ответа',
					partOfSpeech: 'verb',
					difficulty: 'medium',
					examples: [
						{
							text: 'I hedged my bets and applied to three jobs.',
							translation: 'Я подстраховался и подал заявки на три вакансии.',
						},
						{
							text: 'Stop hedging and give me a straight answer.',
							translation: 'Хватит увиливать, ответь прямо.',
						},
					],
					modelSentences: ['Hedge your bets.', 'Gold is a hedge against inflation.'],
					mistake: null,
				},
			},
		],
		jobs: [{ kind: 'research', status: 'queued', priority: 'batch', runIn: 240 }],
	},
	{
		key: '13',
		format: 'brief',
		text: 'Hyperstition',
		context: 'A long essay on internet culture',
		status: 'ready',
		cards: [
			{
				depth: 1,
				isUncertain: true,
				body: {
					sense: 'An idea that makes itself real by spreading',
					aliases: [],
					explanation:
						'A coinage from 1990s cultural theory for a fiction that brings itself about: the more people repeat it, the more it shapes what they do, until it comes true.',
				},
			},
		],
	},
	{
		key: '14',
		format: 'technology',
		text: 'Bun runtime',
		context: 'Seen in the stockpot README',
		status: 'ready',
		cards: [
			{ depth: 1, body: bunCard, sources: bunSources },
			{
				depth: 2,
				body: bunDeeper,
				sources: [
					{ title: 'Bun documentation', url: 'https://bun.sh/docs' },
					{ title: 'Node.js compatibility', url: 'https://bun.sh/docs/runtime/nodejs-apis' },
				],
			},
		],
	},
	{
		key: '15',
		format: 'technology',
		text: 'Bun toolkit',
		context: 'Seen in the stockpot README',
		status: 'read',
		cards: [
			{ depth: 1, body: bunCard, sources: bunSources },
			{ depth: 2, body: bunDeeper, sources: bunSources },
		],
		jobs: [{ kind: 'deeper', depth: 3, status: 'queued', priority: 'batch', runIn: 600 }],
	},
	{
		key: 'private',
		format: 'vocabulary',
		text: 'a far cry',
		context: 'A note on a book review',
		status: 'ready',
		isPrivate: true,
		cards: [
			{
				depth: 1,
				language: 'ru',
				body: { ...englishCard, sense: 'very different from', translation: 'совсем не то' },
			},
		],
	},
]
