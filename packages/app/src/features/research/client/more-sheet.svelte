<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Icon } from '@stockpot/ui/icon'
	import { List, ListRow } from '@stockpot/ui/list'
	import { Sheet } from '@stockpot/ui/sheet'

	import type { CardMessages } from '#/lib/i18n/card-en'

	interface Props {
		strings: CardMessages
		canArchive: boolean
		disabled: boolean
		open: boolean
		oncategory: () => void
		onarchive: () => void
	}

	let {
		strings,
		canArchive,
		disabled,
		open = $bindable(false),
		oncategory,
		onarchive,
	}: Props = $props()
</script>

<Sheet title={strings.more} closeLabel={strings.close} bind:open>
	<List>
		<ListRow
			title={strings.changeCategory}
			{disabled}
			onclick={() => {
				open = false
				oncategory()
			}}
		>
			{#snippet lead()}
				<Icon name="list" />
			{/snippet}
		</ListRow>
		{#if canArchive}
			<ListRow
				title={strings.archive}
				{disabled}
				onclick={() => {
					open = false
					onarchive()
				}}
			>
				{#snippet lead()}
					<Icon name="archive" />
				{/snippet}
			</ListRow>
		{/if}
	</List>
</Sheet>
