<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button } from '@stockpot/ui/button'
	import { CategoryChip } from '@stockpot/ui/category'
	import { Skeleton } from '@stockpot/ui/skeleton'

	import type { CaptureCategory } from '../shared/types'
	import type { CategoryRow } from './capture-model'
	import type { CaptureStrings } from './capture-toasts.svelte'

	interface Props {
		row: CategoryRow
		categories: ReadonlyMap<number, CaptureCategory>
		pickedId: number | null
		strings: CaptureStrings
		onpick: (categoryId: number) => void
		ontoggleall: () => void
	}

	const { row, categories, pickedId, strings, onpick, ontoggleall }: Props = $props()

	const labelId = $props.id()

	const labels = $derived({
		hint: strings.category,
		suggesting: strings.categorySuggesting,
		suggested: strings.categorySuggested,
		all: strings.categoryAll,
		plain: strings.category,
	})

	const chips = $derived(
		row.ids.flatMap((id) => {
			const category = categories.get(id)

			return category === undefined ? [] : [category]
		}),
	)
</script>

<div class="flex min-w-0 flex-col gap-1.5">
	<div class="flex h-4.5 items-center justify-between gap-3">
		<span id={labelId} class="font-ui text-field-label text-ink-2">{labels[row.label]}</span>
		{#if row.label === 'suggested' || row.label === 'all'}
			<Button
				variant="ghost"
				size="sm"
				class="-my-2.25 -mr-2.5 [&>span]:px-2.5!"
				aria-expanded={row.label === 'all'}
				onclick={ontoggleall}
			>
				{row.label === 'all' ? strings.suggested : strings.allCategories}
			</Button>
		{/if}
	</div>
	{#if row.label === 'hint'}
		<p class="py-2.5 font-ui text-body-s text-ink-3">{strings.categoryHint}</p>
	{:else if row.label === 'suggesting'}
		<div aria-busy="true" aria-labelledby={labelId} class="flex gap-2 py-0.5">
			<Skeleton shape="pill" class="h-10 w-32" />
			<Skeleton shape="pill" class="h-10 w-26" />
			<Skeleton shape="pill" class="h-10 w-21" />
		</div>
	{:else}
		<div role="group" aria-labelledby={labelId} class="flex flex-wrap gap-x-2 gap-y-1">
			{#each chips as category (category.id)}
				<CategoryChip
					variant="suggestion"
					color={category.color}
					icon={category.icon}
					picked={category.id === pickedId}
					onclick={() => {
						onpick(category.id)
					}}
				>
					{category.name}
				</CategoryChip>
			{/each}
		</div>
	{/if}
</div>
