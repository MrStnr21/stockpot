// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * What an opened card shows for the level the owner picked (the Cards boards and DES-3's decisions):
 * the blocks of a written level, or a wait panel that says why there are none yet, the depth switch,
 * the flag and the actions. Pure, so every format in every state is checked by a spec; card-text.ts
 * turns the result into words.
 */
import type { CardView, JobView, LevelCard } from '../shared/card-view'

export type Depth = 1 | 2 | 3

export const depths = [1, 2, 3] as const satisfies readonly Depth[]

/** Why a level shows no blocks, as the wait panel says it. */
export type WaitReason =
	/** Level 1 waits for tonight's run (board 07). */
	| 'new'
	/** Level 1 waits in the queue (board 08). */
	| 'queued'
	/** Level 1 is being written (boards 09, 10). */
	| 'researching'
	/** Level 1 could not be written (board 11). */
	| 'failed'
	/** Deeper asked for this level in tonight's run (board 15). */
	| 'levelTonight'
	/** Research now asked for this level and it waits in the queue. */
	| 'levelQueued'
	| 'levelResearching'
	/** The next level, which nobody asked for yet. */
	| 'levelNotWritten'
	/** A level after one that is not written: it can only come after it. */
	| 'levelAfter'

export type WaitButton = 'researchNow' | 'researchLevel' | 'tryAgain' | 'changeCategory'

/** A step of an idea's research while it runs: done, in progress, or still to come. */
export interface ResearchStep {
	readonly key: 'planning' | 'search' | 'write' | 'split' | 'searching' | 'searched' | 'writing'
	readonly state: 'done' | 'active' | 'todo'
	/** The questions or pages the step names, if any. */
	readonly count: number | null
}

export interface WaitPanel {
	readonly kind: 'wait'
	readonly reason: WaitReason
	readonly depth: Depth
	readonly tone: 'default' | 'danger'
	readonly icon: 'clock' | 'spinner' | 'alert'
	readonly buttons: readonly WaitButton[]
	/** An idea's research steps while they are known. */
	readonly steps: readonly ResearchStep[] | null
	/** A skeleton holds the card's place while an engine writes it. */
	readonly skeleton: boolean
	readonly job: JobView | null
}

export interface BlocksPanel {
	readonly kind: 'blocks'
	readonly depth: Depth
	readonly card: LevelCard
	/** A draft wins over an unsure answer. */
	readonly banner: CardFlag | null
}

export type CardPanel = WaitPanel | BlocksPanel

export type CardFlag = 'draft' | 'unsure'

export type LevelState = 'ready' | 'queued' | 'researching' | 'none'

export interface LevelTab {
	readonly depth: Depth
	readonly state: LevelState
}

export type ActionKey = 'got' | 'deeper' | 'keep' | 'notion' | 'delete'

export interface ActionView {
	readonly key: ActionKey
	readonly disabled: boolean
	/** Kept, or already in Notion. */
	readonly pressed: boolean
}

/** Whether the card offers ➕ Notion: off until the integration exists (INT-3). */
export type NotionState = 'off' | 'add' | 'in'

export interface CardLayout {
	readonly panel: CardPanel
	/** The flag badge next to the status. */
	readonly flag: CardFlag | null
	/** The depth switch; `null` while level 1 is neither written nor being written. */
	readonly levels: readonly LevelTab[] | null
	/** The action bar; only a written level has one. */
	readonly actions: readonly ActionView[] | null
}

function flagOf(card: LevelCard): CardFlag | null {
	if (card.isDraft) {
		return 'draft'
	}

	return card.isUncertain ? 'unsure' : null
}

function levelOf(view: CardView, depth: Depth) {
	return view.levels[depth - 1]
}

/** Level 1 is being written: its note says so, or its job runs. */
function firstResearching(view: CardView): boolean {
	return view.note.status === 'researching' || view.levels[0].job?.state === 'researching'
}

export function levelState(view: CardView, depth: Depth): LevelState {
	const { card, job } = levelOf(view, depth)

	if (card !== null) {
		return 'ready'
	}

	if (job?.state === 'researching' || (depth === 1 && firstResearching(view))) {
		return 'researching'
	}

	return job === null ? 'none' : 'queued'
}

/** The deepest level written, 0 for none. */
export function deepestWritten(view: CardView): 0 | Depth {
	return depths.findLast((depth) => levelOf(view, depth).card !== null) ?? 0
}

