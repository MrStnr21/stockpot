<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { CategoryTile } from '@stockpot/ui/category'
	import { Icon } from '@stockpot/ui/icon'
	import { ListRow } from '@stockpot/ui/list'

	import type { NoteRow } from '../shared/types'
	import { noteLink } from './open-note'
	import type { RowView } from './row-view'

	interface Props {
		row: NoteRow
		view: RowView
		/** The lock's label on a private note. */
		privateLabel: string
		/** Its card is open beside the list. */
		current: boolean
		/** A click on the row's link. */
		onopen: (event: MouseEvent & { currentTarget: EventTarget }, id: number) => void
	}

	const { row, view, privateLabel, current, onopen }: Props = $props()
</script>

{#snippet lead()}
	<CategoryTile color={view.look.color} icon={view.look.icon} />
{/snippet}

{#snippet lock()}
	<Icon name="lock" size={16} label={privateLabel} />
{/snippet}

{#snippet snippet()}
	{#each view.segments ?? [] as segment, index (index)}
		{#if segment.match}
			<mark class="rounded-xs bg-accent-soft px-px text-accent-ink">{segment.text}</mark>
		{:else}
			{segment.text}
		{/if}
	{/each}
{/snippet}

<ListRow
	title={row.text}
	subtitle={view.subtitle}
	subtitleContent={view.segments === null ? undefined : snippet}
	titleTrail={row.private ? lock : undefined}
	{lead}
	href={noteLink(row.id, 'base')}
	{current}
	onclick={(event) => {
		onopen(event, row.id)
	}}
/>
