<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button } from '@stockpot/ui/button'
	import { EmptyState } from '@stockpot/ui/empty-state'
	import { List } from '@stockpot/ui/list'
	import { onDestroy, onMount, type Snippet } from 'svelte'

	import { notesChangedEvent } from '#/lib/events'

	import type { NoteFilters } from '../shared/filters'
	import type { CountRow, NotesCategory, NotesPage, NoteRow as Row } from '../shared/types'
	import BulkPane from './bulk-pane.svelte'
	import CategoryMenu from './category-menu.svelte'
	import CategoryPicker from './category-picker.svelte'
	import { CurrentNote } from './current-note.svelte'
	import { endsSelection, nearEnd } from './dom'
	import NoteRow from './note-row.svelte'
	import { NotesController } from './notes-controller.svelte'
	import NotesFilters from './notes-filters.svelte'
	import NotesToast from './notes-toast.svelte'
	import { counted } from './notes-toasts.svelte'
	import { rowView, statusLabels, type NotesListStrings } from './row-view'
	import SelectionBar from './selection-bar.svelte'

	interface Props {
		/** The first page as the server rendered it. */
		initial: NotesPage
		counts: readonly CountRow[]
		categories: readonly NotesCategory[]
		filters: NoteFilters
		timeZone: string
		locale: string
		renderedAt: number
		strings: NotesListStrings
		/** The note open beside the list, from the page's `note` parameter. */
		current?: number | null
		/** The card pane the page puts beside the list from 768 up; kept mounted in select mode. */
		children?: Snippet
	}

	const {
		initial,
		counts,
		categories,
		filters,
		timeZone,
		locale,
		renderedAt,
		strings,
		current = null,
		children,
	}: Props = $props()

	// The island's props are its starting state; the controller owns every change after that.
	const controller = new NotesController({
		initial,
		counts,
		categories,
		filters,
		timeZone,
		locale,
		renderedAt,
		strings,
		fetch: async (url, init) => fetch(url, init),
	})

	const byId = new Map(categories.map((category) => [category.id, category]))

	const currentNote = new CurrentNote({ initial: current })

	const labels = statusLabels(strings)

	const headingId = $props.id()

	let isMenuOpen = $state(false)

	let isPickerOpen = $state(false)

	const view = $derived(controller.view)

	const isSelecting = $derived(controller.selection.isActive)

	const isBlank = $derived(controller.empty === 'instance')

	const category = $derived(
		view.filters.categoryId === null ? null : (byId.get(view.filters.categoryId) ?? null),
	)

	const rowCount = $derived(view.rows.length)

	const loadMore = nearEnd(() => {
		controller.loadMore()
	})

	function reload() {
		controller.notesChanged()
	}

	onMount(() => {
		globalThis.addEventListener(notesChangedEvent, reload)

		return () => {
			globalThis.removeEventListener(notesChangedEvent, reload)
		}
	})

	onDestroy(() => {
		controller.destroy()
	})

	function handleKeydown(event: KeyboardEvent) {
		if (endsSelection(event, isSelecting, document.querySelector('dialog[open]') !== null)) {
			controller.done()
		}
	}

	function openPicker() {
		isPickerOpen = true
	}
</script>

<svelte:document onkeydown={handleKeydown} />

