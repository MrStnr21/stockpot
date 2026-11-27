// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Requests that replace each other on a named channel, such as a search or one group's pages. A
 * request takes a fresh ticket on its channel and aborts the one before it. Its answer applies only
 * while its ticket is still the channel's own and was not aborted, since an abort can lose the race
 * with a body that has already arrived (as `list-loader.ts` explains).
 */
import type { ApiResult } from './notes-api'

/** An answer, or `stale` once a newer request on the channel, a cancel or a stop took over. */
export type ChannelAnswer<T> = ApiResult<T> | { readonly kind: 'stale' }

export class RequestChannels {
	readonly #tickets = new Map<string, AbortController>()

	/** Sends on a channel, aborting the request it had on its way. */
	public async send<T>(
		channel: string,
		send: (signal: AbortSignal) => Promise<ApiResult<T>>,
	): Promise<ChannelAnswer<T>> {
		this.cancel(channel)

		const ticket = new AbortController()

		this.#tickets.set(channel, ticket)

		const result = await send(ticket.signal)

		if (this.#tickets.get(channel) !== ticket || ticket.signal.aborted) {
			return { kind: 'stale' }
		}

		this.#tickets.delete(channel)

		return result
	}

	/** Aborts the channel's request; its answer is stale. */
	public cancel(channel: string): void {
		this.#tickets.get(channel)?.abort()
		this.#tickets.delete(channel)
	}

	/** Aborts every request on its way. */
	public stop(): void {
		for (const ticket of this.#tickets.values()) {
			ticket.abort()
		}

		this.#tickets.clear()
	}
}
