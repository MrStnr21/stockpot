// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { SettingsMessages } from '#/lib/i18n/settings-en'

import type { EngineId } from '../shared/engines'
import type { EngineOverview, EngineTestResult, PublicSettings } from '../shared/types'
import { formatWhen } from './when'

type EngineStrings = SettingsMessages['engines']

type EngineState = EngineOverview['state']

type PublicEngines = PublicSettings['engines']

/** Where and how the page shows times: the digest time zone and the page's locale. */
export interface EngineViewContext {
	readonly now: Date
	readonly locale: string
	readonly timeZone: string
}

/** The order the settings pages show the engines in (DES-5): the main engine first. */
export const engineDisplayOrder = [
	'gemini',
	'openai-compatible',
	'agent-command',
] as const satisfies readonly EngineId[]

export function engineName(id: EngineId, strings: EngineStrings): string {
	const names = {
		gemini: strings.gemini,
		'openai-compatible': strings.openaiCompatible,
		'agent-command': strings.agentCommand,
	} satisfies Record<EngineId, string>

	return names[id]
}

function inDisplayOrder(overview: readonly EngineOverview[]) {
	return engineDisplayOrder.flatMap((id) => overview.filter((engine) => engine.id === id))
}

/**
 * The Engines row's subtitle: the first engine that needs attention, else the first one that works,
 * else whether any is set up at all.
 */
export function engineSummary(overview: readonly EngineOverview[], strings: EngineStrings): string {
	const engines = inDisplayOrder(overview)
	const failing = engines.find(({ state }) => state === 'key_rejected' || state === 'failing')

	if (failing !== undefined) {
		return strings.summaryAttention.replaceAll('{name}', engineName(failing.id, strings))
	}

	const working = engines.find(({ state }) => state === 'working')

	if (working !== undefined) {
		return strings.summaryWorks.replaceAll('{name}', engineName(working.id, strings))
	}

	return engines.some(({ configured }) => configured)
		? strings.summaryUntested
		: strings.summaryNotSetUp
}

const stateOfOutcome = {
	ok: 'working',
	auth: 'key_rejected',
	rate_limited: 'limited',
	timeout: 'failing',
	invalid: 'failing',
	error: 'failing',
} as const satisfies Record<EngineTestResult['outcome'], EngineState>

/** The state a test leaves the engine in. */
export function testState(result: EngineTestResult): EngineState {
	return stateOfOutcome[result.outcome]
}

/** The state a card shows: the latest test's on this page, else the server's. */
export function engineState(
	overview: EngineOverview,
	result: EngineTestResult | null,
): EngineState {
	return result === null ? overview.state : testState(result)
}

/** A card's badge: a kit status, or `null` for a plain badge (not tested, not set up). */
export interface EngineBadge {
	readonly status: 'ready' | 'queued' | 'failed' | null
	readonly label: string
}

