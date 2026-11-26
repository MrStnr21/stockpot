// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { drainMicrotasks } from 'bun:jsc'
import { cardStrings } from '#tests/setup/card-strings'
import { FakeVisibility } from '#tests/setup/page-visibility'

import type { JsonFetch } from '#/features/research/client/card-api'
import {
	CardController,
	type CardControllerOptions,
} from '#/features/research/client/card-controller.svelte'
import type { CardView } from '#/features/research/shared/card-view'

/** The JSON bodies the card's routes answer with. */
export type CardAnswer =
	| CardView
	| { readonly outcome: string; readonly depth?: number | null; readonly id?: number }
	| { readonly error: { readonly code: string; readonly message: string } }

/** One request the card sent, answered or failed when the spec says so. */
export interface CardFetchCall {
	readonly url: string
	readonly method: string
	readonly body: string | null
	readonly signal: AbortSignal | null
	/** Answers with this JSON, or with no body for a 204, and lets every awaiting step run. */
	readonly answer: (body: CardAnswer | null, status?: number) => void
	readonly fail: (error: Error) => void
}

/** A `fetch` that holds every request until the spec answers it, in any order. */
export class CardFetch {
	public readonly calls: CardFetchCall[] = []

	public readonly fetch: JsonFetch = async (url, init) => {
		const { promise, resolve, reject } = Promise.withResolvers<Response>()

		this.calls.push({
			url,
			method: init.method ?? 'GET',
			body: init.body ?? null,
			signal: init.signal ?? null,
			answer: (body, status = 200) => {
				resolve(body === null ? new Response(null, { status }) : Response.json(body, { status }))
				drainMicrotasks()
			},
			fail: (error) => {
				reject(error)
				drainMicrotasks()
			},
		})

		return promise
	}

	/** The request at `index`; a negative index counts from the end. */
	public call(index: number): CardFetchCall {
		const found = this.calls.at(index)

		if (found === undefined) {
			throw new Error(`There is no request ${index}.`)
		}

		return found
	}

	/** Each request as "METHOD url body". */
	public sent(): string[] {
		return this.calls.map(({ method, url, body }) => [method, url, body ?? ''].join(' ').trim())
	}
}

/** The real card controller over a fetch the spec answers by hand. */
export class CardHarness {
	public readonly requests = new CardFetch()

	public readonly visibility = new FakeVisibility()

	public signIns = 0

	/** How often the card told the page its notes changed. */
	public notesChanged = 0

	public readonly controller: CardController

	public constructor(initial: CardView | null, options: Partial<CardControllerOptions> = {}) {
		this.controller = new CardController({
			initial,
			strings: cardStrings,
			fetch: this.requests.fetch,
			visibility: this.visibility,
			signIn: () => {
				this.signIns += 1
			},
			notesChanged: () => {
				this.notesChanged += 1
			},
			...options,
		})
	}

	public toast(): string | undefined {
		return this.controller.toasts.current?.title
	}

	/** The card on screen, or `null`. */
	public view(): CardView | null {
		const { state } = this.controller

		return state.kind === 'card' || state.kind === 'deleted' ? state.view : null
	}
}
