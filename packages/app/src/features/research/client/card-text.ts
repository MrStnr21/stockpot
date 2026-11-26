// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The words an opened card says about its state: level names, wait panels, banners and the meta line.
 * Times are shown in the instance's time zone. `{count}`, `{time}`, `{level}`, `{engine}` and
 * `{language}` are filled in.
 */
import type { CardView, LevelCard, LevelSet } from '../shared/card-view'
import type { BlocksPanel, Depth, ResearchStep, WaitPanel } from './card-panel'
import type { CardStrings } from './card-strings'

export type { CardStrings } from './card-strings'

export interface TextContext {
	readonly strings: CardStrings
	/** The interface locale: `en` or `ru`. */
	readonly locale: string
	/** The instance's time zone, for every time on the card. */
	readonly timeZone: string
	/** Tonight's run, as settings store it ("06:30"). */
	readonly batchTime: string
}

/** A counted text: the `…One` key for one, the `…Other` key otherwise. */
export function counted(one: string, other: string, count: number): string {
	return (count === 1 ? one : other).replaceAll('{count}', String(count))
}

function fill(text: string, values: Readonly<Record<string, string>>): string {
	return Object.entries(values).reduce(
		(filled, [key, value]) => filled.replaceAll(`{${key}}`, value),
		text,
	)
}

// English dates read "19 Nov, 06:31" on the boards, which is the British order.
function intlLocale(locale: string) {
	return locale === 'ru' ? 'ru' : 'en-GB'
}

export function clockTime(iso: string, { locale, timeZone }: TextContext): string {
	return new Intl.DateTimeFormat(intlLocale(locale), {
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
		timeZone,
	}).format(new Date(iso))
}

function dateTime(iso: string, context: TextContext): string {
	const day = new Intl.DateTimeFormat(intlLocale(context.locale), {
		day: 'numeric',
		month: 'short',
		timeZone: context.timeZone,
	}).format(new Date(iso))

	return `${day}, ${clockTime(iso, context)}`
}

const levelKeys = {
	standard: ['levelCard', 'levelHowItWorks', 'levelHandsOn'],
	word: ['levelCard', 'levelNuance', 'levelPractice'],
	report: ['levelReport', 'levelFeasibility', 'levelBuildPlan'],
} as const satisfies Record<
	LevelSet,
	readonly [keyof CardStrings, keyof CardStrings, keyof CardStrings]
>

export function levelName(strings: CardStrings, levelSet: LevelSet, depth: Depth): string {
	return strings[levelKeys[levelSet][depth - 1]]
}

/** An engine as the meta line names it; an id it does not know is shown as stored. */
export function engineName(strings: CardStrings, engine: string): string {
	const names = new Map([
		['gemini', strings.engineGemini],
		['agent-command', strings.engineAgentCommand],
		['openai-compatible', strings.engineOpenAiCompatible],
	])

	return names.get(engine) ?? engine
}

export interface WaitTexts {
	readonly title: string
	readonly text: string | null
	readonly meta: string | null
}

function queuedText(view: CardView, panel: WaitPanel, context: TextContext): string {
	const { strings } = context
	const { job } = panel

	if (job !== null && Date.parse(job.runAt) > Date.now()) {
		return fill(strings.waitsForReset, { time: clockTime(job.runAt, context) })
	}

	const ahead = job?.ahead ?? 0

	const line =
		ahead === 0 ? strings.aheadNone : counted(strings.aheadOne, strings.aheadOther, ahead)

	return `${line} ${view.levelSet === 'report' ? strings.reportDuration : strings.cardDuration}`
}

function askedMeta(panel: WaitPanel, context: TextContext): string | null {
	const { job } = panel

	return job?.priority === 'now'
		? fill(context.strings.askedNowMeta, { time: clockTime(job.queuedAt, context) })
		: null
}

const failureKindKeys = {
	timeout: 'kindTimeout',
	invalid: 'kindInvalid',
	auth: 'kindAuth',
	rate_limited: 'kindRateLimited',
	error: 'kindError',
} as const satisfies Record<string, keyof CardStrings>