/** HH:MM in the digest time zone, such as when a limit resets. */
export function clockTime(
	iso: string,
	{ locale, timeZone }: Omit<EngineViewContext, 'now'>,
): string {
	return new Intl.DateTimeFormat(locale, {
		timeZone,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).format(new Date(iso))
}

export function engineBadge(
	{ state, result }: { readonly state: EngineState; readonly result: EngineTestResult | null },
	context: Omit<EngineViewContext, 'now'>,
	strings: SettingsMessages['engineState'],
): EngineBadge {
	if (state === 'limited') {
		return {
			status: 'queued',
			label:
				result?.outcome === 'rate_limited'
					? strings.limitedUntil.replaceAll('{time}', clockTime(result.resetsAt, context))
					: strings.limited,
		}
	}

	const badges = {
		working: { status: 'ready', label: strings.working },
		key_rejected: { status: 'failed', label: strings.keyRejected },
		failing: { status: 'failed', label: strings.failing },
		untested: { status: null, label: strings.untested },
		not_set_up: { status: null, label: strings.notSetUp },
	} as const satisfies Record<Exclude<EngineState, 'limited'>, EngineBadge>

	return badges[state]
}

function hostOf(url: string): string | null {
	try {
		return new URL(url).host
	} catch {
		return null
	}
}

/** A card's description; the OpenAI-compatible one names its endpoint's host and standard model. */
export function engineDescription(
	id: EngineId,
	engines: PublicEngines,
	strings: EngineStrings,
): string {
	if (id === 'gemini') {
		return strings.geminiText
	}

	if (id === 'agent-command') {
		return strings.agentText
	}

	const { baseUrl, models } = engines['openai-compatible']
	const host = baseUrl === null ? null : hostOf(baseUrl)

	return host === null || models.standard === null
		? strings.openaiTextBare
		: strings.openaiText.replaceAll('{host}', host).replaceAll('{model}', models.standard)
}

/** What the latest test on this page ended with, as one line. */
export function testResultLine(
	result: EngineTestResult,
	context: Omit<EngineViewContext, 'now'>,
	strings: SettingsMessages['testOutcome'],
): string {
	if (result.outcome === 'ok') {
		const seconds = new Intl.NumberFormat(context.locale, {
			minimumFractionDigits: 1,
			maximumFractionDigits: 1,
		}).format(result.elapsedMs / 1000)

		return strings.ok.replaceAll('{seconds}', seconds)
	}

	if (result.outcome === 'rate_limited') {
		return strings.rateLimited.replaceAll('{time}', clockTime(result.resetsAt, context))
	}

	const lines = {
		auth: strings.auth,
		timeout: strings.timeout,
		invalid: strings.invalid,
		error: strings.error,
	} satisfies Record<typeof result.outcome, string>

	return lines[result.outcome]
}

/** Today's successful calls: "{n} suggestions and {m} cards today". */
export function todayLine(overview: EngineOverview, strings: EngineStrings): string {
	return strings.today
		.replaceAll('{suggestions}', String(overview.today.suggestions))
		.replaceAll('{cards}', String(overview.today.cards))
}

/**
 * A card's meta line: the test result after a test on this page, else the last call and today's
 * counts; `null` for an engine that was never called and is not set up.
 */
export function engineMeta(
	{
		overview,
		result,
	}: { readonly overview: EngineOverview; readonly result: EngineTestResult | null },
	context: EngineViewContext,
	strings: Pick<SettingsMessages, 'engines' | 'testOutcome' | 'when'>,
): string | null {
	if (result !== null) {
		return testResultLine(result, context, strings.testOutcome)
	}

	if (overview.lastCallAt === null) {
		return overview.configured ? strings.engines.never : null
	}

	const when = formatWhen(overview.lastCallAt, { ...context, strings: strings.when })

	return strings.engines.meta
		.replaceAll('{when}', when)
		.replaceAll('{suggestions}', String(overview.today.suggestions))
		.replaceAll('{cards}', String(overview.today.cards))
}

/** A fallback row's subtitle, as the router reads the order. */
export type FallbackRole =
	| { readonly role: 'main' }
	| { readonly role: 'backup'; readonly main: EngineId }
	| { readonly role: 'skipped' }
	| { readonly role: 'unlisted' }

export interface FallbackState {
	readonly configured: ReadonlySet<EngineId>
	/** The engines in the stored order; the router never falls back to one left out. */
	readonly listed: ReadonlySet<EngineId>
}

/**
 * Each engine's role in the order: the router always starts with Gemini (unless a category routes
 * elsewhere) and then follows the stored order, skipping engines that are not set up. So the main
 * engine is the first set-up one of Gemini and then the order, which is not always the first row.
 */
export function fallbackRoles(
	order: readonly EngineId[],
	{ configured, listed }: FallbackState,
): Map<EngineId, FallbackRole> {
	function used(id: EngineId) {
		return configured.has(id) && (id === 'gemini' || listed.has(id))
	}

	const main = ['gemini' as const, ...order].find((id) => used(id))

	return new Map(
		order.map((id): [EngineId, FallbackRole] => {
			if (!configured.has(id)) {
				return [id, { role: 'skipped' }]
			}

			if (!used(id) || main === undefined) {
				return [id, { role: 'unlisted' }]
			}

			return [id, id === main ? { role: 'main' } : { role: 'backup', main }]
		}),
	)
}

/** The order the fallback list shows: the stored one, then any engine it leaves out. */
export function fullFallbackOrder(stored: readonly EngineId[]): EngineId[] {
	return [...stored, ...engineDisplayOrder.filter((id) => !stored.includes(id))]
}
