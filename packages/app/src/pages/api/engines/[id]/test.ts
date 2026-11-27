// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import { instanceEngineTester } from '#/instance-engines'
import { engineIds } from '#/server/engines/settings'
import { HttpError, route, type ErrorBody, type RouteContext } from '#/server/http'

interface EngineContext extends RouteContext {
	readonly params: Readonly<Record<string, string | undefined>>
}

/*
 * Session only, like the rest of settings: a test is a paid call on the owner's key, so a device
 * token may not start one. The tester allows one running test per engine and a start every 10 s.
 */
export const POST = route.session<EngineContext>(async ({ params }) => {
	const id = v.safeParse(v.picklist(engineIds), params.id)

	if (!id.success) {
		throw new HttpError(404, { code: 'not_found', message: 'There is no such engine.' })
	}

	const tester = await instanceEngineTester()
	const answer = await tester.test(id.output)

	if (answer.status === 'not_set_up') {
		throw new HttpError(409, {
			code: 'not_set_up',
			message: 'Set up this engine before testing it.',
		})
	}

	if (answer.status === 'running') {
		throw new HttpError(409, {
			code: 'test_running',
			message: 'A test of this engine is already running.',
		})
	}

	if (answer.status === 'too_soon') {
		const seconds = Math.ceil(answer.retryAfterMs / 1000)

		const body: ErrorBody = {
			error: { code: 'too_soon', message: `Test this engine again in ${seconds} s.` },
		}

		return Response.json(body, { status: 429, headers: { 'retry-after': String(seconds) } })
	}

	return Response.json(answer.result, { headers: { 'cache-control': 'no-store' } })
})
