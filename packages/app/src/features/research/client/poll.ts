// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Keeps an opened card current while its research runs (WEB-5 decision 4): every 3 s while an engine
 * writes, every 10 s while a job is due and waits for the worker. A job that waits for tonight's run
 * or for a limit to reset gets one look when its time comes, and the usual rhythm after that; the
 * card also catches up when the page is shown again or after an action. A hidden tab polls nothing;
 * one request at a time.
 */
import type { CardView, JobView } from '../shared/card-view'

export const researchingPollMs = 3000

export const waitingPollMs = 10_000

/** A timer longer than this fires at once (a signed 32-bit count of milliseconds). */
export const longestTimerMs = 2_147_483_647

function jobsOf(view: CardView): JobView[] {
	return view.levels.flatMap(({ job }) => (job === null ? [] : [job]))
}

/** How long to wait before the next look at this card at `now`, or `null` when no look is due. */
export function pollDelay(view: CardView, now: number): number | null {
	const jobs = jobsOf(view)

	if (view.note.status === 'researching' || jobs.some(({ state }) => state === 'researching')) {
		return researchingPollMs
	}

	if (jobs.length === 0) {
		return null
	}

	const next = Math.min(...jobs.map(({ runAt }) => Date.parse(runAt)))

	// A job that waits is looked at once when it comes due, never sooner than the waiting rhythm.
	return Math.min(Math.max(next - now, waitingPollMs), longestTimerMs)
}

/** Whether the card may still change by itself: worth a look when the page is shown again. */
export function isPending(view: CardView): boolean {
	const { status } = view.note

	return status === 'queued' || status === 'researching' || jobsOf(view).length > 0
}

type TimerHandle = ReturnType<typeof globalThis.setTimeout>

export interface PollTimers {
	readonly set: (run: () => void, ms: number) => TimerHandle
	readonly clear: (handle: TimerHandle) => void
}

/** Whether the page is hidden, and a way to hear when that changes; returns the unsubscribe. */
export interface PageVisibility {
	readonly hidden: () => boolean
	readonly watch: (listener: () => void) => () => void
}

export interface PollerOptions {
	/** The delay for the card on screen now: `pollDelay` of its view, or `null` with no card. */
	readonly delay: () => number | null
	/** Fetches the card; the poller waits for it before it plans the next look. */
	readonly refetch: () => Promise<void>
	/** Whether to look when the page is shown again; by default while a look is planned. */
	readonly pending?: () => boolean
	readonly timers?: PollTimers
	readonly visibility?: PageVisibility
}

const windowTimers: PollTimers = {
	set: (run, ms) => globalThis.setTimeout(run, ms),
	clear: (handle) => {
		globalThis.clearTimeout(handle)
	},
}

const documentVisibility: PageVisibility = {
	hidden: () => globalThis.document.visibilityState === 'hidden',
	watch: (listener) => {
		globalThis.document.addEventListener('visibilitychange', listener)

		return () => {
			globalThis.document.removeEventListener('visibilitychange', listener)
		}
	},
}

export class Poller {
	readonly #options: PollerOptions
	readonly #timers: PollTimers
	readonly #visibility: PageVisibility
	#unwatch: (() => void) | null = null

	#timer: TimerHandle | null = null
	#inFlight = false
	#stopped = false

	public constructor(options: PollerOptions) {
		this.#options = options
		this.#timers = options.timers ?? windowTimers
		this.#visibility = options.visibility ?? documentVisibility
	}

	/** Plans the next look from the card on screen; call it whenever the card changes. */
	public update(): void {
		this.#clear()

		// Watched from the first plan on, which only a browser makes: the server renders without a page.
		this.#unwatch ??= this.#visibility.watch(() => {
			this.#visibilityChanged()
		})

		const delay = this.#options.delay()

		if (this.#stopped || this.#inFlight || delay === null || this.#visibility.hidden()) {
			return
		}

		this.#timer = this.#timers.set(() => {
			this.#timer = null
			this.#look().catch(() => null)
		}, delay)
	}

	public stop(): void {
		this.#stopped = true
		this.#clear()
		this.#unwatch?.()
	}

	async #look() {
		if (this.#stopped || this.#inFlight) {
			return
		}

		this.#inFlight = true

		try {
			await this.#options.refetch()
		} finally {
			this.#inFlight = false
			this.update()
		}
	}

	#visibilityChanged() {
		if (this.#visibility.hidden()) {
			this.#clear()

			return
		}

		const pending = this.#options.pending?.() ?? this.#options.delay() !== null

		// Shown again: look at once, then follow the usual rhythm.
		if (pending && !this.#inFlight) {
			this.#clear()
			this.#look().catch(() => null)
		}
	}

	#clear() {
		if (this.#timer !== null) {
			this.#timers.clear(this.#timer)
			this.#timer = null
		}
	}
}

export interface CardPollerOptions {
	readonly timers?: PollTimers
	readonly visibility?: PageVisibility
	readonly now?: () => number
}

/** A poller for the card that `card` returns, or none while it returns `null`. */
export function cardPoller(
	card: () => CardView | null,
	refetch: () => Promise<void>,
	{ timers, visibility, now = Date.now }: CardPollerOptions,
): Poller {
	return new Poller({
		delay: () => {
			const view = card()

			return view === null ? null : pollDelay(view, now())
		},
		pending: () => {
			const view = card()

			return view !== null && isPending(view)
		},
		refetch,
		timers,
		visibility,
	})
}
