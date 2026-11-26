// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import * as v from 'valibot'

import { cardSourceSchema } from './card-view'

describe('card view', () => {
	// oxlint-disable-next-line eslint/no-script-url -- The spec checks that such a link is rejected.
	it.each(['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com/file'])(
		'rejects the source address %s',
		(url) => {
			expect(v.safeParse(cardSourceSchema, { title: 'A page', url }).success).toBe(false)
		},
	)

	it('accepts an HTTPS source', () => {
		const source = { title: 'A page', url: 'https://example.com/docs' }

		expect(v.parse(cardSourceSchema, source)).toEqual(source)
	})
})
