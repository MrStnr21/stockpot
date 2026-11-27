// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { CreatedDevice, SettingsFetch as Fetch } from '#/features/settings/client/settings-api'
import type {
	CategoryRecord,
	DeviceRow,
	EngineTestResult,
	PublicSettings,
} from '#/features/settings/shared/types'

/** The JSON bodies the settings routes answer with. */
export type SettingsAnswer =
	| PublicSettings
	| EngineTestResult
	| CreatedDevice
	| CategoryRecord
	| { readonly devices: readonly DeviceRow[] }
	| {
			readonly error: {
				readonly code: string
				readonly message: string
				readonly issues?: string[]
				readonly notes?: number
			}
	  }

/** One request a settings page sent. */
export interface SettingsFetchCall {
	readonly url: string
	readonly method: string
	readonly body: unknown
}

/**
 * A `fetch` that answers each request with the next queued answer (a 204 when none is queued) and
 * keeps every request for the spec to read. An `Error` in the queue fails that request.
 */
export class SettingsFetch {
	public readonly calls: SettingsFetchCall[] = []

	readonly #answers: (Response | Error)[] = []

	public readonly fetch: Fetch = async (url, init) => {
		this.calls.push({
			url,
			method: init.method ?? 'GET',
			body: init.body === undefined ? null : JSON.parse(init.body),
		})

		const answer = this.#answers.shift() ?? new Response(null, { status: 204 })

		if (answer instanceof Error) {
			throw answer
		}

		return answer
	}

	/** Queues a JSON answer. */
	public answer(body: SettingsAnswer, status = 200, headers: Record<string, string> = {}): this {
		this.#answers.push(Response.json(body, { status, headers }))

		return this
	}

	/** Queues an error answer as the routes send it. */
	public refuse(
		status: number,
		code: string,
		extra: { readonly issues?: string[]; readonly notes?: number } = {},
	): this {
		return this.answer({ error: { code, message: 'Refused.', ...extra } }, status)
	}

	/** Queues a 204. */
	public empty(): this {
		this.#answers.push(new Response(null, { status: 204 }))

		return this
	}

	/** Queues a network failure. */
	public fail(): this {
		this.#answers.push(new TypeError('Failed to fetch'))

		return this
	}

	public call(index: number): SettingsFetchCall {
		const found = this.calls.at(index)

		if (found === undefined) {
			throw new Error(`There is no request ${index}.`)
		}

		return found
	}
}
