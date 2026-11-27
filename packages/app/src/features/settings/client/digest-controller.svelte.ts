// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { PublicDigest, PublicSettings, SettingsChange } from '../shared/types'
import { isClockTime, issueMessage, maxDigestLimit, minDigestLimit } from './digest-view'
import type { SettingsApi } from './settings-api'
import { errorToast, type SettingsToasts } from './settings-toasts.svelte'

/** The digest pane's values: the digest section and the card language. */
export interface DigestValues extends PublicDigest {
	readonly cardLanguage: string
}

export type DigestField = keyof DigestValues

/** The stepper waits this long after the last tap, so a run of taps saves once. */
export const limitDebounceMs = 400

export interface DigestControllerOptions {
	readonly initial: DigestValues
	readonly api: Pick<SettingsApi, 'patchSettings'>
	readonly toasts: SettingsToasts
	readonly strings: { readonly saveFailed: string }
}

function changeOf(field: DigestField, values: DigestValues): SettingsChange {
	return field === 'cardLanguage'
		? { cardLanguage: values.cardLanguage }
		: { digest: { [field]: values[field] } }
}

function valuesOf(settings: PublicSettings): DigestValues {
	return { ...settings.digest, cardLanguage: settings.cardLanguage }
}

/**
 * The digest pane: each change saves that one field at once (the stepper after a pause), and the
 * server's answer, such as a canonical time zone name, replaces it. A failure puts back the last saved
 * value; a refused value shows the server's reason under its row.
 */
export class DigestController {
	public values: DigestValues

	/** The server's reason for the last refused value of each field. */
	public errors = $state.raw<Partial<Record<DigestField, string>>>({})

	#saved: DigestValues

	readonly #api: DigestControllerOptions['api']

	readonly #toasts: SettingsToasts

	readonly #strings: DigestControllerOptions['strings']

	#limitTimer: ReturnType<typeof setTimeout> | null = null

	public constructor({ initial, api, toasts, strings }: DigestControllerOptions) {
		this.values = $state.raw(initial)
		this.#saved = initial
		this.#api = api
		this.#toasts = toasts
		this.#strings = strings
	}

	public get canFewer(): boolean {
		return this.values.limit > minDigestLimit
	}

	public get canMore(): boolean {
		return this.values.limit < maxDigestLimit
	}

	/** A time field changed; a partial or out-of-range time is not sent. */
	public async setTime(field: 'time' | 'batchTime', value: string): Promise<void> {
		if (!isClockTime(value) || value === this.values[field]) {
			return
		}

		this.#set(field, value)
		await this.#save(field)
	}

	public async setTimeZone(value: string): Promise<void> {
		if (value !== this.values.timeZone) {
			this.#set('timeZone', value)
			await this.#save('timeZone')
		}
	}

	public async setCardLanguage(value: string): Promise<void> {
		if (value !== this.values.cardLanguage) {
			this.#set('cardLanguage', value)
			await this.#save('cardLanguage')
		}
	}

	/** One step of the stepper, within 1 to 50; the save waits for the taps to pause. */
	public step(delta: -1 | 1): void {
		const limit = Math.min(maxDigestLimit, Math.max(minDigestLimit, this.values.limit + delta))

		if (limit === this.values.limit) {
			return
		}

		this.#set('limit', limit)
		this.destroy()
		this.#limitTimer = setTimeout(() => {
			this.#limitTimer = null
			// The save settles every failure itself, so nothing is left to catch here.
			this.#save('limit').catch(() => null)
		}, limitDebounceMs)
	}

	/** Drops a pending stepper save. */
	public destroy(): void {
		if (this.#limitTimer !== null) {
			clearTimeout(this.#limitTimer)
			this.#limitTimer = null
		}
	}

	#set<Field extends DigestField>(field: Field, value: DigestValues[Field]) {
		this.values = { ...this.values, [field]: value }
		this.errors = { ...this.errors, [field]: undefined }
	}

	async #save(field: DigestField) {
		const sent = this.values[field]
		const result = await this.#api.patchSettings(changeOf(field, this.values))
		// A later change of the same field owns it now; its own save settles it.
		const isCurrent = this.values[field] === sent

		if (result.ok) {
			this.#saved = { ...this.#saved, [field]: valuesOf(result.value)[field] }

			if (isCurrent) {
				this.values = { ...this.values, [field]: this.#saved[field] }
			}

			return
		}

		if (isCurrent) {
			this.values = { ...this.values, [field]: this.#saved[field] }
		}

		if (result.status === 400) {
			this.errors = {
				...this.errors,
				[field]: issueMessage(result.issues) ?? this.#strings.saveFailed,
			}
		} else if (result.status !== 401) {
			this.#toasts.show(errorToast(this.#strings.saveFailed))
		}
	}
}
