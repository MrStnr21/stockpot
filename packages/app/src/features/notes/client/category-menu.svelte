<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { CategoryTile } from '@stockpot/ui/category'
	import { Icon } from '@stockpot/ui/icon'
	import { List, ListRow } from '@stockpot/ui/list'
	import { Sheet } from '@stockpot/ui/sheet'

	import type { NotesController } from './notes-controller.svelte'
	import type { NotesListStrings } from './row-view'

	interface Props {
		controller: NotesController
		strings: NotesListStrings
		open: boolean
	}

	let { controller, strings, open = $bindable(false) }: Props = $props()

	const current = $derived(controller.view.filters.categoryId)

	function pick(categoryId: number | null) {
		open = false
		controller.setCategory(categoryId)
	}
</script>

{#snippet count(value: number, isCurrent: boolean)}
	<span class="text-caption">{value}</span>
	{#if isCurrent}
		<Icon name="check" size={16} label={strings.current} class="text-accent-ink" />
	{/if}
{/snippet}

<Sheet title={strings.categoryTitle} closeLabel={strings.close} bind:open>
	<List>
		<ListRow
			title={strings.allCategories}
			onclick={() => {
				pick(null)
			}}
		>
			{#snippet lead()}
				<CategoryTile color="other" icon="list" />
			{/snippet}
			{#snippet trail()}
				{@render count(controller.facets.allCategories, current === null)}
			{/snippet}
		</ListRow>
		{#each controller.categories as category (category.id)}
			<ListRow
				title={category.name}
				onclick={() => {
					pick(category.id)
				}}
			>
				{#snippet lead()}
					<CategoryTile color={category.color} icon={category.icon} />
				{/snippet}
				{#snippet trail()}
					{@render count(
						controller.facets.categories.get(category.id) ?? 0,
						current === category.id,
					)}
				{/snippet}
			</ListRow>
		{/each}
	</List>
	<a
		href="/settings"
		class="self-start rounded-xs py-2 font-ui text-label text-accent-ink outline-focus focus-visible:outline-2 focus-visible:outline-offset-2"
	>
		{strings.manageCategories}
	</a>
</Sheet>
