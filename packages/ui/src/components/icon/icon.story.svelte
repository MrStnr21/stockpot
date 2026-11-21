<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import SchemePanels from '../../book/scheme-panels.svelte'
	import Icon from './icon.svelte'
	import { iconNames, type IconName } from './icons'

	interface Props {
		group: 'set' | 'full' | 'sizes'
	}

	const { group }: Props = $props()

	const sizes = [16, 24, 32] as const

	const boardIcons = [
		['sun', 'Today'],
		['list', 'Notes'],
		['plus', 'add a note'],
		['bookmark', 'Base, keep'],
		['sliders', 'Settings'],
		['search', 'search'],
		['check', 'got it'],
		['deeper', 'go deeper'],
		['trash', 'delete'],
		['archive', 'archive'],
		['bolt', 'research now'],
		['x', 'close, clear'],
		['chevron', 'open'],
		['clipboard', 'paste'],
		['link', 'source, link'],
		['lock', 'private'],
		['quote', 'where you saw it'],
		['undo', 'undo'],
		['retry', 'retry'],
		['bell', 'notifications'],
		['pot', 'stockpot'],
		['english', 'English'],
		['ai', 'AI'],
		['tech', 'Technology'],
		['concept', 'Concept'],
		['idea', 'Idea'],
		['other', 'Other'],
	] as const satisfies readonly (readonly [IconName, string])[]
</script>

{#snippet iconTile(name: IconName, description?: string)}
	<li class="flex flex-col items-center gap-1.5 text-center">
		<span class="grid size-13 place-items-center rounded-md border border-line bg-surface">
			<Icon {name} />
		</span>
		<span class="text-caption font-semibold">{name}</span>
		{#if description}
			<span class="text-micro font-normal text-ink-3">{description}</span>
		{/if}
	</li>
{/snippet}

<SchemePanels>
	{#if group === 'sizes'}
		<ul class="flex flex-wrap items-start gap-6">
			{#each sizes as size (size)}
				<li class="flex flex-col items-center gap-1.5">
					<span class="text-caption text-ink-3">{size} px</span>
					<span class="grid size-13 place-items-center rounded-md border border-line bg-surface">
						<Icon name="pot" {size} />
					</span>
				</li>
			{/each}
		</ul>
	{:else}
		<ul class="grid grid-cols-3 gap-x-3 gap-y-4.5 sm:grid-cols-6 md:grid-cols-3 xl:grid-cols-6">
			{#if group === 'set'}
				{#each boardIcons as [name, description] (name)}
					{@render iconTile(name, description)}
				{/each}
			{:else}
				{#each iconNames as name (name)}
					{@render iconTile(name)}
				{/each}
			{/if}
		</ul>
	{/if}
</SchemePanels>
