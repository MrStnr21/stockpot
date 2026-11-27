<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Icon } from '@stockpot/ui/icon'
	import type { Snippet } from 'svelte'
	import type { ClassValue } from 'svelte/elements'

	interface Props {
		label: string
		hint?: string | null
		/** The id of the control in `children`, so the label names it and the hint describes it. */
		for?: string | null
		/** The control, such as a time field or a stepper. */
		children?: Snippet
		/** A link row: the whole row leads here, with its value and a chevron. */
		href?: string | null
		/** Opens another site: an external icon instead of the chevron. */
		external?: boolean
		/** The value shown on the right of a link or read-only row. */
		value?: string | null
		/** Draws the dot of something that needs attention, with this as its text. */
		attention?: string | null
		/** The server's reason for refusing the last value, under the row. */
		error?: string | null
		class?: ClassValue
	}

	const {
		label,
		hint,
		for: controlId,
		children,
		href,
		external = false,
		value,
		attention,
		error,
		class: className,
	}: Props = $props()

	const hintId = $derived(controlId ? `${controlId}-hint` : undefined)

	/* DES-5 `.srow`: 52 px tall, a hairline above every row but the first. */
	const rowClasses = [
		'relative flex min-h-13 w-full items-center gap-3 bg-surface px-3.5 py-2 font-ui text-ink',
		'not-first:before:pointer-events-none not-first:before:absolute not-first:before:inset-e-0 not-first:before:inset-s-3.5 not-first:before:top-0 not-first:before:border-t not-first:before:border-line',
	]
</script>

{#snippet main()}
	<span class="flex min-w-0 flex-1 flex-col gap-px">
		{#if controlId && !href}
			<label for={controlId} class="text-body/5.5">{label}</label>
		{:else}
			<span class="text-body/5.5">{label}</span>
		{/if}
		{#if hint}
			<span id={hintId} class="text-detail text-ink-2">{hint}</span>
		{/if}
		{#if error}
			<span role="alert" class="text-detail font-medium text-danger-ink">{error}</span>
		{/if}
	</span>
{/snippet}

{#if href}
	<a
		{href}
		class={[
			rowClasses,
			'outline-focus transition-colors duration-(--duration-fast) ease-standard focus-visible:outline-2 focus-visible:-outline-offset-4 active:bg-fill motion-reduce:transition-none',
			className,
		]}
	>
		{@render main()}
		{#if attention}
			<span class="size-2 shrink-0 rounded-full bg-danger"></span>
			<span class="sr-only">{attention}</span>
		{/if}
		{#if value}
			<span class="shrink-0 text-body/5.5 text-ink-2">{value}</span>
		{/if}
		<Icon name={external ? 'external' : 'chevron'} class="size-4 shrink-0 text-ink-3" />
	</a>
{:else}
	<div class={[rowClasses, className]}>
		{@render main()}
		{#if value}
			<span class="shrink-0 text-body/5.5 text-ink-2">{value}</span>
		{/if}
		{@render children?.()}
	</div>
{/if}
