<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'

	import SchemePanels from '../../book/scheme-panels.svelte'
	import { CategoryTile } from '../category'
	import { StatusBadge } from '../status-badge'
	import ListRow from './list-row.svelte'
	import SwipeAction from './swipe-action.svelte'
	import SwipeActions from './swipe-actions.svelte'

	interface Props {
		group: 'closed' | 'end' | 'start' | 'pressed' | 'disabled' | 'loading'
	}

	const { group }: Props = $props()

	const labels = {
		closed: 'Default · closed',
		end: 'Swiped left · archive or delete',
		start: 'Swiped right · research now',
		pressed: 'Pressed · delete',
		disabled: 'Disabled · already researching',
		loading: 'Loading · archiving',
	}

	const positions = {
		closed: { open: null, offset: 0 },
		start: { open: 'start', offset: 104 },
		end: { open: 'end', offset: -160 },
		pressed: { open: 'end', offset: -160 },
		disabled: { open: 'start', offset: 104 },
		loading: { open: 'end', offset: -160 },
	} as const

	const researching = $derived(group === 'disabled')
</script>

{#snippet start()}
	<SwipeAction tone="accent" icon="bolt" disabled={researching}>Research now</SwipeAction>
{/snippet}

{#snippet end()}
	<SwipeAction tone="neutral" icon="archive" loading={group === 'loading'}>Archive</SwipeAction>
	<SwipeAction tone="danger" icon="trash" pressed={group === 'pressed'}>Delete</SwipeAction>
{/snippet}

{#snippet swipe(row: Snippet)}
	<SwipeActions {...positions[group]} {start} {end}>
		{@render row()}
	</SwipeActions>
{/snippet}

<SchemePanels>
	<div class="max-w-kit-example">
		<p class="mb-2 text-caption text-ink-3">{labels[group]}</p>
		<ul role="list">
			<ListRow
				title={researching ? 'RAG' : 'Offline-first sync'}
				subtitle={researching ? 'A design review for search' : 'For the capture sheet'}
				{swipe}
			>
				{#snippet lead()}
					{#if researching}
						<CategoryTile color="ai" icon="ai" />
					{:else}
						<CategoryTile color="idea" icon="idea" />
					{/if}
				{/snippet}
				{#snippet trail()}
					{#if researching}
						<StatusBadge status="researching">Researching</StatusBadge>
					{:else}
						<StatusBadge status="new">New</StatusBadge>
					{/if}
				{/snippet}
			</ListRow>
		</ul>
	</div>
</SchemePanels>
