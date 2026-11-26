// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * A long press on a list row starts select mode with that row selected. It fires after 500 ms of a
 * pointer held within 10 px of where it went down, and the click that follows the release is
 * swallowed, so the row's link does not open. Attached to the kit ListRow's link or button.
 */

/** How long a pointer is held before a press counts as long. */
export const longPressMs = 500

/** How far a held pointer may wander, in CSS pixels, before the press is a scroll instead. */
export const longPressSlopPx = 10

/** The parts of an element the gesture uses; every HTMLElement has them. */
export type LongPressTarget = Pick<HTMLElement, 'addEventListener'> & {
	readonly style: Pick<CSSStyleDeclaration, 'setProperty'>
}

interface Point {
	readonly x: number
	readonly y: number
}

/** The gesture as a Svelte attachment: `attach={longPress(() => select(id))}`. */
export function longPress(onLongPress: () => void): (element: LongPressTarget) => () => void {
	return (element) => {
		const listening = new AbortController()
		let start: Point | null = null
		let timer: ReturnType<typeof setTimeout> | null = null
		let swallowsClick = false

		function cancel() {
			start = null

			if (timer !== null) {
				clearTimeout(timer)
				timer = null
			}
		}

		/* A mouse's other buttons open menus of their own; touch and pen report the primary button as 0. */
		function down(event: PointerEvent) {
			cancel()
			swallowsClick = false

			if (event.button !== 0) {
				return
			}

			start = { x: event.clientX, y: event.clientY }
			timer = setTimeout(() => {
				timer = null
				start = null
				swallowsClick = true
				onLongPress()
			}, longPressMs)
		}

		function move(event: PointerEvent) {
			if (
				start !== null &&
				Math.hypot(event.clientX - start.x, event.clientY - start.y) > longPressSlopPx
			) {
				cancel()
			}
		}

		function click(event: MouseEvent) {
			if (swallowsClick) {
				swallowsClick = false
				event.preventDefault()
				event.stopImmediatePropagation()
			}
		}

		/* Touch browsers open the link menu on the same hold; the press owns it while it lasts. */
		function contextMenu(event: MouseEvent) {
			if (start !== null || swallowsClick) {
				event.preventDefault()
			}
		}

		// Without it, iOS shows a link preview on the same hold.
		element.style.setProperty('-webkit-touch-callout', 'none')

		const options = { signal: listening.signal }

		element.addEventListener('pointerdown', down, options)
		element.addEventListener('pointermove', move, options)
		element.addEventListener('pointerup', cancel, options)
		element.addEventListener('pointercancel', cancel, options)
		element.addEventListener('pointerleave', cancel, options)
		element.addEventListener('click', click, { ...options, capture: true })
		element.addEventListener('contextmenu', contextMenu, options)

		return () => {
			cancel()
			listening.abort()
		}
	}
}
