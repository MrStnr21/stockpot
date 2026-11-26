// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The notes of the Cards · 390 board, frames 01–06: every format ready, with the content the board
 * draws. Bodies have every field their level's schema asks for, as the research job stores them.
 */

/** JSON, as a card body holds it. */
export type Json =
	string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json }

export type Format = 'vocabulary' | 'technology' | 'comparison' | 'concept' | 'report' | 'brief'

export type Status = 'new' | 'queued' | 'researching' | 'ready' | 'read' | 'failed'

export interface SeedCard {
	readonly depth: 1 | 2 | 3
	readonly body: Readonly<Record<string, Json>>
	readonly sources?: readonly { readonly title: string; readonly url: string }[]
	readonly language?: string
	readonly engine?: string
	readonly isDraft?: boolean
	readonly isUncertain?: boolean
}

export interface SeedJob {
	readonly kind: 'research' | 'deeper'
	readonly depth?: 2 | 3
	readonly status: 'queued' | 'running' | 'failed'
	readonly priority: 'now' | 'batch'
	/** Minutes from now: negative is due. */
	readonly runIn: number
	readonly attempts?: number
	readonly lastError?: string
}

export interface SeedNote {
	readonly key: string
	readonly format: Format
	readonly text: string
	readonly context: string
	readonly status: Status
	readonly isPrivate?: boolean
	readonly cards?: readonly SeedCard[]
	readonly jobs?: readonly SeedJob[]
}

export const englishCard = {
	sense: 'finding something good by chance',
	aliases: ['serendipitous'],
	translation: 'счастливая случайность, удачная находка',
	partOfSpeech: 'noun',
	difficulty: 'medium',
	examples: [
		{
			text: 'Meeting my co-founder at a bus stop was pure serendipity.',
			translation: 'Встреча с сооснователем на остановке была чистой случайностью.',
		},
		{
			text: 'Good libraries leave room for serendipity.',
			translation: 'В хороших библиотеках есть место для случайных находок.',
		},
	],
	modelSentences: [
		'It was pure serendipity that we met.',
		'Leave room for serendipity in your plans.',
	],
	mistake:
		'Using it for any coincidence. Serendipity is a lucky find; a bad coincidence is not serendipity.',
}

export const bunCard = {
	sense: 'A JavaScript runtime and toolkit',
	aliases: [],
	summary: 'A JavaScript runtime with a package manager, a test runner and a bundler built in.',
	analogy: 'Like Node.js, npm, Jest and esbuild rolled into one fast binary.',
	relevance: 'stockpot’s server, tests and scripts run on it, so its APIs come before Node’s.',
}

export const bunSources = [
	{ title: 'Bun documentation', url: 'https://bun.sh/docs' },
	{ title: 'oven-sh/bun on GitHub', url: 'https://github.com/oven-sh/bun' },
]

export const bunDeeper = {
	howItWorks:
		'Bun is written in Zig and runs JavaScript on JavaScriptCore, the engine from Safari, rather than V8. Its tools share one process and one module resolver, so installs, tests and builds skip the start-up of separate programs.',
	tradeoffs: [
		'Fast start-up and installs',
		'Most Node APIs work, but not every native module',
		'A younger ecosystem with fewer years in production',
	],
}

