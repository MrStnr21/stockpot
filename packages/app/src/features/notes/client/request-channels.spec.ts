// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it } from 'bun:test'

import type { ApiResult } from './notes-api'
import { RequestChannels } from './request-channels'

interface Held {
	readonly signal: AbortSignal
	readonly resolve: (result: ApiResult<string>) => void
}

function ok(value: string): ApiResult<string> {
	return { kind: 'ok', value }
}

describe('RequestChannels', () => {
	let channels: RequestChannels
	let held: Held[]

	async function hold(signal: AbortSignal) {
		const { promise, resolve } = Promise.withResolvers<ApiResult<string>>()

		held.push({ signal, resolve })

		return promise
	}

	beforeEach(() => {
		channels = new RequestChannels()
		held = []
	})

	it('answers the request of a channel', async () => {
		const answer = channels.send('search', hold)

		held[0]?.resolve(ok('first'))

		expect(await answer).toEqual(ok('first'))
	})

	it('makes an older request stale and aborts it when a newer one is sent on its channel', async () => {
		const older = channels.send('search', hold)
		const newer = channels.send('search', hold)

		held[1]?.resolve(ok('newer'))
		held[0]?.resolve(ok('older'))

		expect([await older, await newer, held[0]?.signal.aborted]).toEqual([
			{ kind: 'stale' },
			ok('newer'),
			true,
		])
	})

	it('keeps channels apart', async () => {
		const search = channels.send('search', hold)
		const group = channels.send('group:2', hold)

		held[0]?.resolve(ok('search'))
		held[1]?.resolve(ok('group'))

		expect([await search, await group]).toEqual([ok('search'), ok('group')])
	})

	it('makes a cancelled or stopped request stale', async () => {
		const cancelled = channels.send('search', hold)
		const stopped = channels.send('overview', hold)

		channels.cancel('search')
		channels.stop()
		held[0]?.resolve(ok('search'))
		held[1]?.resolve(ok('overview'))

		expect([await cancelled, await stopped, held.map(({ signal }) => signal.aborted)]).toEqual([
			{ kind: 'stale' },
			{ kind: 'stale' },
			[true, true],
		])
	})
})
