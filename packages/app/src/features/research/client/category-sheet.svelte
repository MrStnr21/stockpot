<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { CategoryTile } from '@stockpot/ui/category'
	import { List, ListRow } from '@stockpot/ui/list'
	import { Sheet } from '@stockpot/ui/sheet'

	import type { CardMessages } from '#/lib/i18n/card-en'

	import type { CardView } from '../shared/card-view'

	type Category = NonNullable<CardView['category']>

	interface Props {
		categories: readonly Category[]
		currentId: number | null
		strings: CardMessages
		disabled: boolean
		open: boolean
		onmove: (category: Category) => void
	}

	let {
		categories,
		currentId,
		strings,
		disabled,
		open = $bindable(false),
		onmove,
	}: Props = $props()
</script>

<Sheet title={strings.moveTitle} closeLabel={strings.close} bind:open>
	<List>
		{#each categories as category (category.id)}
			<ListRow
				title={category.name}
				subtitle={category.id === currentId ? strings.current : null}
				disabled={disabled || category.id === currentId}
				onclick={() => {
					open = false
					onmove(category)
				}}
			>
				{#snippet lead()}
					<CategoryTile color={category.color} icon={category.icon} />
				{/snippet}
			</ListRow>
		{/each}
	</List>
</Sheet>
