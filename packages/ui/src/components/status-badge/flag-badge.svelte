<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'

	import { Icon } from '../icon'

	interface Props {
		/** A mark on a card: a draft, or an answer the research was unsure about. */
		flag: 'draft' | 'unsure'
		children: Snippet
		class?: string
	}

	const { flag, children, class: className }: Props = $props()
</script>

<span
	data-flag={flag}
	class={[
		'inline-flex h-5.5 items-center gap-1.5 rounded-xs border border-line-strong bg-transparent px-2 font-ui text-caption font-semibold tracking-normal whitespace-nowrap text-ink-2',
		className,
	]}
>
	{#if flag === 'unsure'}
		<Icon name="alert" size={16} class="size-3 [stroke-width:var(--stroke-width-status-icon)]" />
	{/if}
	{@render children()}
</span>
