// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { iconNames } from '@stockpot/ui/icon'

import { categoryIcons } from './category-look'

describe('category-look', () => {
	it.each(categoryIcons)('offers %s only if the kit can draw it', (icon) => {
		expect(iconNames).toContain(icon)
	})
})
