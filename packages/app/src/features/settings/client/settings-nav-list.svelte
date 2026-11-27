<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Icon } from '@stockpot/ui/icon'
	import { List, ListRow } from '@stockpot/ui/list'

	import type { SettingsMessages } from '#/lib/i18n/settings-en'

	import { settingsSections, type SettingsSection } from './settings-sections'

	interface Props {
		section: SettingsSection
		/** Draws the dot on Engines. */
		attention: boolean
		names: SettingsMessages['sections']
	}

	const { section, attention, names }: Props = $props()
</script>

<!-- DES-5 nav rows are 52 px with a regular-weight title, against the list's 68 px. -->
<List class="[&_.text-list-title]:font-normal [&_a]:min-h-13 [&_a]:py-2 [&_li]:before:inset-s-14">
	{#each settingsSections as item (item.key)}
		<ListRow title={names[item.key]} href={item.href} current={item.key === section}>
			{#snippet lead()}
				<span class="grid size-8 shrink-0 place-items-center rounded-xs bg-fill text-ink-2">
					<Icon name={item.icon} class="size-4.5" />
				</span>
			{/snippet}
			{#snippet trail()}
				{#if item.key === 'engines' && attention}
					<span class="size-2 rounded-full bg-danger"></span>
					<span class="sr-only">{names.attention}</span>
				{/if}
				<Icon name="chevron" class="size-4" />
			{/snippet}
		</ListRow>
	{/each}
</List>
