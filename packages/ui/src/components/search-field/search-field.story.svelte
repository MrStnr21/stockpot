<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import SchemePanels from '../../book/scheme-panels.svelte'
	import SearchField from './search-field.svelte'

	interface Props {
		group: 'states'
	}

	const { group }: Props = $props()

	const label = 'Search notes and cards'

	const states = [
		{ title: 'Default' },
		{ title: 'Pressed · focused, typing', value: 'kafka', focused: true },
		{ title: 'Disabled · nothing to search yet', disabled: true },
		{ title: 'Loading · searching', value: 'kafka', loading: true, focused: true },
	]
</script>

<SchemePanels>
	{#if group === 'states'}
		<ul class="flex w-full max-w-90 flex-col gap-4">
			{#each states as { title, ...props } (title)}
				<li class="flex flex-col gap-2">
					<span class="text-caption text-ink-3">{title}</span>
					<SearchField {label} placeholder={label} {...props} />
				</li>
			{/each}
		</ul>
	{/if}
</SchemePanels>
