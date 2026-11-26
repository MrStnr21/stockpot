// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/* The list's small ties to the page: the end of the list in view, the search field's limit, Escape. */

/** How far ahead of the list's end the next page starts loading. */
export const nearEndMargin = '400px'

export interface Observer<Target> {
	observe: (target: Target) => void
	disconnect: () => void
}

export type ObserverFactory<Target> = (
	callback: (entries: readonly Pick<IntersectionObserverEntry, 'isIntersecting'>[]) => void,
	options: IntersectionObserverInit,
) => Observer<Target>

function viewportObserver(
	...[callback, options]: Parameters<ObserverFactory<Element>>
): Observer<Element> {
	return new IntersectionObserver(callback, options)
}

/** `nearEnd` over any observer, so a spec can stand in for the browser's. */
export function nearEndWith<Target>(
	createObserver: ObserverFactory<Target>,
	onNear: () => void,
): (element: Target) => () => void {
	return (element) => {
		const observer = createObserver(
			(entries) => {
				if (entries.some(({ isIntersecting }) => isIntersecting)) {
					onNear()
				}
			},
			{ root: null, rootMargin: nearEndMargin },
		)

		observer.observe(element)

		return () => {
			observer.disconnect()
		}
	}
}

/**
 * Calls `onNear` while the element comes within 400 px of the viewport. Attach it again when the
 * rows change, so a list still short of the viewport's end keeps loading.
 */
export function nearEnd(onNear: () => void): (element: Element) => () => void {
	return nearEndWith(viewportObserver, onNear)
}

/** What `limitInput` touches: the text fields inside an element. */
export interface InputHost {
	querySelectorAll: (selector: 'input') => Iterable<{ maxLength: number }>
}

/** Caps the text fields inside an element, such as the kit's search field, at `max` characters. */
export function limitInput(max: number): (element: InputHost) => void {
	return (element) => {
		for (const input of element.querySelectorAll('input')) {
			input.maxLength = max
		}
	}
}

/** Escape ends select mode, unless a sheet is open: then it closes the sheet only. */
export function endsSelection(
	event: Pick<KeyboardEvent, 'key' | 'defaultPrevented'>,
	isSelecting: boolean,
	isDialogOpen: boolean,
): boolean {
	return event.key === 'Escape' && !event.defaultPrevented && isSelecting && !isDialogOpen
}
