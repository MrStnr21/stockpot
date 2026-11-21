// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import { iconNames, icons } from './icons'

describe('icons', () => {
	it('lists each name in the sprite exactly once', () => {
		expect(Object.keys(icons).toSorted()).toEqual(iconNames.toSorted())
	})
})
