<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { CategoryTile } from '@stockpot/ui/category'
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

	function move(categoryId: number) {
		open = false
		controller.run({ kind: 'move', categoryId }).catch(() => null)
	}
</script>

<Sheet title={strings.moveTitle} closeLabel={strings.close} bind:open>
	<List>
		{#each controller.categories as category (category.id)}
			<ListRow
				title={category.name}
				disabled={!controller.canAct}
				onclick={() => {
					move(category.id)
				}}
			>
				{#snippet lead()}
					<CategoryTile color={category.color} icon={category.icon} />
				{/snippet}
			</ListRow>
		{/each}
	</List>
</Sheet>
