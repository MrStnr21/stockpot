<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Chip } from '@stockpot/ui/chip'
	import { Icon } from '@stockpot/ui/icon'
	import { SearchField } from '@stockpot/ui/search-field'

	import { maxQueryLength } from '../shared/filters'
	import type { NotesCategory, NoteStatus } from '../shared/types'
	import { limitInput } from './dom'
	import type { NotesController } from './notes-controller.svelte'
	import type { NotesListStrings } from './row-view'

	interface Props {
		controller: NotesController
		strings: NotesListStrings
		statusLabels: Readonly<Record<NoteStatus, string>>
		/** The chosen category, if any. */
		category: NotesCategory | null
		/** The instance has no notes: the search waits and the chips are left out. */
		blank: boolean
		/** Opens the category sheet. */
		oncategories: () => void
	}

	const { controller, strings, statusLabels, category, blank, oncategories }: Props = $props()

	const filters = $derived(controller.view.filters)
</script>

<div class="contents" {@attach limitInput(maxQueryLength)}>
	<SearchField
		label={strings.searchLabel}
		placeholder={strings.searchLabel}
		clearLabel={strings.clearSearch}
		bind:value={
			() => controller.query,
			(text) => {
				controller.typeQuery(text)
			}
		}
		loading={controller.view.isLoading}
		disabled={blank}
	/>
</div>

{#if !blank}
	<div
		class="-mx-4 -my-1 flex shrink-0 [scrollbar-width:none] gap-2 overflow-x-auto px-4 xl:-mx-5 xl:px-5"
	>
		<Chip
			selected={category !== null}
			aria-haspopup="dialog"
			data-color={category?.color}
			onclick={oncategories}
			class="shrink-0"
		>
			<span class="inline-flex items-center gap-1.5">
				{#if category !== null}
					<Icon
						name={category.icon}
						size={16}
						class="text-cat-other in-data-[color=ai]:text-cat-ai in-data-[color=concept]:text-cat-concept in-data-[color=english]:text-cat-english in-data-[color=idea]:text-cat-idea in-data-[color=tech]:text-cat-tech"
					/>
				{/if}
				{category?.name ?? strings.allCategories}
				<Icon name="chevron" size={16} class="rotate-90" />
			</span>
		</Chip>
		<Chip
			selected={filters.status === null}
			count={controller.facets.all}
			onclick={() => {
				controller.setStatus(null)
			}}
			class="shrink-0"
		>
			{strings.all}
		</Chip>
		{#each controller.facets.statuses as chip (chip.status)}
			<Chip
				selected={filters.status === chip.status}
				count={chip.count}
				onclick={() => {
					controller.setStatus(chip.status)
				}}
				class="shrink-0"
			>
				{statusLabels[chip.status]}
			</Chip>
		{/each}
	</div>
{/if}
