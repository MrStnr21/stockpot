<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { IconButton } from '@stockpot/ui/button'
	import { Icon } from '@stockpot/ui/icon'
	import { onDestroy, onMount } from 'svelte'

	import type { SettingsMessages } from '#/lib/i18n/settings-en'

	import type { PublicDigest } from '../shared/types'
	import { DigestController } from './digest-controller.svelte'
	import { languageOptions, timeZoneOptions } from './digest-view'
	import SettingRow from './setting-row.svelte'
	import { createSettingsApi } from './settings-api'
	import SettingsGroup from './settings-group.svelte'
	import SettingsToast from './settings-toast.svelte'
	import { SettingsToasts } from './settings-toasts.svelte'

	interface Props {
		digest: PublicDigest
		cardLanguage: string
		locale: string
		/** The Categories row of the phone list; the pane beside the nav leaves it out. */
		categoryCount: number
		strings: Pick<SettingsMessages, 'sections' | 'digest' | 'cards' | 'errors'>
	}

	const { digest, cardLanguage, locale, categoryCount, strings }: Props = $props()

	const toasts = new SettingsToasts()

	// The first props seed the controller; it owns every change after them.
	const controller = new DigestController({
		initial: { ...digest, cardLanguage },
		api: createSettingsApi(),
		toasts,
		strings: strings.errors,
	})

	const id = $props.id()

	// The server renders the stored zone alone; the browser's list arrives once it runs.
	let supportedZones = $state.raw<readonly string[]>([])

	const zones = $derived(timeZoneOptions(supportedZones, controller.values.timeZone))

	const languages = $derived(languageOptions(controller.values.cardLanguage, locale))

	const valueClasses =
		'min-h-11 min-w-0 cursor-pointer appearance-none rounded-sm bg-transparent text-end font-ui text-body/5.5 text-ink-2 outline-focus focus-visible:outline-2 focus-visible:outline-offset-2'

	onMount(() => {
		supportedZones = Intl.supportedValuesOf('timeZone')
	})

	onDestroy(() => {
		controller.destroy()
		toasts.destroy()
	})
</script>

{#snippet chevron()}
	<Icon name="chevron" class="pointer-events-none size-4 text-ink-3" />
{/snippet}

{#snippet timeRow(field: 'time' | 'batchTime', label: string, hint: string | null)}
	<SettingRow {label} {hint} for={`${id}-${field}`} error={controller.errors[field]}>
		<input
			id={`${id}-${field}`}
			type="time"
			step="60"
			required
			value={controller.values[field]}
			aria-describedby={hint ? `${id}-${field}-hint` : undefined}
			onchange={async (event) => controller.setTime(field, event.currentTarget.value)}
			class={[valueClasses, 'w-24 [&::-webkit-calendar-picker-indicator]:hidden']}
		/>
		{@render chevron()}
	</SettingRow>
{/snippet}

<SettingsGroup head={strings.sections.digest} class="md:[&>h2]:hidden">
	{@render timeRow('time', strings.digest.time, null)}
	<SettingRow label={strings.digest.limit} hint={strings.digest.limitHint} for={`${id}-limit`}>
		<span class="flex shrink-0 items-center gap-1">
			<IconButton
				icon="minus"
				label={strings.digest.fewer}
				disabled={!controller.canFewer}
				onclick={() => controller.step(-1)}
			/>
			<output
				id={`${id}-limit`}
				aria-live="polite"
				aria-describedby={`${id}-limit-hint`}
				class="min-w-7 text-center font-ui text-title-s"
			>
				{controller.values.limit}
			</output>
			<IconButton
				icon="plus"
				label={strings.digest.more}
				disabled={!controller.canMore}
				onclick={() => controller.step(1)}
			/>
		</span>
	</SettingRow>
	{@render timeRow('batchTime', strings.digest.batchTime, strings.digest.batchTimeHint)}
	<SettingRow label={strings.digest.timeZone} for={`${id}-zone`} error={controller.errors.timeZone}>
		<select
			id={`${id}-zone`}
			value={controller.values.timeZone}
			onchange={async (event) => controller.setTimeZone(event.currentTarget.value)}
			class={[valueClasses, 'max-w-1/2 truncate']}
		>
			{#each zones as zone (zone)}
				<option value={zone}>{zone}</option>
			{/each}
		</select>
		{@render chevron()}
	</SettingRow>
</SettingsGroup>

<SettingsGroup head={strings.cards.head}>
	<SettingRow
		label={strings.cards.language}
		for={`${id}-language`}
		error={controller.errors.cardLanguage}
	>
		<select
			id={`${id}-language`}
			value={controller.values.cardLanguage}
			onchange={async (event) => controller.setCardLanguage(event.currentTarget.value)}
			class={[valueClasses, 'max-w-1/2 truncate']}
		>
			{#each languages as language (language.value)}
				<option value={language.value}>{language.label}</option>
			{/each}
		</select>
		{@render chevron()}
	</SettingRow>
	<SettingRow
		label={strings.cards.categories}
		href="/settings/categories"
		value={String(categoryCount)}
		class="md:hidden"
	/>
</SettingsGroup>

<SettingsToast toast={toasts.current} />
