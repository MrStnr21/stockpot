// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Attachment } from 'svelte/attachments'

export interface SortableOptions {
	/** Where the grip's item is now. */
	readonly index: () => number
	readonly count: () => number
	/** Moves the item while the pointer drags it. */
	readonly onMove: (from: number, to: number) => void
	/** The drag ended with the item somewhere else: save the order. */
	readonly onDrop: () => void
}

/** The row the grip belongs to: the closest element marked `data-sortable-row`. */
function rowOf(grip: HTMLElement): HTMLElement {
	return grip.closest<HTMLElement>('[data-sortable-row]') ?? grip
}

/**
 * Pointer drag on a grip: the pointer is captured, and the item moves one place for each row height
 * the pointer travels, measured once when the drag starts. The row carries `data-dragging` meanwhile.
 * Keys are the grip's own (see `keyMove`); this is the pointer half.
 */
export function sortable(options: SortableOptions): Attachment<HTMLElement> {
	return (grip) => {
		let drag: {
			pointerId: number
			startY: number
			rowHeight: number
			from: number
			at: number
		} | null = null

		function onPointerDown(event: PointerEvent) {
			if (event.button !== 0) {
				return
			}

			event.preventDefault()
			grip.setPointerCapture(event.pointerId)

			const from = options.index()

			drag = {
				pointerId: event.pointerId,
				startY: event.clientY,
				rowHeight: Math.max(1, rowOf(grip).getBoundingClientRect().height),
				from,
				at: from,
			}
			rowOf(grip).dataset.dragging = ''
		}

		function onPointerMove(event: PointerEvent) {
			if (drag?.pointerId !== event.pointerId) {
				return
			}

			const steps = Math.round((event.clientY - drag.startY) / drag.rowHeight)
			const target = Math.min(options.count() - 1, Math.max(0, drag.from + steps))

			if (target !== drag.at) {
				options.onMove(drag.at, target)
				drag.at = target
			}
		}

		function onPointerEnd(event: PointerEvent) {
			if (drag?.pointerId !== event.pointerId) {
				return
			}

			const moved = drag.at !== drag.from

			drag = null
			delete rowOf(grip).dataset.dragging

			if (grip.hasPointerCapture(event.pointerId)) {
				grip.releasePointerCapture(event.pointerId)
			}

			if (moved) {
				options.onDrop()
			}
		}

		grip.addEventListener('pointerdown', onPointerDown)
		grip.addEventListener('pointermove', onPointerMove)
		grip.addEventListener('pointerup', onPointerEnd)
		grip.addEventListener('pointercancel', onPointerEnd)

		return () => {
			grip.removeEventListener('pointerdown', onPointerDown)
			grip.removeEventListener('pointermove', onPointerMove)
			grip.removeEventListener('pointerup', onPointerEnd)
			grip.removeEventListener('pointercancel', onPointerEnd)
		}
	}
}
