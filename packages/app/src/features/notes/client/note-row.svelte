<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { CategoryTile } from '@stockpot/ui/category'
	import { Icon } from '@stockpot/ui/icon'
	import { ListRow } from '@stockpot/ui/list'
	import { FlagBadge, StatusBadge } from '@stockpot/ui/status-badge'

	import type { NoteRow, NoteStatus } from '../shared/types'
	import { longPress } from './long-press'
	import type { NotesListStrings, RowView } from './row-view'

	interface Props {
		row: NoteRow
		view: RowView
		statusLabels: Readonly<Record<NoteStatus, string>>
		strings: NotesListStrings
		/** Select mode: a tap toggles the row instead of opening the note. */
		selecting: boolean
		selected: boolean
		ontoggle: (id: number) => void
		onpress: (id: number) => void
	}

	const { row, view, statusLabels, strings, selecting, selected, ontoggle, onpress }: Props =
		$props()

	const press = longPress(() => {
		onpress(row.id)
	})
</script>

{#snippet lead()}
	<CategoryTile color={view.look.color} icon={view.look.icon} />
{/snippet}

{#snippet lock()}
	<Icon name="lock" size={16} label={strings.private} />
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

{#snippet trail()}
	{#if row.flag !== null}
		<FlagBadge flag={row.flag}>{row.flag === 'draft' ? strings.draft : strings.unsure}</FlagBadge>
	{/if}
	<StatusBadge status={row.status}>{statusLabels[row.status]}</StatusBadge>
{/snippet}

<ListRow
	title={row.text}
	subtitle={view.subtitle}
	subtitleContent={view.segments === null ? undefined : snippet}
	titleTrail={row.private ? lock : undefined}
	{lead}
	{trail}
	href={`/notes/${row.id}`}
	selectable={selecting}
	{selected}
	onclick={selecting
		? () => {
				ontoggle(row.id)
			}
		: undefined}
	attach={press}
/>
