<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button } from '@stockpot/ui/button'
	import { EmptyState } from '@stockpot/ui/empty-state'
	import { List } from '@stockpot/ui/list'
	import { SearchField } from '@stockpot/ui/search-field'
	import { onDestroy, onMount, type Snippet } from 'svelte'

	import { listenToOthers, NotesAnnouncer } from '#/lib/events'

	import { maxQueryLength } from '../shared/filters'
	import type { BaseOverview, NotesCategory } from '../shared/types'
	import { createBaseApi } from './base-api'
	import { BaseController } from './base-controller.svelte'
	import BaseGroup from './base-group.svelte'
	import BaseRow from './base-row.svelte'
	import { cameBack, type BaseStrings } from './base-view'
	import { CurrentNote } from './current-note.svelte'
	import { limitInput } from './dom'
	import NotesToast from './notes-toast.svelte'
	import { counted } from './notes-toasts.svelte'
	import { rowView, type NotesListStrings } from './row-view'

	interface Props {
		/** The overview as the server rendered it. */
		initial: BaseOverview
		categories: readonly NotesCategory[]
		strings: BaseStrings
		notesStrings: NotesListStrings
		/** The note open beside the list, from the page's `note` parameter. */
		current?: number | null
		/** The card pane the page puts beside the list from 768 up. */
		children?: Snippet
	}

	const { initial, categories, strings, notesStrings, current = null, children }: Props = $props()

	// Base changes nothing itself, so every announcement it hears comes from the card.
	const announcer = new NotesAnnouncer()

	// The island's props are its starting state; the controller owns every change after that.
	const controller = new BaseController({
		initial,
		api: createBaseApi({ fetch: async (url, init) => fetch(url, init) }),
		strings: notesStrings,
	})

	const byId = new Map(categories.map((category) => [category.id, category]))

	const currentNote = new CurrentNote({ initial: current, from: 'base' })

	const headingId = $props.id()

	const search = $derived(controller.showsSearch ? controller.search : null)

	const isBlank = $derived(controller.empty === 'base')

	function reload() {
		controller.reload().catch(() => null)
	}

	// Back from the card page can show this page from the back-forward cache, as it was before.
	function handlePageShow(event: PageTransitionEvent) {
		if (event.persisted) {
			reload()
		}
	}

	onMount(() => {
		// Back from the card page can also serve this page from the HTTP cache, rendered before.
		if (cameBack(performance.getEntriesByType('navigation'))) {
			reload()
		}

		return listenToOthers(announcer, reload)
	})

	onDestroy(() => {
		controller.destroy()
	})
</script>

<svelte:window onpageshow={handlePageShow} />

<div class="flex flex-col gap-4 md:h-full md:min-h-0 md:flex-row md:gap-0">
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<section
		aria-labelledby={headingId}
		onkeydown={(event) => currentNote.keydown(event, controller.drawnRows, false)}
		class="flex flex-col gap-4 md:w-list md:shrink-0 md:overflow-y-auto md:border-e md:border-line md:px-4 md:pt-12 md:pb-10 xl:w-list-wide xl:gap-3.5 xl:px-5 xl:pt-10"
	>
		<header class="flex min-h-10.5 items-end justify-between gap-3 pt-2">
			<h1 id={headingId} class="text-title-l">{strings.heading}</h1>
			{#if !isBlank}
				<p class="pb-1 font-ui text-caption text-ink-3">
					{strings.keptCount.replaceAll('{count}', String(controller.overview.total))}
				</p>
			{/if}
		</header>

		<div class="contents" {@attach limitInput(maxQueryLength)}>
			<SearchField
				label={strings.searchLabel}
				placeholder={strings.searchLabel}
				clearLabel={notesStrings.clearSearch}
				bind:value={
					() => controller.query,
					(text) => {
						controller.typeQuery(text)
					}
				}
				loading={controller.search?.isLoading ?? false}
				disabled={isBlank}
			/>
		</div>

		<div
			aria-busy={controller.search?.isLoading || undefined}
			class="flex flex-col gap-4 xl:gap-3.5"
		>
			{#if search !== null}
				{#if search.rows.length > 0 && search.total !== null}
					<p class="ms-1 -mt-1 -mb-1.5 font-ui text-detail text-ink-2">
						{counted(strings.resultsOne, strings.resultsOther, search.total)}
					</p>
					<List class="[&_.text-list-title]:truncate">
						{#each search.rows as row (row.id)}
							<BaseRow
								{row}
								view={rowView(row, byId)}
								privateLabel={notesStrings.private}
								current={currentNote.current === row.id}
								onopen={(event, id) => {
									currentNote.click(event, id)
								}}
							/>
						{/each}
					</List>
				{/if}
				{#if search.nextCursor !== null}
					<Button
						variant="ghost"
						class="self-center"
						loading={search.isLoadingMore}
						onclick={() => {
							controller.loadMoreResults().catch(() => null)
						}}
					>
						{notesStrings.showMore}
					</Button>
				{/if}
			{:else}
				{#each controller.overview.groups as group (group.categoryId ?? 'none')}
					<BaseGroup
						{group}
						{controller}
						{currentNote}
						categories={byId}
						{strings}
						{notesStrings}
					/>
				{/each}
			{/if}

			{#if controller.empty === 'search'}
				<EmptyState
					icon="search"
					title={strings.noResultsTitle.replaceAll('{query}', controller.search?.query ?? '')}
				>
					{strings.noResults}
					{#snippet action()}
						<Button
							variant="outline"
							onclick={() => {
								controller.clearSearch()
							}}
						>
							{notesStrings.clearSearch}
						</Button>
					{/snippet}
				</EmptyState>
			{:else if controller.empty === 'base'}
				<EmptyState icon="bookmark" title={strings.emptyTitle}>
					{strings.empty}
					{#snippet action()}
						<Button variant="outline" href="/">{strings.openToday}</Button>
					{/snippet}
				</EmptyState>
			{/if}
		</div>
	</section>

	<aside class="hidden md:block md:min-w-0 md:flex-1 md:overflow-y-auto">
		{@render children?.()}
	</aside>
</div>

<NotesToast toast={controller.toasts.current} />
