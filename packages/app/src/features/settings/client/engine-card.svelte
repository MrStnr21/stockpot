<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button } from '@stockpot/ui/button'
	import { Icon } from '@stockpot/ui/icon'
	import { Badge, StatusBadge } from '@stockpot/ui/status-badge'

	import type { SettingsMessages } from '#/lib/i18n/settings-en'

	import { agentCommandGuideUrl } from '../shared/links'
	import type { EngineOverview, PublicSettings } from '../shared/types'
	import type { EngineTestSlot } from './engine-tester.svelte'
	import {
		engineBadge,
		engineDescription,
		engineMeta,
		engineName,
		engineState,
		type EngineViewContext,
	} from './engine-view'

	interface Props {
		overview: EngineOverview
		engines: PublicSettings['engines']
		slot: EngineTestSlot
		context: EngineViewContext
		strings: Pick<SettingsMessages, 'engines' | 'engineState' | 'testOutcome' | 'when'>
		ontest: () => void
	}

	const { overview, engines, slot, context, strings, ontest }: Props = $props()

	const id = $props.id()

	const icons = { gemini: 'ai', 'openai-compatible': 'link', 'agent-command': 'terminal' } as const

	const state = $derived(engineState(overview, slot.result))

	const badge = $derived(engineBadge({ state, result: slot.result }, context, strings.engineState))

	const meta = $derived(engineMeta({ overview, result: slot.result }, context, strings))

	const hasDetails = $derived(overview.id !== 'agent-command')
</script>

<!-- DES-5 `.ecard`: the engine, its state, what it does, its last call, and its buttons. -->
<article
	aria-labelledby={`${id}-name`}
	data-engine={overview.id}
	data-state={state}
	class="flex flex-col gap-2.5 rounded-lg border border-line bg-surface px-4 py-3.5 font-ui"
>
	<div class="flex items-center gap-2.5">
		<span class="grid size-9 shrink-0 place-items-center rounded-xs bg-fill text-ink-2">
			<Icon name={icons[overview.id]} class="size-5" />
		</span>
		<h2 id={`${id}-name`} class="min-w-0 flex-1 text-title-s">
			{engineName(overview.id, strings.engines)}
		</h2>
		{#if badge.status === null}
			<Badge>{badge.label}</Badge>
		{:else}
			<StatusBadge status={badge.status}>{badge.label}</StatusBadge>
		{/if}
	</div>
	<p class="text-body-compact text-ink-2">
		{engineDescription(overview.id, engines, strings.engines)}
	</p>
	{#if meta !== null}
		<p class="text-caption text-ink-3" aria-live="polite">{meta}</p>
	{/if}
	<div class="flex flex-wrap gap-2">
		{#if state === 'key_rejected' && hasDetails}
			<Button variant="tonal" size="sm" href={`/settings/engines/${overview.id}`}>
				{strings.engines.replaceKey}
			</Button>
		{/if}
		{#if overview.configured}
			<Button variant="outline" size="sm" loading={slot.busy} disabled={slot.busy} onclick={ontest}>
				{strings.engines.test}
			</Button>
		{/if}
		{#if hasDetails && state !== 'key_rejected'}
			<Button variant="ghost" size="sm" href={`/settings/engines/${overview.id}`}>
				{strings.engines.details}
			</Button>
		{/if}
		{#if !hasDetails && !overview.configured}
			<Button
				variant="ghost"
				size="sm"
				icon="external"
				href={agentCommandGuideUrl}
				target="_blank"
				rel="noopener noreferrer"
			>
				{strings.engines.howToSetUp}
			</Button>
		{/if}
	</div>
</article>
