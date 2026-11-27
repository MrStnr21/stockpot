// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { SettingsMessages } from '#/lib/i18n/settings-en'

import type { EngineId } from '../shared/engines'
import type { EngineTestResult } from '../shared/types'
import type { SettingsApi } from './settings-api'

/** One engine's test on this page: whether it runs, and how the latest one ended. */
export interface EngineTestSlot {
	readonly busy: boolean
	readonly result: EngineTestResult | null
}

/** Why a test did not run, for a toast; `null` when there is nothing to say. */
export type EngineTestNotice =
	| { readonly kind: 'running' }
	| { readonly kind: 'too_soon'; readonly seconds: number }
	| { readonly kind: 'not_set_up' }
	| { readonly kind: 'failed' }

/** The wait when a 429 names none: the server's cooldown. */
export const defaultRetrySeconds = 10

export interface EngineTesterOptions {
	readonly api: Pick<SettingsApi, 'testEngine'>
	readonly now?: () => Date
}

const idle: EngineTestSlot = { busy: false, result: null }

/**
 * The Test buttons of a page. One request per engine at a time; after a 429 the next press within
 * the server's wait answers at once, without a request. The server guards the cost itself; this only
 * spares it requests it would refuse.
 */
export class EngineTester {
	public slots = $state.raw<Readonly<Record<EngineId, EngineTestSlot>>>({
		'agent-command': idle,
		gemini: idle,
		'openai-compatible': idle,
	})

	readonly #api: EngineTesterOptions['api']

	readonly #now: () => Date

	readonly #retryAt = new Map<EngineId, number>()

	public constructor({ api, now = () => new Date() }: EngineTesterOptions) {
		this.#api = api
		this.#now = now
	}

	public slot(id: EngineId): EngineTestSlot {
		return this.slots[id]
	}

	/** Runs one test of the engine; the answer lands in its slot, or comes back as a notice. */
	public async test(id: EngineId): Promise<EngineTestNotice | null> {
		if (this.slots[id].busy) {
			return null
		}

		const wait = (this.#retryAt.get(id) ?? 0) - this.#now().getTime()

		if (wait > 0) {
			return { kind: 'too_soon', seconds: Math.ceil(wait / 1000) }
		}

		this.#set(id, { ...this.slots[id], busy: true })

		const answer = await this.#api.testEngine(id)

		if (answer.ok) {
			this.#set(id, { busy: false, result: answer.value })

			return null
		}

		this.#set(id, { ...this.slots[id], busy: false })

		if (answer.status === 429) {
			const seconds = answer.retryAfter ?? defaultRetrySeconds

			this.#retryAt.set(id, this.#now().getTime() + seconds * 1000)

			return { kind: 'too_soon', seconds }
		}

		if (answer.status === 409) {
			return answer.code === 'not_set_up' ? { kind: 'not_set_up' } : { kind: 'running' }
		}

		// A 401 already went to sign-in.
		return answer.status === 401 ? null : { kind: 'failed' }
	}

	#set(id: EngineId, slot: EngineTestSlot) {
		this.slots = { ...this.slots, [id]: slot }
	}
}

/** A notice's toast text. */
export function testNoticeText(
	notice: EngineTestNotice,
	strings: Pick<SettingsMessages, 'testOutcome' | 'engineState' | 'errors'>,
): string {
	if (notice.kind === 'too_soon') {
		return strings.testOutcome.tooSoon.replaceAll('{seconds}', String(notice.seconds))
	}

	const texts = {
		running: strings.testOutcome.running,
		not_set_up: strings.engineState.notSetUp,
		failed: strings.errors.testFailed,
	} satisfies Record<typeof notice.kind, string>

	return texts[notice.kind]
}