export const readyFrames: readonly SeedNote[] = [
	{
		key: '01',
		format: 'vocabulary',
		text: 'serendipity',
		context: 'Heard on a podcast about city planning',
		status: 'ready',
		cards: [{ depth: 1, body: englishCard, language: 'ru' }],
	},
	{
		key: '02',
		format: 'technology',
		text: 'Bun',
		context: 'Seen in the stockpot README',
		status: 'ready',
		cards: [{ depth: 1, body: bunCard, sources: bunSources }],
	},
	{
		key: '03',
		format: 'comparison',
		text: 'Ollama',
		context: 'Mentioned in a self-hosting thread',
		status: 'ready',
		cards: [
			{
				depth: 1,
				body: {
					sense: 'A runner for local language models',
					aliases: [],
					summary:
						'Runs open-weight language models on your own machine, and serves them and streams tokens over a local HTTP API.',
					alternatives: [
						{
							name: 'LM Studio',
							pros: 'A desktop app with a model browser; no terminal needed',
							cons: 'Closed source; made for one machine, not for serving',
						},
						{
							name: 'llama.cpp',
							pros: 'The engine many runners build on; the most control',
							cons: 'You build, tune and serve it yourself',
						},
						{
							name: 'vLLM',
							pros: 'High throughput for many users on a GPU server',
							cons: 'Needs a capable GPU and more setup',
						},
					],
					worksWith: ['Open WebUI', 'LangChain', 'Continue', 'OpenAI-compatible clients'],
				},
				sources: [
					{ title: 'ollama/ollama on GitHub', url: 'https://github.com/ollama/ollama' },
					{ title: 'Model library', url: 'https://ollama.com/library' },
					{ title: 'llama.cpp', url: 'https://github.com/ggml-org/llama.cpp' },
				],
			},
		],
	},
	{
		key: '04',
		format: 'concept',
		text: 'Idempotency',
		context: 'A code review comment on retries',
		status: 'ready',
		cards: [
			{
				depth: 1,
				body: {
					sense: 'Repeating an operation changes nothing more',
					aliases: ['idempotent'],
					explanation:
						'An operation is idempotent when doing it twice has the same effect as doing it once. That makes retries safe, which is why networks, payment APIs and job queues rely on it.',
					analogy: 'A lift call button: pressing it five times still brings one lift.',
					example:
						'PUT /notes/42 with the same body leaves the same note however often it is sent; POST /notes makes a new note every time.',
					seenIn: [
						'HTTP methods: GET, PUT and DELETE',
						'Idempotency keys in payment APIs',
						'Retries in a job queue',
						'Infrastructure as code',
					],
				},
				sources: [
					{ title: 'RFC 9110: idempotent methods', url: 'https://www.rfc-editor.org/rfc/rfc9110' },
					{
						title: 'Idempotent requests',
						url: 'https://docs.stripe.com/api/idempotent_requests',
					},
				],
			},
		],
	},
	{
		key: '05',
		format: 'report',
		text: 'Voice capture from the Action button',
		context: 'Thought of on a walk',
		status: 'ready',
		cards: [
			{
				depth: 1,
				body: {
					sense: 'An idea for stockpot',
					aliases: [],
					summary:
						'One press of the Action button saves a note by voice, without opening the app: for the owner first, then for other self-hosters with an iPhone.',
					existing: [
						{
							name: 'Shortcuts with Dictate Text',
							note: 'Works on the Action button today, but has no category step and no suggestions.',
						},
						{
							name: 'Drafts',
							note: 'Fast voice capture into its own inbox; the notes stay inside Drafts.',
						},
						{
							name: 'Quick add in task apps',
							note: 'Voice into to-do lists; nothing explains what you saved.',
						},
					],
					approaches: [
						{
							name: 'Extend the Shortcut',
							tradeoff: 'Ships now with no new code on the phone; menus only, no live suggestions.',
						},
						{
							name: 'An App Intent in the iOS app',
							tradeoff: 'The best feel and an offline queue; waits for the native app.',
						},
					],
					risks: [
						'Dictation mishears rare terms and names',
						'Only newer iPhones have the Action button',
						'Without a queue on the phone, no signal means a lost note',
					],
					firstSteps: [
						'Dictate ten real notes and count the misheard terms',
						'Add a voice path to the Shortcut',
						'Time it from the press to the saved note',
					],
					gaps: [],
				},
				sources: [
					{
						title: 'App Intents',
						url: 'https://developer.apple.com/documentation/appintents',
					},
					{
						title: 'Use the Action button on iPhone',
						url: 'https://support.apple.com/guide/iphone',
					},
				],
			},
		],
	},
	{
		key: '06',
		format: 'brief',
		text: 'Bauhaus',
		context: 'A chair in a museum shop',
		status: 'ready',
		cards: [
			{
				depth: 1,
				body: {
					sense: 'The German school of art and design',
					aliases: [],
					explanation:
						'A German school of art, design and architecture, open from 1919 to 1933, that joined craft with industry: simple forms, honest materials, function first. Its ideas went mainstream in furniture, type and buildings.',
				},
				sources: [
					{ title: 'Bauhaus Kooperation', url: 'https://bauhauskooperation.com' },
					{ title: 'Bauhaus', url: 'https://en.wikipedia.org/wiki/Bauhaus' },
				],
			},
		],
	},
]
