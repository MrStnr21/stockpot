<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'

	import { Icon, type IconName } from '../icon'

	interface Props {
		/** Drawn before the text, such as a lock on "Private". */
		icon?: IconName | null
		children: Snippet
		class?: string
	}

	const { icon = null, children, class: className }: Props = $props()
</script>

<span
	class={[
		'inline-flex h-5.5 items-center gap-1.5 rounded-xs border border-transparent bg-fill px-2 font-ui text-caption font-semibold tracking-normal whitespace-nowrap text-ink-2',
		className,
	]}
>
	{#if icon !== null}
		<Icon name={icon} size={16} class="size-3 [stroke-width:var(--stroke-width-status-icon)]" />
	{/if}
	{@render children()}
</span>
