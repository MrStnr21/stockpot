<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'

	interface Props {
		children: Snippet
		open?: 'start' | 'end' | null
		/* Positive pixels reveal the start. Negative pixels reveal the end. */
		offset?: number
		start?: Snippet
		end?: Snippet
	}

	const { children, open, offset = 0, start, end }: Props = $props()

	const startOpen = $derived(open === 'start' && offset > 0)

	const endOpen = $derived(open === 'end' && offset < 0)

	/* Screens must also offer each swipe action through a control reachable without the gesture. */
</script>

<div
	data-swipe
	data-state={open ?? 'closed'}
	class="group/swipe relative overflow-clip rounded-lg bg-fill"
	style:--offset={`${offset}px`}
>
	{#if start}
		<div inert={!startOpen} class="absolute inset-y-0 start-0 flex">
			{@render start()}
		</div>
	{/if}
	{#if end}
		<div inert={!endOpen} class="absolute inset-y-0 end-0 flex">
			{@render end()}
		</div>
	{/if}
	<div
		class="relative translate-x-(--offset) transition-transform duration-(--duration-slow) ease-enter motion-reduce:transition-none rtl:-translate-x-(--offset)"
	>
		{@render children()}
	</div>
</div>
