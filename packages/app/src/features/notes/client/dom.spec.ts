// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it, mock, type Mock } from 'bun:test'

import { endsSelection, limitInput, nearEndMargin, nearEndWith, type ObserverFactory } from './dom'

type Callback = Parameters<ObserverFactory<string>>[0]

describe('the list’s page ties', () => {
	describe('nearEnd', () => {
		let callback: Callback | null
		let options: IntersectionObserverInit | null
		let observed: string[]
		let disconnect: Mock<() => void>
		let onNear: Mock<() => void>

		function factory(...[given, init]: Parameters<ObserverFactory<string>>) {
			callback = given
			options = init

			return {
				observe: (target: string) => {
					observed.push(target)
				},
				disconnect,
			}
		}

		beforeEach(() => {
			callback = null
			options = null
			observed = []
			disconnect = mock(() => {
				// A spec checks the calls.
			})
			onNear = mock(() => {
				// A spec checks the calls.
			})
		})

		it('watches the element 400 px ahead of the viewport and stops when detached', () => {
			const detach = nearEndWith(factory, onNear)('sentinel')

			expect(observed).toEqual(['sentinel'])
			expect(options).toEqual({ root: null, rootMargin: nearEndMargin })

			detach()

			expect(disconnect).toHaveBeenCalledTimes(1)
		})

		it('calls only while the element is near', () => {
			nearEndWith(factory, onNear)('sentinel')

			callback?.([{ isIntersecting: false }])

			expect(onNear).not.toHaveBeenCalled()

			callback?.([{ isIntersecting: true }])

			expect(onNear).toHaveBeenCalledTimes(1)
		})
	})

	it('caps every input inside the element', () => {
		const inputs = [{ maxLength: -1 }, { maxLength: -1 }]

		limitInput(200)({ querySelectorAll: () => inputs })

		expect(inputs.map(({ maxLength }) => maxLength)).toEqual([200, 200])
	})

	it('ends select mode on Escape only while selecting and no sheet is open', () => {
		const escape = { key: 'Escape', defaultPrevented: false }

		expect([
			endsSelection(escape, true, false),
			endsSelection(escape, false, false),
			endsSelection(escape, true, true),
			endsSelection({ ...escape, defaultPrevented: true }, true, false),
			endsSelection({ ...escape, key: 'Enter' }, true, false),
		]).toEqual([true, false, false, false, false])
	})
})
