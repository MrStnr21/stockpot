// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The engine router (docs/engines.md, "Routing"): the one entry point from the product to the
 * language models. It picks the engine and tier for a task and category, from the routing table's
 * defaults and the owner's per-category overrides, and the configured engines to fall back to.
 */
import type { FormatId } from '#/lib/format-ids'

import type { Task, Tier } from './contract'
import { configuredEngines, type EngineId, type EngineSettings, type Routing } from './settings'

/** Every row of the routing table starts on Gemini; an owner routes a category elsewhere in settings. */
const defaultEngine = 'gemini' satisfies EngineId

/** What settings say about the engines and routing at the time of a call. */
export interface RouterSettings {
	readonly engines: EngineSettings
	readonly routing: Routing
}

export interface RouteRequest {
	readonly task: Task
	/** The id of the call's output format: a card format, or `suggestion`. */
	readonly format: string
	/** The category a card is for, which settings may route away from its format's row. */
	readonly categoryId: number | null
}

export interface Route {
	readonly tier: Tier
	/** The engines to try in turn, configured ones only: the first is the primary engine. */
	readonly path: readonly EngineId[]
}

/** The tier column of the routing table, keyed by task and format. */
function defaultTier(task: Task, format: string): Tier {
	if (task === 'suggest') {
		return 'fast'
	}

	if (task === 'research') {
		return 'deep'
	}

	return format === ('vocabulary' satisfies FormatId) ? 'fast' : 'standard'
}

/**
 * The engine and tier for a call, then the engines to fall back to in the configured order. An
 * engine that is not configured is skipped, the routed one included: the first configured engine is
 * then the primary. A suggestion has no category, so it always takes its row. `research` never falls
 * back, because the OpenAI-compatible engine writes from text only and cannot search: the job waits
 * for the primary engine's reset instead.
 */
export function resolveRoute(
	{ task, format, categoryId }: RouteRequest,
	{ engines, routing }: RouterSettings,
	agentCommand: string | null,
): Route {
	const override =
		task === 'suggest' || categoryId === null ? undefined : routing.categories[String(categoryId)]

	const primary = override?.engine ?? defaultEngine
	const configured = new Set(configuredEngines(engines, agentCommand))

	const candidates = [primary, ...routing.fallbackOrder.filter((id) => id !== primary)].filter(
		(id) => configured.has(id),
	)

	return {
		tier: override?.tier ?? defaultTier(task, format),
		path: task === 'research' ? candidates.slice(0, 1) : candidates,
	}
}
