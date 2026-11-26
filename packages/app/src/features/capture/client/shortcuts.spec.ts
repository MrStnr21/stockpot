// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'

import {
	isApplePlatform,
	isPlainClick,
	opensSheet,
	sheetShortcut,
	type ShortcutKey,
} from './shortcuts'

function press(key: string, params: Partial<ShortcutKey> = {}): ShortcutKey {
	return {
		key,
		code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		repeat: false,
		isComposing: false,
		defaultPrevented: false,
		...params,
	}
}

describe('shortcuts', () => {
	describe('sheetShortcut', () => {
		it.each([
			['Meta+Enter', press('Enter', { metaKey: true }), 'save'],
			['Ctrl+Enter', press('Enter', { ctrlKey: true }), 'save'],
			['Shift+Meta+Enter', press('Enter', { metaKey: true, shiftKey: true }), 'research'],
			['Shift+Ctrl+Enter', press('Enter', { ctrlKey: true, shiftKey: true }), 'research'],
			['plain Enter', press('Enter'), null],
			['Shift+Enter', press('Enter', { shiftKey: true }), null],
			['Alt+Meta+Enter', press('Enter', { metaKey: true, altKey: true }), null],
			['a held Meta+Enter', press('Enter', { metaKey: true, repeat: true }), null],
			[
				'Meta+Enter ending a composition',
				press('Enter', { metaKey: true, isComposing: true }),
				null,
			],
			['a handled Meta+Enter', press('Enter', { metaKey: true, defaultPrevented: true }), null],
			['Meta+S', press('s', { metaKey: true }), null],
		] as const)('maps %s', (_case, event, shortcut) => {
			expect(sheetShortcut(event)).toBe(shortcut)
		})
	})

	describe('opensSheet', () => {
		const page = { tagName: 'BODY', isContentEditable: false }

		it.each([
			['N on the page', { event: press('n'), target: page }, true],
			['N with Caps Lock', { event: press('N'), target: page }, true],
			[
				'the N key on a Russian layout',
				{ event: press('т', { code: 'KeyN' }), target: page },
				true,
			],
			['N on a link', { event: press('n'), target: { tagName: 'A' } }, true],
			['N without a target', { event: press('n'), target: null }, true],
			['N in an input', { event: press('n'), target: { tagName: 'INPUT' } }, false],
			['N in a text area', { event: press('n'), target: { tagName: 'TEXTAREA' } }, false],
			['N in a select', { event: press('n'), target: { tagName: 'SELECT' } }, false],
			[
				'N in editable content',
				{ event: press('n'), target: { tagName: 'DIV', isContentEditable: true } },
				false,
			],
			['Meta+N', { event: press('n', { metaKey: true }), target: page }, false],
			['Ctrl+N', { event: press('n', { ctrlKey: true }), target: page }, false],
			['Alt+N', { event: press('n', { altKey: true }), target: page }, false],
			['Shift+N', { event: press('N', { shiftKey: true }), target: page }, false],
			['a held N', { event: press('n', { repeat: true }), target: page }, false],
			['a handled N', { event: press('n', { defaultPrevented: true }), target: page }, false],
			[
				'B where a Dvorak layout has N',
				{ event: press('b', { code: 'KeyN' }), target: page },
				false,
			],
		] as const)('opens for %s: %p', (_case, { event, target }, opens) => {
			expect(opensSheet(event, target, false)).toBe(opens)
		})

		it('does not open while a dialog is open', () => {
			expect(opensSheet(press('n'), page, true)).toBe(false)
		})
	})

	describe('isApplePlatform', () => {
		it.each([
			['a Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', true],
			['an iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', true],
			['an iPad', 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', true],
			['Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0', false],
			['Linux', 'Mozilla/5.0 (X11; Linux x86_64) Firefox/133.0', false],
		])('detects %s', (_case, userAgent, expected) => {
			expect(isApplePlatform(userAgent)).toBe(expected)
		})
	})

	describe('isPlainClick', () => {
		const click = {
			button: 0,
			metaKey: false,
			ctrlKey: false,
			altKey: false,
			shiftKey: false,
			defaultPrevented: false,
		}

		it.each([
			['a primary click', click, true],
			['a middle click', { ...click, button: 1 }, false],
			['a Meta click', { ...click, metaKey: true }, false],
			['a Ctrl click', { ...click, ctrlKey: true }, false],
			['a Shift click', { ...click, shiftKey: true }, false],
			['an Alt click', { ...click, altKey: true }, false],
			['a handled click', { ...click, defaultPrevented: true }, false],
		])('treats %s', (_case, event, expected) => {
			expect(isPlainClick(event)).toBe(expected)
		})
	})
})
