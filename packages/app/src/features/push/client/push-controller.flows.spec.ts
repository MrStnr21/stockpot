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

import { PushController } from './push-controller.svelte'

describe('PushController flows', () => {
	let browser: FakePushBrowser
	let controller: PushController

	beforeEach(() => {
		browser = new FakePushBrowser()
		controller = new PushController({ publicKey: vapidPublicKey, env: browser.env })
	})

	describe('enable', () => {
		beforeEach(async () => {
			await controller.mount()
			browser.steps = []
		})

		it('asks for the permission before awaiting anything else, inside the tap', async () => {
			const enabling = controller.enable()

			const beforeAwait = [...browser.steps]

			await enabling

			expect([beforeAwait, browser.steps]).toEqual([
				['requestPermission'],
				['requestPermission', 'ready', 'subscribe', 'POST /api/push/subscriptions'],
			])
		})

		it('subscribes visibly with the key bytes, then saves the subscription', async () => {
			await controller.enable()

			expect([controller.state, browser.subscribeOptions, browser.requests]).toEqual([
				'on',
				{ userVisibleOnly: true, applicationServerKey: vapidKeyBytes },
				[{ method: 'POST', body: subscriptionJson }],
			])
		})

		it('shows blocked when the permission is denied, and subscribes nothing', async () => {
			browser.answer = 'denied'
			await controller.enable()

			expect([controller.state, browser.steps]).toEqual(['blocked', ['requestPermission']])
		})

		it('stays off when the prompt is dismissed', async () => {
			browser.answer = 'default'
			await controller.enable()

			expect([controller.state, browser.steps]).toEqual(['off', ['requestPermission']])
		})

		it('unsubscribes here and fails when the server refuses the subscription', async () => {
			browser.status = 400
			await controller.enable()

			expect([controller.state, browser.steps.slice(-2), browser.subscription]).toEqual([
				'failed',
				['POST /api/push/subscriptions', 'unsubscribe'],
				null,
			])
		})

		it('fails when the push service refuses to subscribe', async () => {
			browser.subscribeFails = true
			await controller.enable()

			expect([controller.state, browser.requests]).toEqual(['failed', []])
		})

		it('fails when the worker is not ready in time', async () => {
			browser.readyNever = true
			await controller.enable()

			expect([controller.state, browser.timedOut, browser.steps]).toEqual([
				'failed',
				true,
				['requestPermission', 'ready'],
			])
		})
	})

	describe('turnOff', () => {
		beforeEach(async () => {
			browser.permission = 'granted'
			browser.subscription = browser.makeSubscription(vapidKeyBytes)
			await controller.mount()
			browser.steps = []
			browser.requests = []
		})

		it('unsubscribes this browser, then tells the server', async () => {
			await controller.turnOff()

			expect([controller.state, browser.steps, browser.requests]).toEqual([
				'off',
				['getRegistration', 'getSubscription', 'unsubscribe', 'DELETE /api/push/subscriptions'],
				[{ method: 'DELETE', body: { endpoint: pushEndpoint } }],
			])
		})

		it('is busy as the on state while it works', async () => {
			const turningOff = controller.turnOff()

			const busy = [controller.state, controller.settled]

			await turningOff

			expect(busy).toEqual(['working', 'on'])
		})
	})
})
