<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button } from '@stockpot/ui/button'
	import { Badge, StatusBadge } from '@stockpot/ui/status-badge'
	import { TextField } from '@stockpot/ui/text-field'
	import { onDestroy } from 'svelte'

	import type { SettingsMessages } from '#/lib/i18n/settings-en'

	import { geminiKeyUrl } from '../shared/links'
	import type { EngineOverview, PublicSettings } from '../shared/types'
	import EngineKeyForm from './engine-key-form.svelte'
	import type { KeyEngine } from './engine-key.svelte'
	import { EngineModels, type ModelField } from './engine-models.svelte'
	import { EngineTester, testNoticeText } from './engine-tester.svelte'
	import { engineBadge, engineMeta, engineState, todayLine } from './engine-view'
	import SettingRow from './setting-row.svelte'
	import { createSettingsApi } from './settings-api'
	import SettingsGroup from './settings-group.svelte'
	import SettingsToast from './settings-toast.svelte'
	import { errorToast, SettingsToasts } from './settings-toasts.svelte'

	interface Props {
		engine: KeyEngine
		/** The settings without their keys (`toPublicSettings`). */
		engines: PublicSettings['engines']
		overview: EngineOverview
		/** The server's time of the render, ISO, so the first render matches it. */
		now: string
		locale: string
		timeZone: string
		strings: Pick<
			SettingsMessages,
			'engines' | 'engineState' | 'testOutcome' | 'when' | 'keys' | 'models' | 'errors'
		>
	}

	const { engine, engines, overview, now, locale, timeZone, strings }: Props = $props()

	const api = createSettingsApi()

	const tester = new EngineTester({ api })

	const toasts = new SettingsToasts()

	// The first props seed the page; saves keep it current after them.
	let current = $state.raw(engines)

	const models = new EngineModels({
		engine,
		initial: engines,
		api,
		toasts,
		strings: strings.errors,
		onsaved: (settings) => {
			current = settings.engines
		},
	})

	const configured = $derived(
		engine === 'gemini'
			? current.gemini.apiKey === 'set'
			: current['openai-compatible'].baseUrl !== null,
	)

	const slot = $derived(tester.slot(engine))

	const context = $derived({ now: new Date(now), locale, timeZone })

	const state = $derived(engineState({ ...overview, configured }, slot.result))

	const badge = $derived(engineBadge({ state, result: slot.result }, context, strings.engineState))

	const meta = $derived(
		engineMeta({ overview: { ...overview, configured }, result: slot.result }, context, strings),
	)

	const fields = $derived<{ field: ModelField; label: string }[]>([
		...(engine === 'openai-compatible'
			? [{ field: 'baseUrl' as const, label: strings.models.endpoint }]
			: []),
		{ field: 'fast', label: strings.models.fast },
		{ field: 'standard', label: strings.models.standard },
		{ field: 'deep', label: strings.models.deep },
	])

	async function test() {
		const notice = await tester.test(engine)

		if (notice !== null) {
			toasts.show(errorToast(testNoticeText(notice, strings)))
		}
	}

	onDestroy(() => {
		toasts.destroy()
	})
</script>

<!-- DES-5 390-07: the last call with Test again, the key, the models, today's calls. -->
<SettingsGroup head={strings.engines.lastCall}>
	<div
		class="flex min-h-13 flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2 font-ui"
		data-state={state}
	>
		{#if badge.status === null}
			<Badge>{badge.label}</Badge>
		{:else}
			<StatusBadge status={badge.status}>{badge.label}</StatusBadge>
		{/if}
		{#if meta !== null}
			<span class="min-w-0 flex-1 text-detail text-ink-2" aria-live="polite">{meta}</span>
		{/if}
	</div>
</SettingsGroup>
{#if configured}
	<Button
		variant="outline"
		size="sm"
		icon="retry"
		class="self-start"
		loading={slot.busy}
		disabled={slot.busy}
		onclick={test}
	>
		{strings.engines.testAgain}
	</Button>
{/if}

<SettingsGroup head={strings.keys.head} card={false}>
	<EngineKeyForm
		{engine}
		keyState={engines[engine].apiKey}
		hint={engine === 'gemini' ? strings.keys.geminiHint : null}
		showResult={false}
		{locale}
		{timeZone}
		{strings}
		{tester}
		{toasts}
		{api}
		onsaved={(settings) => {
			current = settings.engines
		}}
	/>
</SettingsGroup>

<SettingsGroup head={strings.models.head} foot={strings.models.foot} card={false}>
	<form
		class="flex flex-col gap-3"
		aria-label={strings.models.head}
		onsubmit={async (event) => {
			event.preventDefault()
			await models.save()
		}}
	>
		{#each fields as { field, label } (field)}
			<div class="flex flex-col gap-1">
				<TextField
					{label}
					bind:value={models.values[field]}
					required={engine === 'gemini' && field !== 'baseUrl'}
					autocomplete="off"
					autocapitalize="off"
					spellcheck={false}
					inputmode={field === 'baseUrl' ? 'url' : undefined}
				/>
				{#if models.errors[field]}
					<p role="alert" class="mx-0.5 font-ui text-detail font-medium text-danger-ink">
						{models.errors[field]}
					</p>
				{/if}
			</div>
		{/each}
		<Button
			type="submit"
			variant="tonal"
			class="self-start"
			loading={models.saving}
			disabled={!models.changed}
		>
			{strings.models.save}
		</Button>
	</form>
</SettingsGroup>

<SettingsGroup>
	<SettingRow label={todayLine(overview, strings.engines)} />
</SettingsGroup>

{#if engine === 'gemini'}
	<SettingsGroup>
		<SettingRow label={strings.keys.getKey} href={geminiKeyUrl} external />
	</SettingsGroup>
{/if}

<SettingsToast toast={toasts.current} />