function failedTexts(view: CardView, context: TextContext): WaitTexts {
	const { strings } = context
	const { failure } = view.research

	let reason = strings.failedOther

	if (failure?.kind === 'timeout') {
		reason = strings.failedTimeout
	} else if (failure?.kind === 'invalid') {
		reason = strings.failedInvalid
	}

	const meta =
		failure === null
			? null
			: [
					strings[failureKindKeys[failure.kind]],
					counted(strings.retriesOne, strings.retriesOther, Math.max(0, failure.attempts - 1)),
					clockTime(failure.at, context),
				].join(' · ')

	return { title: strings.failedTitle, text: `${reason} ${strings.failedAdvice}`, meta }
}

/** The title, text and meta of a wait panel. */
export function waitTexts(view: CardView, panel: WaitPanel, context: TextContext): WaitTexts {
	const { strings } = context
	const level = levelName(strings, view.levelSet, panel.depth)
	const isReport = view.levelSet === 'report'

	switch (panel.reason) {
		case 'new': {
			const text = fill(strings.newText, { time: context.batchTime })

			return { title: strings.newTitle, text, meta: null }
		}

		case 'queued':
		case 'levelQueued': {
			const text = queuedText(view, panel, context)

			return { title: strings.queuedTitle, text, meta: askedMeta(panel, context) }
		}

		case 'researching':
		case 'levelResearching': {
			const title = isReport ? strings.ideaTitle : strings.researchingTitle

			return { title, text: isReport ? strings.ideaText : strings.researchingText, meta: null }
		}

		case 'failed': {
			return failedTexts(view, context)
		}

		case 'levelTonight': {
			const title = fill(strings.levelTonightTitle, { level })

			return { title, text: strings.levelTonightText, meta: null }
		}

		case 'levelNotWritten': {
			const title = fill(strings.levelNotWrittenTitle, { level })

			return { title, text: strings.levelNotWrittenText, meta: null }
		}

		case 'levelAfter': {
			const previous = levelName(strings, view.levelSet, panel.depth === 3 ? 2 : 1)

			return { title: fill(strings.levelAfterTitle, { level: previous }), text: null, meta: null }
		}

		default: {
			return { title: level, text: null, meta: null }
		}
	}
}

/** The words of an idea's research step. */
export function stepText(strings: CardStrings, step: ResearchStep): string {
	const count = step.count ?? 0

	const texts: Record<ResearchStep['key'], string> = {
		planning: strings.stepPlanning,
		search: strings.stepSearch,
		write: strings.stepWrite,
		split: counted(strings.stepSplitOne, strings.stepSplitOther, count),
		searching: counted(strings.stepSearchingOne, strings.stepSearchingOther, count),
		searched: counted(strings.stepSearchedOne, strings.stepSearchedOther, count),
		writing: strings.stepWriting,
	}

	return texts[step.key]
}

export interface BannerTexts {
	readonly title: string
	readonly text: string
}

/** The banner over a draft or an unsure card. */
export function bannerTexts(panel: BlocksPanel, context: TextContext): BannerTexts | null {
	const { strings } = context
	const { card, banner } = panel

	if (banner === 'draft') {
		const text =
			card.redoAt === null
				? strings.draftText
				: fill(strings.draftRedoText, { time: clockTime(card.redoAt, context) })

		return { title: strings.draftTitle, text }
	}

	if (banner === 'unsure') {
		const text = card.sources.length === 0 ? strings.unsureNoSourcesText : strings.unsureText

		return { title: strings.unsureTitle, text }
	}

	return null
}

function bylineKey(view: CardView, card: LevelCard, depth: Depth): keyof CardStrings {
	if (card.isDraft) {
		return depth === 1 ? 'draftBy' : 'levelDraftBy'
	}

	if (view.levelSet === 'report') {
		return depth === 1 ? 'researchedBy' : 'levelResearchedBy'
	}

	return depth === 1 ? 'writtenBy' : 'levelWrittenBy'
}

/** "Written by Gemini · 19 Nov, 06:31", with the level and, for words, the card language. */
export function metaLine(view: CardView, panel: BlocksPanel, context: TextContext): string {
	const { strings } = context
	const { card, depth } = panel

	const byline = fill(strings[bylineKey(view, card, depth)], {
		level: String(depth),
		engine: engineName(strings, card.engine),
		time: dateTime(card.createdAt, context),
	})

	if (view.levelSet !== 'word') {
		return byline
	}

	const language =
		new Intl.DisplayNames([intlLocale(context.locale)], { type: 'language' }).of(card.language) ??
		card.language

	return `${byline} · ${fill(strings.cardLanguage, { language })}`
}