/** An idea's research steps from its progress (board 10); none without progress. */
export function researchSteps(view: CardView): ResearchStep[] | null {
	const { progress } = view.research

	if (view.levelSet !== 'report' || progress === null) {
		return null
	}

	const { step, questions, pages } = progress

	if (step === 'planning') {
		return [
			{ key: 'planning', state: 'active', count: null },
			{ key: 'search', state: 'todo', count: null },
			{ key: 'write', state: 'todo', count: null },
		]
	}

	const split = { key: 'split', state: 'done', count: questions } as const

	if (step === 'searching') {
		return [
			split,
			{ key: 'searching', state: 'active', count: pages },
			{ key: 'write', state: 'todo', count: null },
		]
	}

	return [
		split,
		{ key: 'searched', state: 'done', count: pages },
		{ key: 'writing', state: 'active', count: null },
	]
}

interface WaitParts {
	readonly reason: WaitReason
	readonly tone?: 'default' | 'danger'
	readonly icon: WaitPanel['icon']
	readonly buttons?: readonly WaitButton[]
	readonly steps?: readonly ResearchStep[] | null
	readonly skeleton?: boolean
}

function wait(depth: Depth, job: JobView | null, parts: WaitParts): WaitPanel {
	return {
		kind: 'wait',
		depth,
		job,
		tone: parts.tone ?? 'default',
		buttons: parts.buttons ?? [],
		steps: parts.steps ?? null,
		skeleton: parts.skeleton ?? false,
		reason: parts.reason,
		icon: parts.icon,
	}
}

function firstLevelWait(view: CardView): WaitPanel {
	const [{ job }] = view.levels

	if (view.note.status === 'failed') {
		return wait(1, job, {
			reason: 'failed',
			tone: 'danger',
			icon: 'alert',
			buttons: ['tryAgain', 'changeCategory'],
		})
	}

	if (firstResearching(view)) {
		return wait(1, job, {
			reason: 'researching',
			icon: 'spinner',
			steps: researchSteps(view),
			skeleton: true,
		})
	}

	if (view.note.status === 'queued' || job !== null) {
		return wait(1, job, { reason: 'queued', icon: 'clock' })
	}

	return wait(1, job, { reason: 'new', icon: 'clock', buttons: ['researchNow'] })
}

function deeperLevelWait(view: CardView, depth: 2 | 3): WaitPanel {
	const { job } = levelOf(view, depth)

	if (job?.state === 'researching') {
		return wait(depth, job, { reason: 'levelResearching', icon: 'spinner', skeleton: true })
	}

	if (job?.priority === 'now') {
		return wait(depth, job, { reason: 'levelQueued', icon: 'clock' })
	}

	if (job !== null) {
		return wait(depth, job, { reason: 'levelTonight', icon: 'clock', buttons: ['researchLevel'] })
	}

	if (depth === deepestWritten(view) + 1) {
		return wait(depth, job, {
			reason: 'levelNotWritten',
			icon: 'clock',
			buttons: ['researchLevel'],
		})
	}

	return wait(depth, job, { reason: 'levelAfter', icon: 'clock' })
}

/** The panel of the picked level: its blocks once written, else why it waits. */
export function cardPanel(view: CardView, depth: Depth): CardPanel {
	const { card } = levelOf(view, depth)

	if (card !== null) {
		return { kind: 'blocks', depth, card, banner: flagOf(card) }
	}

	return depth === 1 ? firstLevelWait(view) : deeperLevelWait(view, depth)
}

/** The level to show: the one picked while level 1 has a card or is being written, else level 1. */
export function shownDepth(view: CardView, picked: Depth): Depth {
	return levelState(view, 1) === 'ready' || levelState(view, 1) === 'researching' ? picked : 1
}

function cardActions(view: CardView, notion: NotionState): ActionView[] {
	const actions: ActionView[] = [
		{ key: 'got', disabled: view.note.status !== 'ready', pressed: false },
		{ key: 'deeper', disabled: view.levels[2].card !== null, pressed: false },
		{ key: 'keep', disabled: false, pressed: view.note.isKept },
	]

	if (notion !== 'off') {
		actions.push({ key: 'notion', disabled: false, pressed: notion === 'in' })
	}

	actions.push({ key: 'delete', disabled: false, pressed: false })

	return actions
}

/** Everything the opened card draws for the picked level, apart from its texts. */
export function cardLayout(view: CardView, picked: Depth, notion: NotionState = 'off'): CardLayout {
	const depth = shownDepth(view, picked)
	const panel = cardPanel(view, depth)
	const first = levelState(view, 1)
	const hasSwitch = first === 'ready' || first === 'researching'

	return {
		panel,
		flag: panel.kind === 'blocks' ? panel.banner : null,
		levels: hasSwitch
			? depths.map((level) => ({ depth: level, state: levelState(view, level) }))
			: null,
		actions: panel.kind === 'blocks' ? cardActions(view, notion) : null,
	}
}
