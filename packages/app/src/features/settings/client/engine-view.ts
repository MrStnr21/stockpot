// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { SettingsMessages } from '#/lib/i18n/settings-en'

import type { EngineId } from '../shared/engines'
import type { EngineOverview } from '../shared/types'

type EngineStrings = SettingsMessages['engines']

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
