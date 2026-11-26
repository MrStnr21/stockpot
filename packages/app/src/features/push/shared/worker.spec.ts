// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it, mock, type Mock } from 'bun:test'

import { pushPayload, type PushPayload } from './payload'
import {
	createPushWorker,
	type ClickedNotification,
	type PushDataLike,
	type PushWorker,
	type PushWorkerEnv,
	type WindowClientLike,
} from './worker'

const origin = 'https://stockpot.example.ts.net'

const home = `${origin}/`

const card = `${origin}/notes/7`

const icon = '/icons/icon-192.png'

interface FakeWindow extends WindowClientLike {
	focus: Mock<WindowClientLike['focus']>
	navigate: Mock<WindowClientLike['navigate']>
}

function fakeWindow(steps: string[]): FakeWindow {
	return {
		focus: mock(async () => {
			steps.push('focus')

			return {}
		}),
		navigate: mock(async (url: string) => {
			steps.push(`navigate ${url}`)

			return {}
		}),
	}
}

/** A push whose payload is `text`. */
function pushText(text: string): PushDataLike {
	return { text: () => text }
}

/** A push whose payload is `value` as JSON. */
function pushJson(value: PushPayload): PushDataLike {
	return pushText(JSON.stringify(value))
}

/** What a notification's data might hold, valid or not. */
type ClickData = Readonly<Record<string, string | number>> | null

describe('push worker', () => {
	let windows: FakeWindow[]
	let steps: string[]
	let showNotification: Mock<PushWorkerEnv['showNotification']>
	let openWindow: Mock<PushWorkerEnv['openWindow']>
	let worker: PushWorker

	beforeEach(() => {
		windows = []
		steps = []
		showNotification = mock(async () => {
			// Shown.
		})
		openWindow = mock(async (url: string) => {
			steps.push(`open ${url}`)

			return {}
		})
		worker = createPushWorker({
			origin,
			showNotification,
			windows: async () => windows,
			openWindow,
		})
	})

	function clicked(data: ClickData): ClickedNotification & { close: Mock<() => void> } {
		return {
			data,
			close: mock(() => {
				steps.push('close')
			}),
		}
	}

	describe('push', () => {
		it('shows the payload with its tag, language, icon and page', async () => {
			const payload = pushPayload(
				{
					title: 'Ready: Kafka',
					body: 'Technology · tap to read',
					path: '/notes/7',
					tag: 'ready-7',
				},
				{ origin, lang: 'en' },
			)

			await worker.push(pushJson(payload))

			expect(showNotification.mock.calls).toEqual([
				[
					'Ready: Kafka',
					{
						body: 'Technology · tap to read',
						tag: 'ready-7',
						lang: 'en',
						icon,
						data: { navigate: card },
						navigate: card,
					},
				],
			])
		})

		it('shows the generic notification when the browser refuses the payload', async () => {
			const payload = pushPayload(
				{ title: 'Ready: Kafka', body: '', path: '/notes/7', tag: 'ready-7' },
				{ origin, lang: 'en' },
			)

			showNotification.mockImplementationOnce(async () => {
				throw new TypeError('Invalid lang')
			})
			await worker.push(pushJson(payload))

			expect(showNotification.mock.calls.at(-1)).toEqual([
				'stockpot',
				{ icon, data: { navigate: home }, navigate: home },
			])
		})

		it('opens Today instead of a page on another origin', async () => {
			const payload = pushPayload(
				{ title: 'Ready: Kafka', body: '', path: '/notes/7', tag: 'ready-7' },
				{ origin: 'https://example.org', lang: 'en' },
			)

			await worker.push(pushJson(payload))

			expect(showNotification.mock.calls[0]?.[1]).toMatchObject({
				data: { navigate: home },
				navigate: home,
			})
		})

		it.each<[string, PushDataLike | null]>([
			['no payload', null],
			['an empty payload', pushText('')],
			['a payload that is not JSON', pushText('{"web_push":')],
			['a payload of another shape', pushText(JSON.stringify({ title: 'Ready: Kafka' }))],
			[
				'a payload without the declarative marker',
				pushText(JSON.stringify({ notification: { title: 'x' } })),
			],
			[
				'a payload with an empty title',
				pushJson(
					pushPayload({ title: '', body: '', path: '/', tag: 'ready-7' }, { origin, lang: 'en' }),
				),
			],
		])('shows a generic notification to Today for %s', async (_case, data) => {
			await worker.push(data)

			expect(showNotification.mock.calls).toEqual([
				['stockpot', { icon, data: { navigate: home }, navigate: home }],
			])
		})
	})

	describe('click', () => {
		it('closes the notification, focuses an open window and navigates it to the page', async () => {
			windows.push(fakeWindow(steps), fakeWindow(steps))

			await worker.click(clicked({ navigate: card }))

			expect(steps).toEqual(['close', 'focus', `navigate ${card}`])
			expect(openWindow).not.toHaveBeenCalled()
		})

		it('opens a window when none is open', async () => {
			await worker.click(clicked({ navigate: card }))

			expect(steps).toEqual(['close', `open ${card}`])
		})

		it('opens a window when the open one cannot be navigated', async () => {
			const open = fakeWindow(steps)

			open.navigate.mockImplementation(async () => {
				throw new TypeError('This client is not controlled')
			})
			windows.push(open)

			await worker.click(clicked({ navigate: card }))

			expect(steps).toEqual(['close', 'focus', `open ${card}`])
		})

		it.each([
			['another origin', { navigate: 'https://example.org/notes/7' }],
			['a lookalike host', { navigate: 'https://stockpot.example.ts.net.example.org/' }],
			['a data: URL', { navigate: 'data:text/html,<p>stockpot</p>' }],
			['a relative path', { navigate: '/notes/7' }],
			['no data', null],
			['data of another shape', { navigate: 7 }],
		])('refuses %s and opens Today', async (_case, data) => {
			await worker.click(clicked(data))

			expect(steps).toEqual(['close', `open ${home}`])
		})
	})
})
