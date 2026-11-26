<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button } from '@stockpot/ui/button'
	import { CategoryChip } from '@stockpot/ui/category'

	import type { CaptureCategory, SuggestSense } from '../shared/types'
	import type { CaptureStrings } from './capture-toasts.svelte'

	interface Props {
		senses: readonly SuggestSense[]
		categories: ReadonlyMap<number, CaptureCategory>
		selected: number | null
		strings: CaptureStrings
		onpick: (index: number) => void
		onnone: () => void
	}

	const { senses, categories, selected, strings, onpick, onnone }: Props = $props()

	const name = $props.id()
</script>

<fieldset class="flex min-w-0 flex-col gap-2">
	<legend class="mb-1.5 font-ui text-field-label text-ink-2">{strings.whichMeaning}</legend>
	{#each senses as sense, index (index)}
		{@const category = categories.get(sense.categoryId)}
		<label
			class={[
				'flex min-h-15 cursor-pointer items-center gap-3 rounded-md border border-line-strong bg-surface px-3 py-2 font-ui text-ink outline-focus',
				'has-checked:border-accent has-checked:bg-accent-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2',
				'transition-colors duration-(--duration-fast) ease-standard motion-reduce:transition-none',
			]}
		>
			<input
				type="radio"
				{name}
				value={index}
				checked={selected === index}
				onchange={() => {
					onpick(index)
				}}
				class="size-5.5 flex-none appearance-none rounded-full border-(length:--border-width-field) border-line-strong bg-surface outline-none checked:border-6 checked:border-accent"
			/>
			<span class="flex min-w-0 flex-1 flex-col items-start gap-1">
				<span class="text-body wrap-break-word">{sense.sense}</span>
				{#if category !== undefined}
					<CategoryChip variant="label" size="sm" color={category.color} icon={category.icon}>
						{category.name}
					</CategoryChip>
				{/if}
			</span>
		</label>
	{/each}
	<Button
		variant="ghost"
		size="sm"
		class="-mt-1 -mb-1.5 -ml-2.5 self-start [&>span]:px-2.5!"
		onclick={onnone}
	>
		{strings.noneOfThese}
	</Button>
</fieldset>
