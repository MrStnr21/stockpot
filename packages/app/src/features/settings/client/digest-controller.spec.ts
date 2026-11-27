// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { afterEach, beforeEach, describe, expect, it, jest, mock } from 'bun:test'
import { publicSettingsFactory } from '#tests/factories/settings'
import { SettingsFetch } from '#tests/setup/settings-fetch'

import { en } from '#/lib/i18n/en'

import { DigestController, limitDebounceMs, type DigestValues } from './digest-controller.svelte'
import { createSettingsApi } from './settings-api'
import { SettingsToasts } from './settings-toasts.svelte'

const initial: DigestValues = {
	time: '08:30',
	batchTime: '06:30',
	limit: 7,
	timeZone: 'Europe/Berlin',
	cardLanguage: 'en',
}

const { cardLanguage: initialLanguage, ...initialDigest } = initial

/** The settings the server answers after a change. */
function answerWith({ cardLanguage = initialLanguage, ...digest }: Partial<DigestValues>) {
	return publicSettingsFactory.build({ digest: { ...initialDigest, ...digest }, cardLanguage })
}

describe('DigestController', () => {
	let requests: SettingsFetch
	let toasts: SettingsToasts
	let controller: DigestController

	beforeEach(() => {
		jest.useFakeTimers()
		requests = new SettingsFetch()
		toasts = new SettingsToasts()
		controller = new DigestController({
			initial,
			api: createSettingsApi({ fetch: requests.fetch, signIn: mock<() => void>() }),
			toasts,
			strings: en.settings.errors,
		})
	})

	afterEach(() => {
		controller.destroy()
		toasts.destroy()
		jest.useRealTimers()
	})

	describe('a time', () => {
		it('saves that one field', async () => {
			requests.answer(answerWith({ batchTime: '05:45' }))

			await controller.setTime('batchTime', '05:45')

			expect(requests.calls).toEqual([
				{ url: '/api/settings', method: 'PATCH', body: { digest: { batchTime: '05:45' } } },
			])
			expect(controller.values.batchTime).toBe('05:45')
		})

		it.each(['24:00', '7:5', ''])('does not send %p', async (value) => {
			await controller.setTime('time', value)

			expect(requests.calls).toEqual([])
			expect(controller.values.time).toBe('08:30')
		})
	})

	describe('the stepper', () => {
		it('saves once after the taps pause', async () => {
			requests.answer(answerWith({ limit: 5 }))

			controller.step(-1)
			jest.advanceTimersByTime(limitDebounceMs - 1)
			controller.step(-1)
			jest.advanceTimersByTime(limitDebounceMs - 1)

			expect(requests.calls).toEqual([])
			expect(controller.values.limit).toBe(5)

			jest.advanceTimersByTime(1)
			await Promise.resolve()

			expect(requests.calls).toEqual([
				{ url: '/api/settings', method: 'PATCH', body: { digest: { limit: 5 } } },
			])
		})

		it('stops at 1 and 50', () => {
			const atOne = new DigestController({
				initial: { ...initial, limit: 1 },
				api: createSettingsApi({ fetch: requests.fetch }),
				toasts,
				strings: en.settings.errors,
			})

			atOne.step(-1)

			expect(atOne.values.limit).toBe(1)
			expect(atOne.canFewer).toBe(false)
			expect(atOne.canMore).toBe(true)
		})
	})

	describe('the time zone', () => {
		it('takes the server’s canonical name', async () => {
			requests.answer(answerWith({ timeZone: 'Europe/Kyiv' }))

			await controller.setTimeZone('europe/kyiv')

			expect(controller.values.timeZone).toBe('Europe/Kyiv')
		})
	})

	describe('the card language', () => {
		it('sends the code on its own', async () => {
			requests.answer(answerWith({ cardLanguage: 'de' }))

			await controller.setCardLanguage('de')

			expect(requests.call(0).body).toEqual({ cardLanguage: 'de' })
			expect(controller.values.cardLanguage).toBe('de')
		})
	})

	describe('when a save fails', () => {
		it('puts the saved value back and shows a toast', async () => {
			requests.fail()

			await controller.setTime('time', '07:00')

			expect(controller.values.time).toBe('08:30')
			expect(toasts.current).toMatchObject({ tone: 'error', title: 'Could not save. Try again' })
		})

		it('shows the server’s reason under the row for a 400', async () => {
			requests.refuse(400, 'invalid_body', { issues: ['digest.timeZone: Use an IANA time zone'] })

			await controller.setTimeZone('Mars/Olympus')

			expect(controller.values.timeZone).toBe('Europe/Berlin')
			expect(controller.errors.timeZone).toBe('Use an IANA time zone')
			expect(toasts.current).toBeNull()
		})

		it('clears the reason on the next change', async () => {
			requests.refuse(400, 'invalid_body', { issues: ['digest.timeZone: No'] })
			await controller.setTimeZone('Mars/Olympus')
			requests.answer(answerWith({ timeZone: 'Asia/Tokyo' }))

			await controller.setTimeZone('Asia/Tokyo')

			expect(controller.errors.timeZone).toBeUndefined()
		})

		it('leaves a 401 to the sign-in redirect', async () => {
			requests.refuse(401, 'unauthorized')

			await controller.setTime('time', '07:00')

			expect(toasts.current).toBeNull()
		})
	})
})
