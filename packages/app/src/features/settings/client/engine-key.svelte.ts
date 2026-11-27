// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { PublicSettings } from '../shared/types'
import { issueMessage } from './digest-view'
import { testNoticeText, type EngineTester } from './engine-tester.svelte'
import type { SettingsApi } from './settings-api'
import { errorToast, type SettingsToasts } from './settings-toasts.svelte'

/** The engines whose key the owner sets here; the agent command has none. */
export type KeyEngine = 'gemini' | 'openai-compatible'

export type KeyState = 'set' | 'not set'

export interface EngineKeyOptions {
	readonly engine: KeyEngine
	readonly initial: KeyState
	readonly api: Pick<SettingsApi, 'patchSettings'>
	/** Tests the engine once after a key is saved, so a rejected key shows at once. */
	readonly tester: EngineTester
	readonly toasts: SettingsToasts
	readonly strings: Parameters<typeof testNoticeText>[1]
	/** Called with the settings after a save or a clear, such as to update the page. */
	readonly onsaved?: (settings: PublicSettings) => void
}

/**
 * A write-only key: the page knows only whether one is saved. A typed key lives in `value` until
 * Save, which empties the field before the request, whatever its answer; it never goes to a URL,
 * storage, a toast or the log, and the server's answer holds only its state.
 */
export class EngineKey {
	public state: KeyState

	public editing = $state(false)

	public value = $state('')

	public saving = $state(false)

	/** The server's reason for refusing the last key; never the key itself. */
	public error = $state<string | null>(null)

	public confirmingClear = $state(false)

	/** Whether the latest save ran the test, so the form shows its result. */
	public tested = $state(false)

	readonly #options: EngineKeyOptions

	public constructor(options: EngineKeyOptions) {
		this.state = $state(options.initial)
		this.#options = options
	}

	public get canSave(): boolean {
		return this.value.trim() !== '' && !this.saving
	}

	public start(): void {
		this.editing = true
		this.error = null
	}

	public cancel(): void {
		this.value = ''
		this.editing = false
		this.error = null
	}

	/** Saves the typed key, then tests the engine with it. */
	public async save(): Promise<void> {
		const apiKey = this.value.trim()

		// The field is emptied before the request, so the key is gone from the page whatever happens.
		this.value = ''

		if (apiKey === '' || this.saving) {
			return
		}

		this.saving = true
		this.error = null
		this.tested = false

		const saved = await this.#change({ apiKey })

		this.saving = false

		if (!saved) {
			return
		}

		this.editing = false

		const notice = await this.#options.tester.test(this.#options.engine)

		if (notice === null) {
			this.tested = true
		} else {
			this.#options.toasts.show(errorToast(testNoticeText(notice, this.#options.strings)))
		}
	}

	public askClear(): void {
		this.confirmingClear = true
	}

	public cancelClear(): void {
		this.confirmingClear = false
	}

	/** Clears the saved key, after the confirm dialog. */
	public async clear(): Promise<void> {
		this.saving = true

		const cleared = await this.#change({ apiKey: null })

		this.saving = false
		this.confirmingClear = false

		if (cleared) {
			this.tested = false
		}
	}

	async #change(change: { readonly apiKey: string | null }): Promise<boolean> {
		const { engine, api, toasts, strings, onsaved } = this.#options

		const result = await api.patchSettings({
			engines: engine === 'gemini' ? { gemini: change } : { 'openai-compatible': change },
		})

		if (result.ok) {
			this.state = result.value.engines[engine].apiKey
			onsaved?.(result.value)

			return true
		}

		if (result.status === 400) {
			this.error = issueMessage(result.issues) ?? strings.errors.saveFailed
		} else if (result.status !== 401) {
			toasts.show(errorToast(strings.errors.saveFailed))
		}

		return false
	}
}
