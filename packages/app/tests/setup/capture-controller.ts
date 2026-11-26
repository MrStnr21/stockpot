// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { drainMicrotasks } from 'bun:jsc'
import { savedNoteFactory, suggestAnswerFactory } from '#tests/factories/suggestions'

import { CaptureController } from '#/features/capture/client/capture-controller.svelte'
import type { SuggestAnswer } from '#/features/capture/shared/types'
import { en } from '#/lib/i18n/en'

/** One request the controller sent, answered or failed when the spec says so. */
export interface CaptureFetchCall {
	readonly url: string
	readonly method: string | undefined
	readonly body: unknown
	readonly respond: (response: Response) => void
	readonly fail: (error: Error) => void
}

export const captureCategories = [
	{ id: 1, name: 'Technology', color: 'tech', icon: 'tech' },
	{ id: 2, name: 'Concept', color: 'concept', icon: 'concept' },
] as const

/** The real capture controller, open, over a fetch the spec answers by hand. */
export class CaptureHarness {
	public readonly calls: CaptureFetchCall[] = []

	public readonly controller = new CaptureController({
		categories: captureCategories,
		strings: en.capture,
		fetch: async (url, init) => {
			const { promise, resolve, reject } = Promise.withResolvers<Response>()

			this.calls.push({
				url,
				method: init.method,
				body: init.body === undefined ? null : JSON.parse(init.body),
				respond: resolve,
				fail: reject,
			})

			return promise
		},
		signIn: () => {
			// No spec over this harness is signed out.
		},
		isOnline: () => true,
	})

	public constructor() {
		this.controller.setOpen(true)
	}

	public call(index: number): CaptureFetchCall {
		const found = this.calls.at(index)

		if (found === undefined) {
			throw new Error(`There is no request ${index}.`)
		}

		return found
	}

	/** Reopening and typing ask for suggestions too, so the save is found by its address. */
	public saveCall(): CaptureFetchCall {
		const found = this.calls.find(({ url }) => url === '/api/notes')

		if (found === undefined) {
			throw new Error('No save was sent.')
		}

		return found
	}

	public answerSave(): void {
		this.saveCall().respond(
			Response.json(savedNoteFactory.build({ text: 'Alpha' }), { status: 201 }),
		)
		drainMicrotasks()
	}

	public answerSuggest(index: number, answer: Partial<SuggestAnswer>): void {
		this.call(index).respond(Response.json(suggestAnswerFactory.build(answer)))
		drainMicrotasks()
	}

	public type(term: string): void {
		this.controller.term = term
		this.controller.termChanged()
	}

	public toastTitle(): string | undefined {
		return this.controller.toasts.current?.title
	}
}
