// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/* What each frame of the Cards · 390 board shows, as `cards.spec.ts` checks it on the seeded notes. */
import * as v from 'valibot'

export interface Frame {
	readonly key: string
	readonly title: string
	/** Texts the board's frame shows, each found on the page. */
	readonly texts: readonly string[]
	/** The depth tab the frame shows, picked before the check. */
	readonly tab?: string
}

export const frames: readonly Frame[] = [
	{
		key: '01',
		title: 'serendipity',
		texts: ['Translation', 'Hear it on YouGlish', 'Typical mistake'],
	},
	{ key: '02', title: 'Bun', texts: ['What it is', 'Why it matters to you', 'Bun documentation'] },
	{ key: '03', title: 'Ollama', texts: ['Against the alternatives', 'Works with', 'llama.cpp'] },
	{ key: '04', title: 'Idempotency', texts: ['Explanation', 'Where you will meet it'] },
	{
		key: '05',
		title: 'Voice capture from the Action button',
		texts: ['In short', 'What already exists', 'First steps', 'Researched by Gemini'],
	},
	{ key: '06', title: 'Bauhaus', texts: ['Explanation', 'Bauhaus Kooperation'] },
	{ key: '07', title: 'CRDT', texts: ['Waits for tonight', 'Research now'] },
	{
		key: '08',
		title: 'Local-first software',
		texts: ['Next in line', 'One note is ahead of it.', 'Research now · asked at'],
	},
	{ key: '09', title: 'WebTransport', texts: ['Researching', 'Usually under a minute.'] },
	// The board also lists the idea's steps; they live in memory while a job runs and cannot be seeded.
	{ key: '10', title: 'A shared reading list for friends', texts: ['Researching the idea'] },
	{
		key: '11',
		title: 'MCP',
		texts: [
			'Couldn’t write this card',
			'The engine timed out.',
			'Timeout · 2 retries',
			'Try again',
		],
	},
	{
		key: '12',
		title: 'to hedge',
		texts: [
			'Draft.',
			'It is rewritten after the limit resets',
			'Draft by the OpenAI-compatible engine',
		],
	},
	{ key: '13', title: 'Hyperstition', texts: ['Not sure.', 'None: no link passed the check.'] },
	{
		key: '14',
		title: 'Bun runtime',
		tab: 'How it works',
		texts: ['Trade-offs', 'Level 2 · written by Gemini'],
	},
	{
		key: '15',
		title: 'Bun toolkit',
		tab: 'Hands-on',
		texts: ['Hands-on comes tonight', 'Research now'],
	},
]

const queuedJob = v.object({ state: v.string(), runAt: v.string() })

const firstLevel = v.object({ job: v.nullable(queuedJob) })

/** Enough of `GET /api/notes/:id/card` to read level 1's job. */
export const firstLevelJob = v.object({ levels: v.tuple([firstLevel, v.unknown(), v.unknown()]) })
