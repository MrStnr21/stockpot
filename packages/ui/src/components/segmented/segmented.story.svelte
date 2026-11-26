<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import SchemePanels from '../../book/scheme-panels.svelte'
	import SegmentedItem from './segmented-item.svelte'
	import Segmented from './segmented.svelte'

	interface Props {
		group: 'states' | 'level-sets'
	}

	const { group }: Props = $props()

	type Level = 'ready' | 'queued' | 'researching' | 'none'

	interface Row {
		label: string
		names: readonly [string, string, string]
		levels: readonly [Level, Level, Level]
		selected: number
	}

	const standard = ['Card', 'How it works', 'Hands-on'] as const

	const rows: Record<Props['group'], readonly Row[]> = {
		states: [
			{
				label: 'Card · deeper levels not asked',
				names: standard,
				levels: ['ready', 'none', 'none'],
				selected: 0,
			},
			{
				label: 'Researching level 2',
				names: standard,
				levels: ['ready', 'researching', 'none'],
				selected: 0,
			},
			{
				label: 'Level 2 written',
				names: standard,
				levels: ['ready', 'ready', 'none'],
				selected: 1,
			},
			{
				label: 'Level 3 waits for tonight',
				names: standard,
				levels: ['ready', 'ready', 'queued'],
				selected: 2,
			},
		],
		'level-sets': [
			{
				label: 'Technology, AI, concept',
				names: standard,
				levels: ['ready', 'none', 'none'],
				selected: 0,
			},
			{
				label: 'English',
				names: ['Card', 'Nuance', 'Practice'],
				levels: ['ready', 'queued', 'none'],
				selected: 0,
			},
			{
				label: 'Idea',
				names: ['Report', 'Feasibility', 'Build plan'],
				levels: ['researching', 'none', 'none'],
				selected: 0,
			},
		],
	}

	const dotLabels = { queued: 'Queued', researching: 'Researching' } as const

	const picked = $state(rows[group].map((row) => row.selected))
</script>

<SchemePanels>
	<ul class="flex max-w-kit-example flex-col gap-4">
		{#each rows[group] as row, index (row.label)}
			<li class="flex flex-col gap-2">
				<p class="text-caption text-ink-3">{row.label}</p>
				<Segmented label="Depth">
					{#each row.names as name, level (name)}
						{@const state = row.levels[level]}
						{@const dot = state === 'queued' || state === 'researching' ? state : null}
						<SegmentedItem
							selected={picked[index] === level}
							muted={state !== 'ready'}
							{dot}
							dotLabel={dot === null ? null : dotLabels[dot]}
							onclick={() => (picked[index] = level)}
						>
							{name}
						</SegmentedItem>
					{/each}
				</Segmented>
			</li>
		{/each}
	</ul>
</SchemePanels>
