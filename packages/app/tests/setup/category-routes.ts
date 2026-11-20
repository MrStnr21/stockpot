// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { faker } from '@faker-js/faker'

import { sendThroughMiddleware, signedInInstance, type RouteHandler } from './auth'
import type { TestDb } from './db'

const publicOrigin = 'http://127.0.0.1:4321'

interface CategoryRequest {
	readonly as?: 'owner' | 'device' | 'nobody'
	readonly segment?: string
	readonly search?: string
	readonly body?: string
}

type SendCategoryRequest = (
	handler: RouteHandler,
	method: string,
	sent?: CategoryRequest,
) => Promise<Response>

/** Sends category requests through the middleware with a real session or device token. */
export function categoryRequests(db: TestDb): SendCategoryRequest {
	const { auth, session } = signedInInstance(db, publicOrigin)

	return async (handler, method, sent = {}) => {
		const { as = 'owner', segment, search = '', body } = sent
		const headers = new Headers({ 'content-type': 'application/json' })

		if (as === 'device') {
			headers.set('authorization', `Bearer ${auth.devices.create(faker.word.noun()).token}`)
		} else if (as === 'owner') {
			headers.set('origin', publicOrigin)
		}

		const path = segment === undefined ? '/api/categories' : `/api/categories/${segment}`
		const request = new Request(`${publicOrigin}${path}${search}`, { method, headers, body })
		const cookies = as === 'owner' ? session : undefined

		return sendThroughMiddleware(
			{ auth, publicOrigin },
			{ request, cookies, params: { id: segment } },
			handler,
		)
	}
}
