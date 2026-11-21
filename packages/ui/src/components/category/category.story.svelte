<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import SchemePanels from '../../book/scheme-panels.svelte'
	import { categoryColors, type CategoryColor } from '../icon'
	import CategoryChip from './category-chip.svelte'
	import CategoryTile from './category-tile.svelte'

	interface Props {
		group: 'on-card' | 'suggested' | 'picked' | 'labels' | 'tiles'
	}

	const { group }: Props = $props()

	const names = {
		english: 'English',
		ai: 'AI',
		tech: 'Technology',
		concept: 'Concept',
		idea: 'Idea',
		other: 'Other',
	} satisfies Record<CategoryColor, string>

	const suggestionStates = [
		{ label: 'Default' },
		{ label: 'Pressed', pressed: true },
		{ label: 'Disabled', disabled: true },
		{ label: 'Loading', loading: true },
	] as const

	let picks = $state<Partial<Record<(typeof suggestionStates)[number]['label'], boolean>>>({})
</script>

<SchemePanels>
	{#if group === 'on-card'}
		<p class="text-caption text-ink-3">On a card</p>
		<ul class="flex flex-wrap gap-2">
			{#each categoryColors as color (color)}
				<li>
					<CategoryChip {color} icon={color} variant="label" size="sm">{names[color]}</CategoryChip>
				</li>
			{/each}
		</ul>
	{:else if group === 'labels' || group === 'tiles'}
		<ul class="grid gap-3">
			{#each categoryColors as color (color)}
				<li class="flex min-w-0 flex-wrap items-center gap-2">
					<span class="w-24 text-caption text-ink-3">{names[color]}</span>
					{#if group === 'labels'}
						<CategoryChip {color} icon={color} variant="label">{names[color]}</CategoryChip>
						<CategoryChip {color} icon={color} variant="label" size="sm">
							{names[color]}
						</CategoryChip>
					{:else}
						<CategoryTile {color} icon={color} />
						<CategoryTile {color} icon={color} size="lg" />
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<ul class="flex flex-wrap items-start gap-4">
			{#each suggestionStates as { label, ...props } (label)}
				{@const picked = picks[label] ?? group === 'picked'}
				<li class="flex flex-col gap-2">
					<span class="text-caption text-ink-3">{label}</span>
					{#if 'loading' in props}
						<div class="flex h-11 items-center" role="status">
							<span class="sr-only">Suggesting a category</span>
							<span class="h-10 w-31 rounded-full bg-skeleton" aria-hidden="true"></span>
						</div>
					{:else}
						<CategoryChip
							color="tech"
							icon="tech"
							variant="suggestion"
							{picked}
							{...props}
							onclick={() => {
								picks[label] = !picked
							}}
						>
							Technology
						</CategoryChip>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</SchemePanels>
