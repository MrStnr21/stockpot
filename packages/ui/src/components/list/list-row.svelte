<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { Attachment } from 'svelte/attachments'
	import type { MouseEventHandler } from 'svelte/elements'

	import { Icon } from '../icon'
	import { Skeleton } from '../skeleton'

	interface Props {
		title: string
		subtitle?: string | null
		/** Drawn in place of `subtitle`, with the same one-line truncation (such as text with marks). */
		subtitleContent?: Snippet
		/** Drawn inline after the title, such as a lock icon with its own label. */
		titleTrail?: Snippet
		/** Decorative only, such as a CategoryTile. */
		lead?: Snippet
		/** Decorative only (a time, a count, a chevron): the row itself is the one control. */
		trail?: Snippet
		/* Putting the swipe wrapper here keeps the list item as a direct child of the list. */
		swipe?: Snippet<[row: Snippet]>
		href?: string | null
		selectable?: boolean
		selected?: boolean
		disabled?: boolean
		loading?: boolean
		pressed?: boolean
		onclick?: MouseEventHandler<HTMLAnchorElement | HTMLButtonElement>
		/** Applied to the row's link or button, such as a long-press gesture. */
		attach?: Attachment<HTMLElement>
	}

	const {
		title,
		subtitle,
		subtitleContent,
		titleTrail,
		lead,
		trail,
		swipe,
		href,
		selectable = false,
		selected = false,
		disabled = false,
		loading = false,
		pressed = false,
		onclick,
		attach,
	}: Props = $props()

	const rowClasses = 'flex min-h-17 w-full items-center gap-3 bg-surface px-3.5 py-3'

	const controlClasses = [
		'group/row cursor-pointer text-start text-ink group-data-swipe/swipe:rounded-lg',
		'transition-colors duration-(--duration-fast) ease-standard motion-reduce:transition-none',
		/* The list and swipe viewport clip an outward outline. */
		'focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-focus',
		'data-interactive:active:bg-fill data-[state=pressed]:bg-fill aria-checked:bg-accent-soft aria-checked:active:bg-accent-soft aria-checked:data-[state=pressed]:bg-accent-soft',
		'disabled:cursor-default aria-disabled:cursor-default',
	]

	const state = $derived(pressed && !disabled ? 'pressed' : undefined)
</script>

{#snippet content()}
	{#if selectable}
		<span
			aria-hidden="true"
			class="inline-grid size-6 shrink-0 place-items-center rounded-full border-(length:--border-width-list-check) border-line-strong text-on-accent group-aria-checked/row:border-accent group-aria-checked/row:bg-accent"
		>
			{#if selected}
				<Icon name="check" size={16} class="size-3.5 stroke-(length:--stroke-width-list-check)" />
			{/if}
		</span>
	{/if}
	{@render lead?.()}
	<span class="flex min-w-0 flex-1 flex-col gap-0.5">
		<span
			class="text-list-title wrap-anywhere group-disabled/row:text-ink-3 group-aria-disabled/row:text-ink-3"
		>
			{title}{#if titleTrail}<span class="ms-1.5 inline-flex align-middle text-ink-3">
					{@render titleTrail()}
				</span>{/if}
		</span>
		{#if subtitleContent}
			<span class="truncate text-body-s text-ink-2">{@render subtitleContent()}</span>
		{:else if subtitle}
			<span class="truncate text-body-s text-ink-2">{subtitle}</span>
		{/if}
	</span>
	{#if trail}
		<span class="flex shrink-0 items-center gap-1.5 text-ink-3">{@render trail()}</span>
	{/if}
{/snippet}

{#snippet row()}
	{#if loading}
		<div class={[rowClasses, 'group-data-swipe/swipe:rounded-lg']}>
			<Skeleton shape="tile" class="size-10 shrink-0" />
			<span class="flex flex-1 flex-col gap-2">
				<Skeleton class="h-3.5 w-(--width-list-loading-title)" />
				<Skeleton class="h-3 w-(--width-list-loading-subtitle)" />
			</span>
		</div>
	{:else if href != null && !selectable}
		<a
			href={disabled ? undefined : href}
			role={disabled ? 'link' : undefined}
			aria-disabled={disabled || undefined}
			data-interactive={!disabled || undefined}
			data-state={state}
			onclick={disabled ? undefined : onclick}
			class={[rowClasses, controlClasses]}
			{@attach attach}
		>
			{@render content()}
		</a>
	{:else}
		<button
			type="button"
			role={selectable ? 'checkbox' : undefined}
			aria-checked={selectable ? selected : undefined}
			{disabled}
			data-interactive={!disabled || undefined}
			data-state={state}
			{onclick}
			class={[rowClasses, controlClasses]}
			{@attach attach}
		>
			{@render content()}
		</button>
	{/if}
{/snippet}

<li
	aria-busy={loading || undefined}
	class="relative min-w-0 not-first:before:pointer-events-none not-first:before:absolute not-first:before:inset-s-16.5 not-first:before:inset-e-0 not-first:before:top-0 not-first:before:z-10 not-first:before:border-t not-first:before:border-line"
>
	{#if swipe}
		{@render swipe(row)}
	{:else}
		{@render row()}
	{/if}
</li>
