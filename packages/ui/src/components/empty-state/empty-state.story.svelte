<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import SchemePanels from '../../book/scheme-panels.svelte'
	import { Button } from '../button'
	import type { IconName } from '../icon'
	import EmptyState from './empty-state.svelte'

	interface Props {
		group: 'default' | 'action-states' | 'search' | 'base'
	}

	const { group }: Props = $props()

	const states: Record<
		Exclude<Props['group'], 'action-states'>,
		{ label: string; icon: IconName; title: string; description: string }
	> = {
		default: {
			label: 'Default · Today before the first digest',
			icon: 'pot',
			title: 'Nothing to read yet',
			description: 'Notes you save today are explained overnight and arrive here in the morning.',
		},
		search: {
			label: 'Search with no results',
			icon: 'search',
			title: 'Nothing matches “kafka”',
			description: 'Search looks through your notes and their cards.',
		},
		base: {
			label: 'Base before the first Keep',
			icon: 'bookmark',
			title: 'Nothing kept yet',
			description: 'Tap Keep on a card and it stays here, sorted by category.',
		},
	}
</script>

{#snippet action()}
	{#if group === 'default'}
		<Button icon="plus">Add a note</Button>
	{:else}
		<Button variant="ghost">Clear search</Button>
	{/if}
{/snippet}

<SchemePanels>
	<div class="flex w-full max-w-90 flex-col gap-2">
		{#if group === 'action-states'}
			<span class="text-caption text-ink-3">Pressed · disabled · loading</span>
			<div class="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
				<div class="flex flex-wrap gap-3">
					<Button icon="plus" pressed>Add a note</Button>
					<Button icon="plus" disabled>Add a note</Button>
				</div>
				<p class="text-detail text-ink-2">A loading tab shows a skeleton until it has content.</p>
			</div>
		{:else}
			{@const state = states[group]}
			<span class="text-caption text-ink-3">{state.label}</span>
			<div class="rounded-lg border border-line bg-surface">
				<EmptyState
					icon={state.icon}
					title={state.title}
					action={group === 'base' ? undefined : action}
				>
					{state.description}
				</EmptyState>
			</div>
		{/if}
	</div>
</SchemePanels>
