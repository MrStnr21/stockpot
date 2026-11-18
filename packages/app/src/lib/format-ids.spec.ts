// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { isFormatId } from './format-ids'

describe('isFormatId', () => {
	it.each(['vocabulary', 'brief'])('accepts %s', (id) => {
		expect(isFormatId(id)).toBe(true)
	})

	it.each(['Technology', 'toString', ''])('rejects %p', (id) => {
		expect(isFormatId(id)).toBe(false)
	})
})
