<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import SchemePanels from '../../book/scheme-panels.svelte'
	import { CategoryTile } from '../category'
	import { Icon } from '../icon'
	import { FlagBadge, StatusBadge } from '../status-badge'
	import ListRow from './list-row.svelte'
	import List from './list.svelte'

	interface Props {
		group:
			| 'in-list'
			| 'pressed'
			| 'selected'
			| 'disabled'
			| 'loading'
			| 'title-trail'
			| 'subtitle-content'
			| 'attached'
			| 'current'
	}

	const { group }: Props = $props()

	let selected = $state(true)

	const labels = {
		'in-list': 'In a list',
		pressed: 'Pressed',
		selected: 'Selected · multi-select',
		disabled: 'Disabled · archived',
		loading: 'Loading',
		'title-trail': 'Private · flags',
		'subtitle-content': 'Search result · marked matches',
		attached: 'Attached gesture',
		current: 'Current · its card is open beside the list',
	}

	const snippet = [
		{ text: 'A ', match: false },
		{ text: 'kafka', match: true },
		{ text: ' topic keeps events in order within a partition', match: false },
	]

	/* Stands in for a gesture such as a long press: it marks the row control while attached. */
	function markAttached(node: HTMLElement): () => void {
		node.dataset.attached = 'true'

		return () => {
			delete node.dataset.attached
		}
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
			{:else if group === 'title-trail'}
				<ListRow title="to hedge" subtitle="to protect yourself against a loss" href="#hedge">
					{#snippet lead()}
						<CategoryTile color="english" icon="english" />
					{/snippet}
					{#snippet titleTrail()}
						<Icon name="lock" size={16} label="Private" />
					{/snippet}
					{#snippet trail()}
						<FlagBadge flag="draft">Draft</FlagBadge>
						<StatusBadge status="ready">Ready</StatusBadge>
					{/snippet}
				</ListRow>
				<ListRow title="Vector clocks" subtitle="Seen in a talk on CRDTs" href="#clocks">
					{#snippet lead()}
						<CategoryTile color="concept" icon="concept" />
					{/snippet}
					{#snippet trail()}
						<FlagBadge flag="unsure">Unsure</FlagBadge>
						<StatusBadge status="failed">Failed</StatusBadge>
					{/snippet}
				</ListRow>
			{:else if group === 'subtitle-content'}
				<ListRow title="Kafka" href="#kafka">
					{#snippet lead()}
						<CategoryTile color="tech" icon="tech" />
					{/snippet}
					{#snippet subtitleContent()}
						{#each snippet as segment, index (index)}
							{#if segment.match}
								<mark class="rounded-xs bg-accent-soft px-px text-accent-ink">{segment.text}</mark>
							{:else}
								{segment.text}
							{/if}
						{/each}
					{/snippet}
					{#snippet trail()}
						<StatusBadge status="read">Read</StatusBadge>
					{/snippet}
				</ListRow>
			{:else if group === 'attached'}
				<ListRow
					title="Bun"
					subtitle="Seen in the stockpot README"
					href="#bun"
					attach={markAttached}
				>
					{#snippet lead()}
						<CategoryTile color="tech" icon="tech" />
					{/snippet}
				</ListRow>
			{:else if group === 'current'}
				<ListRow title="Bun" subtitle="Seen in the stockpot README" href="#bun">
					{#snippet lead()}
						<CategoryTile color="tech" icon="tech" />
					{/snippet}
				</ListRow>
				<ListRow
					title="RAG"
					subtitle="A design review for search"
					href="#rag"
					lead={ragTile}
					current
				>
					{#snippet trail()}
						<StatusBadge status="ready">Ready</StatusBadge>
					{/snippet}
				</ListRow>
				<ListRow title="Idempotency" subtitle="Seen in a payments guide" href="#idempotency">
					{#snippet lead()}
						<CategoryTile color="concept" icon="concept" />
					{/snippet}
				</ListRow>
			{:else}
				<ListRow title="" loading />
			{/if}
		</List>
	</div>
</SchemePanels>
