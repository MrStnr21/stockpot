// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { SettingsFetch } from '#tests/setup/settings-fetch'

import { en } from '#/lib/i18n/en'

import type { EngineTestResult } from '../shared/types'
import { EngineTester, testNoticeText, type EngineTestNotice } from './engine-tester.svelte'
import { createSettingsApi } from './settings-api'

const result: EngineTestResult = {
	engine: 'agent-command',
	testedAt: '2026-11-20T08:00:00.000Z',
	outcome: 'ok',
	elapsedMs: 812,
	model: null,
}

describe('EngineTester', () => {
	let requests: SettingsFetch
	let signIn: ReturnType<typeof mock<() => void>>
	let now: Date
	let tester: EngineTester

	beforeEach(() => {
		requests = new SettingsFetch()
		signIn = mock<() => void>()
		now = new Date('2026-11-20T08:00:00.000Z')
		tester = new EngineTester({
			api: createSettingsApi({ fetch: requests.fetch, signIn }),
			now: () => now,
		})
	})

	it('posts the test and keeps its result', async () => {
		requests.answer(result)

		const notice = await tester.test('agent-command')

		expect(notice).toBeNull()
		expect(requests.calls).toEqual([
			{ url: '/api/engines/agent-command/test', method: 'POST', body: null },
		])
		expect(tester.slot('agent-command')).toEqual({ busy: false, result })
	})

	it('is busy while the test runs and sends no second request meanwhile', async () => {
		requests.answer(result)

		const running = tester.test('agent-command')

		expect(tester.slot('agent-command').busy).toBe(true)
		expect(await tester.test('agent-command')).toBeNull()

		await running

		expect(requests.calls).toHaveLength(1)
		expect(tester.slot('agent-command').busy).toBe(false)
	})

	it('says a test is already running on a 409 test_running', async () => {
		requests.refuse(409, 'test_running')

		expect(await tester.test('gemini')).toEqual({ kind: 'running' })
		expect(tester.slot('gemini')).toEqual({ busy: false, result: null })
	})

	it('says the engine is not set up on a 409 not_set_up', async () => {
		requests.refuse(409, 'not_set_up')

		expect(await tester.test('gemini')).toEqual({ kind: 'not_set_up' })
	})

	it('waits out a 429 without asking the server again', async () => {
		requests.answer({ error: { code: 'too_soon', message: 'Refused.' } }, 429, {
			'retry-after': '7',
		})

		expect(await tester.test('gemini')).toEqual({ kind: 'too_soon', seconds: 7 })

		now = new Date(now.getTime() + 2500)

		expect(await tester.test('gemini')).toEqual({ kind: 'too_soon', seconds: 5 })
		expect(requests.calls).toHaveLength(1)

		now = new Date(now.getTime() + 4500)
		requests.answer({ ...result, engine: 'gemini' })

		expect(await tester.test('gemini')).toBeNull()
		expect(requests.calls).toHaveLength(2)
	})

	it('signs in again on a 401 and says nothing more', async () => {
		requests.refuse(401, 'unauthorized')

		expect(await tester.test('gemini')).toBeNull()
		expect(signIn).toHaveBeenCalledTimes(1)
	})

	it('says the test could not run on any other failure', async () => {
		requests.fail()

		expect(await tester.test('gemini')).toEqual({ kind: 'failed' })
		expect(tester.slot('gemini').busy).toBe(false)
	})

	it('keeps the last result when a later press is refused', async () => {
		requests.answer(result).refuse(409, 'test_running')

		await tester.test('agent-command')
		await tester.test('agent-command')

		expect(tester.slot('agent-command').result).toEqual(result)
	})

	it('words each notice', () => {
		const notices: EngineTestNotice[] = [
			{ kind: 'running' },
			{ kind: 'too_soon', seconds: 4 },
			{ kind: 'not_set_up' },
			{ kind: 'failed' },
		]

		expect(notices.map((notice) => testNoticeText(notice, en.settings))).toEqual([
			'A test is already running',
			'Try again in 4 s',
			'Not set up',
			'Could not run the test. Try again',
		])
	})
})
