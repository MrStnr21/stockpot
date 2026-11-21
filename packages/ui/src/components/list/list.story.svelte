<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import SchemePanels from '../../book/scheme-panels.svelte'
	import { CategoryTile } from '../category'
	import { Icon } from '../icon'
	import { StatusBadge } from '../status-badge'
	import ListRow from './list-row.svelte'
	import List from './list.svelte'

	interface Props {
		group: 'in-list' | 'pressed' | 'selected' | 'disabled' | 'loading'
	}

	const { group }: Props = $props()

	let selected = $state(true)

	const labels = {
		'in-list': 'In a list',
		pressed: 'Pressed',
		selected: 'Selected · multi-select',
		disabled: 'Disabled · archived',
		loading: 'Loading',
	}
</script>

{#snippet ragTile()}
	<CategoryTile color="ai" icon="ai" />
{/snippet}

{#snippet englishRow(pressed = false)}
	<ListRow title="serendipity" subtitle="A podcast about city planning" {pressed}>
		{#snippet lead()}
			<CategoryTile color="english" icon="english" />
		{/snippet}
		{#snippet trail()}
			<StatusBadge status="new">New</StatusBadge>
			<Icon name="chevron" size={16} />
		{/snippet}
	</ListRow>
{/snippet}

<SchemePanels>
	<div class="max-w-kit-example">
		<p class="mb-2 text-caption text-ink-3">{labels[group]}</p>
		<List>
			{#if group === 'in-list'}
				<ListRow title="Bun" subtitle="Seen in the stockpot README">
					{#snippet lead()}
						<CategoryTile color="tech" icon="tech" />
					{/snippet}
					{#snippet trail()}
						<StatusBadge status="ready">Ready</StatusBadge>
						<Icon name="chevron" size={16} />
					{/snippet}
				</ListRow>
				{@render englishRow()}
				<ListRow title="RAG" subtitle="A design review for search" lead={ragTile}>
					{#snippet trail()}
						<StatusBadge status="queued">Queued</StatusBadge>
						<Icon name="chevron" size={16} />
					{/snippet}
				</ListRow>
			{:else if group === 'pressed'}
				{@render englishRow(true)}
			{:else if group === 'selected'}
				<ListRow
					title="RAG"
					subtitle="A design review for search"
					lead={ragTile}
					selectable
					{selected}
					onclick={() => (selected = !selected)}
				>
					{#snippet trail()}
						<StatusBadge status="queued">Queued</StatusBadge>
					{/snippet}
				</ListRow>
			{:else if group === 'disabled'}
				<ListRow title="Idempotency" subtitle="Unread for 7 days" disabled>
					{#snippet lead()}
						<CategoryTile color="concept" icon="concept" />
					{/snippet}
					{#snippet trail()}
						<StatusBadge status="archived">Archived</StatusBadge>
					{/snippet}
				</ListRow>
			{:else}
				<ListRow title="" loading />
			{/if}
		</List>
	</div>
</SchemePanels>
