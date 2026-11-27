<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { ClassValue } from 'svelte/elements'

	interface Props {
		/** The uppercase head above the card. */
		head?: string | null
		/** The note below the card. */
		foot?: string | null
		/** `false` draws the content without the card, such as buttons or engine cards. */
		card?: boolean
		/** Drawn after the card, such as a toggle with a card of its own. */
		after?: Snippet
		class?: ClassValue
		children: Snippet
	}

	const { head, foot, card = true, after, class: className, children }: Props = $props()
</script>

<!-- DES-5 `.sgrp`: a head, the rows in one card, and a foot. -->
<section class={['flex flex-col gap-2', className]}>
	{#if head}
		<h2 class="ms-1 font-ui text-micro tracking-wider text-ink-3 uppercase">{head}</h2>
	{/if}
	{#if card}
		<div class="overflow-hidden rounded-lg border border-line bg-surface">
			{@render children()}
		</div>
	{:else}
		<div class="flex flex-col gap-3">
			{@render children()}
		</div>
	{/if}
	{@render after?.()}
	{#if foot}
		<p class="mx-1 font-ui text-detail text-ink-2">{foot}</p>
	{/if}
</section>
