<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import SchemePanels from '../../book/scheme-panels.svelte'
	import Chip from './chip.svelte'

	interface Props {
		group: 'off' | 'selected'
	}

	const { group }: Props = $props()

	const states = ['Default', 'Pressed', 'Disabled', 'Loading'] as const

	let selections = $state<Partial<Record<(typeof states)[number], boolean>>>({})
</script>

<SchemePanels>
	<ul class="flex flex-wrap items-start gap-x-6 gap-y-3">
		{#each states as label (label)}
			{@const selected = selections[label] ?? group === 'selected'}
			<li class="flex flex-col items-start gap-1">
				<span class="text-caption text-ink-3">{label}</span>
				<Chip
					{selected}
					count={4}
					pressed={label === 'Pressed'}
					disabled={label === 'Disabled'}
					loading={label === 'Loading'}
					onclick={() => {
						selections[label] = !selected
					}}
				>
					Ready
				</Chip>
			</li>
		{/each}
	</ul>
</SchemePanels>
