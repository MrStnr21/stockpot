// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { mock } from 'bun:test'

import {
	createSuggestionRunner,
	type SuggestionInput,
	type SuggestionState,
} from '#/features/capture/client/suggestions'

/** One `POST /api/suggest` the runner sent, answered when the spec says so. */
export interface SuggestFetchCall {
	readonly url: string
	readonly body: unknown
	readonly signal: AbortSignal | null | undefined
	readonly respond: (response: Response) => void
	readonly fail: (error: Error) => void
}

/** A suggestion runner over a fetch the spec answers by hand, with the sheet's fields to type into. */
export class SuggestionHarness {
	public input: SuggestionInput = { text: '', contextField: '', private: false }

	public online = true

	public readonly calls: SuggestFetchCall[] = []

	public readonly states: SuggestionState[] = []

	public readonly runner = createSuggestionRunner({
		fetch: mock(async (url: string, init: RequestInit & { readonly body?: string }) => {
			const { promise, resolve, reject } = Promise.withResolvers<Response>()

			this.calls.push({
				url,
				body: init.body === undefined ? null : JSON.parse(init.body),
				signal: init.signal,
				respond: resolve,
				fail: reject,
			})

			return promise
		}),
		read: () => this.input,
		onChange: (state) => {
			this.states.push(state)
		},
		isOnline: () => this.online,
	})

	/** Changes the fields without telling the runner, as an edit of the context does. */
	public edit(changes: Partial<SuggestionInput>): void {
		this.input = { ...this.input, ...changes }
	}

	/** Types a new term. */
	public type(text: string): void {
		this.edit({ text })
		this.runner.schedule()
	}

	public call(index: number): SuggestFetchCall {
		const found = this.calls.at(index)

		if (found === undefined) {
			throw new Error(`There is no request ${index}.`)
		}

		return found
	}

	public lastState(): SuggestionState | undefined {
		return this.states.at(-1)
	}
}
