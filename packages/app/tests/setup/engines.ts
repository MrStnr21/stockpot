// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { serve } from 'bun'

import { parseJsonText, type JsonValue } from '#/server/engines/contract'

/** The error a call failed with; fails the test when the call succeeds. */
export async function errorOf<T>(call: Promise<T>): Promise<Error> {
	try {
		await call
	} catch (error) {
		if (error instanceof Error) {
			return error
		}

		throw error
	}

	throw new Error('Expected the call to fail')
}

/** A chat completion carrying `message`, as an OpenAI-compatible endpoint answers. */
export function completion(
	message: Readonly<Record<string, string | null>>,
	finishReason = 'stop',
): Response {
	return Response.json({
		model: 'model-a-2026',
		choices: [{ message: { role: 'assistant', ...message }, finish_reason: finishReason }],
		usage: { prompt_tokens: 900, completion_tokens: 120 },
	})
}

export interface ReceivedRequest {
	readonly path: string
	readonly authorization: string | null
	readonly body: JsonValue
}

/** A local stand-in for an OpenAI-compatible endpoint, for specs that must not reach the network. */
export interface FakeEndpoint {
	readonly url: URL
	/** Every request but pings, oldest first; a spec empties it between tests. */
	readonly requests: ReceivedRequest[]
	/** How the endpoint answers; a spec replaces it per test. */
	respond: (request: Request) => Promise<Response>
	/** A round trip through the server, in which any request sent before it has arrived. */
	ping: () => Promise<void>
	stop: () => Promise<void>
}

export function startFakeEndpoint(): FakeEndpoint {
	const requests: ReceivedRequest[] = []

	const server = serve({
		port: 0,
		async fetch(request) {
			const path = new URL(request.url).pathname

			if (path === '/ping') {
				return new Response('pong')
			}

			const authorization = request.headers.get('authorization')

			requests.push({ path, authorization, body: parseJsonText(await request.text()) })

			return endpoint.respond(request)
		},
	})

	const endpoint: FakeEndpoint = {
		url: server.url,
		requests,
		respond: async () => new Response('No answer set', { status: 500 }),
		ping: async () => {
			await fetch(new URL('/ping', server.url))
		},
		stop: async () => {
			await server.stop(true)
		},
	}

	return endpoint
}
