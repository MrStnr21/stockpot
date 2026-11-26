// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'
import {
	FakePushBrowser,
	pushEndpoint,
	subscriptionJson,
	vapidKeyBytes,
	vapidPublicKey,
} from '#tests/setup/push-browser'

import { en } from '#/lib/i18n/en'

import { PushController, pushView } from './push-controller.svelte'

describe('PushController', () => {
	let browser: FakePushBrowser
	let controller: PushController

	beforeEach(() => {
		browser = new FakePushBrowser()
		controller = new PushController({ publicKey: vapidPublicKey, env: browser.env })
	})

	it('is busy until it has looked at the browser', () => {
		expect(controller.state).toBe('working')
	})

	describe('mount', () => {
		it('asks for the Home Screen in Safari on iPhone outside the Home Screen app', async () => {
			browser.outsideHomeScreen = true
			browser.supported = false
			await controller.mount()

			expect([controller.state, browser.steps]).toEqual(['needs-home-screen', []])
		})

		it('shows the toggle where push works even if the page is not a Home Screen app', async () => {
			browser.outsideHomeScreen = true
			await controller.mount()

			expect(controller.state).toBe('off')
		})

		it('says a browser without push cannot show notifications', async () => {
			browser.supported = false
			await controller.mount()

			expect(controller.state).toBe('unsupported')
		})

		it('says notifications are blocked once the permission is denied', async () => {
			browser.permission = 'denied'
			await controller.mount()

			expect([controller.state, browser.steps]).toEqual(['blocked', []])
		})

		it('is off without a worker or without a subscription', async () => {
			browser.registered = false
			await controller.mount()

			const withoutWorker = controller.state

			browser.registered = true
			await controller.mount()

			expect([withoutWorker, controller.state, browser.requests]).toEqual(['off', 'off', []])
		})

		it('drops a subscription made with another key and shows off', async () => {
			browser.permission = 'granted'
			browser.subscription = browser.makeSubscription(Uint8Array.of(4, 9, 9))
			await controller.mount()

			expect([controller.state, browser.steps, browser.requests]).toEqual([
				'off',
				['getRegistration', 'getSubscription', 'unsubscribe'],
				[],
			])
		})

		it('sends a subscription with this key again and shows on', async () => {
			browser.permission = 'granted'
			browser.subscription = browser.makeSubscription(vapidKeyBytes)
			await controller.mount()

			expect([controller.state, browser.requests]).toEqual([
				'on',
				[{ method: 'POST', body: subscriptionJson }],
			])
		})

		it('keeps a subscription on when sending it again fails', async () => {
			browser.permission = 'granted'
			browser.status = 503
			browser.subscription = browser.makeSubscription(vapidKeyBytes)
			await controller.mount()

			expect([controller.state, browser.subscription]).toMatchObject([
				'on',
				{ endpoint: pushEndpoint },
			])
		})
	})

	describe('pushView', () => {
		it.each([
			['needs-home-screen', en.push.settingsHomeScreen, null],
			['unsupported', en.push.settingsUnsupported, null],
			['blocked', en.push.settingsBlocked, null],
			['off', en.push.settingsOff, 'enable'],
			['on', en.push.settingsOn, 'turn-off'],
			['failed', en.push.settingsFailed, 'enable'],
		] as const)('shows %s with its text and button', (state, message, kind) => {
			expect(pushView(state, 'off', en.push)).toMatchObject({
				message,
				action: kind === null ? null : { kind },
				busy: false,
			})
		})

		it('keeps the text and button of the state it left while busy', () => {
			expect(pushView('working', 'on', en.push)).toEqual({
				message: en.push.settingsOn,
				action: { kind: 'turn-off', label: en.push.settingsTurnOff },
				busy: true,
			})
		})
	})
})