<!-- The boards keep a row to one title line; the kit's title wraps, so the list truncates it. -->
{#snippet rows(list: readonly Row[])}
	<List class="[&_.text-list-title]:truncate">
		{#each list as row (row.id)}
			<NoteRow
				{row}
				view={rowView(row, byId)}
				statusLabels={labels}
				{strings}
				selecting={isSelecting}
				selected={controller.selected.has(row.id)}
				current={currentNote.current === row.id}
				onopen={(event, id) => {
					currentNote.click(event, id)
				}}
				ontoggle={(id) => {
					controller.toggle(id)
				}}
				onpress={(id) => {
					controller.press(id)
				}}
			/>
		{/each}
	</List>
{/snippet}

<div class="flex flex-col gap-4 md:h-full md:min-h-0 md:flex-row md:gap-0">
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<section
		aria-labelledby={headingId}
		onkeydown={(event) => currentNote.keydown(event, view.rows, isSelecting)}
		class="flex flex-col gap-4 md:w-list md:shrink-0 md:overflow-y-auto md:border-e md:border-line md:px-4 md:pt-12 md:pb-10 xl:w-list-wide xl:gap-3.5 xl:px-5 xl:pt-10"
	>
		<header class="flex min-h-10.5 items-end justify-between gap-3 pt-2">
			<h1 id={headingId} class="text-title-l">
				{isSelecting
					? counted(strings.selectedOne, strings.selectedOther, controller.selection.ids.length)
					: strings.heading}
			</h1>
			{#if isSelecting}
				<Button
					variant="ghost"
					size="sm"
					class="-me-2.5 -mb-1"
					onclick={() => {
						controller.done()
					}}
				>
					{strings.done}
				</Button>
			{:else if !isBlank}
				<Button
					variant="ghost"
					size="sm"
					class="-me-2.5 -mb-1"
					onclick={() => {
						controller.startSelecting()
					}}
				>
					{strings.select}
				</Button>
			{/if}
		</header>

		<NotesFilters
			{controller}
			{strings}
			statusLabels={labels}
			{category}
			blank={isBlank}
			oncategories={() => {
				isMenuOpen = true
			}}
		/>

		<div aria-busy={view.isLoading || undefined} class="flex flex-col gap-4 xl:gap-3.5">
			{#if view.filters.q !== '' && view.total !== null && rowCount > 0}
				<p class="ms-1 -mt-1 -mb-1.5 font-ui text-detail text-ink-2">
					{counted(strings.resultsOne, strings.resultsOther, view.total)}
				</p>
			{/if}

			{#if controller.groups === null}
				{#if rowCount > 0}
					{@render rows(view.rows)}
				{/if}
			{:else}
				{#each controller.groups as group (group.key)}
					<section class="flex flex-col gap-2.5">
						<h2 class="ms-1 font-ui text-micro text-ink-3 uppercase">{group.label}</h2>
						{@render rows(group.rows)}
					</section>
				{/each}
			{/if}

			{#if controller.empty === 'search'}
				<EmptyState
					icon="search"
					title={strings.noResultsTitle.replaceAll('{query}', view.filters.q)}
				>
					{strings.noResults}
					{#snippet action()}
						<Button
							variant="outline"
							onclick={() => {
								controller.clearSearch()
							}}
						>
							{strings.clearSearch}
						</Button>
					{/snippet}
				</EmptyState>
			{:else if controller.empty === 'filters'}
				<EmptyState icon="list" title={strings.noMatchesTitle}>
					{strings.noMatches}
					{#snippet action()}
						<Button
							variant="outline"
							onclick={() => {
								controller.clearFilters()
							}}
						>
							{strings.clearFilters}
						</Button>
					{/snippet}
				</EmptyState>
			{:else if controller.empty === 'instance'}
				<EmptyState icon="pot" title={strings.emptyTitle}>
					{strings.empty}
					{#snippet action()}
						<Button href="/add">{strings.addNote}</Button>
					{/snippet}
				</EmptyState>
			{/if}

			{#if view.nextCursor !== null}
				{#key rowCount}
					<div aria-hidden="true" class="-mt-4 h-px" {@attach loadMore}></div>
				{/key}
				<Button
					variant="ghost"
					class="self-center"
					loading={view.isLoadingMore}
					onclick={() => {
						controller.loadMore()
					}}
				>
					{strings.showMore}
				</Button>
			{/if}
		</div>
	</section>

	<aside class="hidden md:block md:min-w-0 md:flex-1 md:overflow-y-auto">
		{#if isSelecting}
			<div class="px-5 pt-36 xl:px-12">
				<BulkPane {controller} {strings} onmove={openPicker} />
			</div>
		{/if}
		<div hidden={isSelecting} class="h-full">
			{@render children?.()}
		</div>
	</aside>
</div>

{#if isSelecting}
	<SelectionBar {controller} {strings} onmove={openPicker} />
{/if}

<CategoryMenu {controller} {strings} bind:open={isMenuOpen} />
<CategoryPicker {controller} {strings} bind:open={isPickerOpen} />
<NotesToast toast={controller.toasts.current} />
