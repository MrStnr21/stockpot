<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button } from '@stockpot/ui/button'
	import { CategoryTile } from '@stockpot/ui/category'
	import { List } from '@stockpot/ui/list'

	import type { BaseGroup, NotesCategory } from '../shared/types'
	import type { BaseController } from './base-controller.svelte'
	import BaseRow from './base-row.svelte'
	import { canShowAll, groupView, type BaseStrings } from './base-view'
	import type { CurrentNote } from './current-note.svelte'
	import { rowView, type NotesListStrings } from './row-view'

	interface Props {
		group: BaseGroup
		controller: BaseController
		currentNote: CurrentNote
		categories: ReadonlyMap<number, NotesCategory>
		strings: BaseStrings
		notesStrings: NotesListStrings
	}

	const { group, controller, currentNote, categories, strings, notesStrings }: Props = $props()

	const headingId = $props.id()

	const view = $derived(groupView(group, categories, strings))

	const expanded = $derived(controller.expanded.get(view.key))

	const rows = $derived(controller.rowsOf(group.categoryId))
</script>

<section aria-labelledby={headingId} class="flex flex-col gap-2.5">
	<header class="ms-0.5 -mb-1 flex min-h-8 items-center gap-2.5">
		<CategoryTile color={view.look.color} icon={view.look.icon} size="sm" />
		<h2 id={headingId} class="truncate text-title-s">{view.label}</h2>
		<span class="font-ui text-body-s font-medium text-ink-3">{group.count}</span>
		{#if canShowAll(group)}
			<Button
				variant="ghost"
				size="sm"
				class="ms-auto -me-2.5"
				aria-expanded={expanded !== undefined}
				aria-label={(expanded === undefined ? strings.showAllIn : strings.showLessIn).replaceAll(
					'{category}',
					view.label,
				)}
				onclick={() => {
					if (expanded === undefined) {
						controller.showAll(view.key).catch(() => null)
					} else {
						controller.showLess(view.key)
					}
				}}
			>
				{expanded === undefined ? strings.showAll : strings.showLess}
			</Button>
		{/if}
	</header>

	<!-- The boards keep a row to one title line; the kit's title wraps, so the list truncates it. -->
	<List class="[&_.text-list-title]:truncate" aria-busy={expanded?.isLoading || undefined}>
		{#each rows as row (row.id)}
			<BaseRow
				{row}
				view={rowView(row, categories)}
				privateLabel={notesStrings.private}
				current={currentNote.current === row.id}
				onopen={(event, id) => {
					currentNote.click(event, id)
				}}
			/>
		{/each}
	</List>

	{#if expanded !== undefined && expanded.nextCursor !== null}
		<Button
			variant="ghost"
			class="self-center"
			loading={expanded.isLoading}
			onclick={() => {
				controller.loadMoreIn(view.key).catch(() => null)
			}}
		>
			{notesStrings.showMore}
		</Button>
	{/if}
</section>
