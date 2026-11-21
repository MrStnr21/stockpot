<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { HTMLButtonAttributes } from 'svelte/elements'

	import { Icon } from '../icon'
	import { Spinner } from '../spinner'

	interface Props extends Omit<
		HTMLButtonAttributes,
		'aria-busy' | 'aria-pressed' | 'children' | 'type'
	> {
		children: Snippet
		selected?: boolean
		count?: number | null
		loading?: boolean
		pressed?: boolean
	}

	const {
		children,
		selected = false,
		count,
		loading = false,
		disabled,
		pressed = false,
		class: className,
		...rest
	}: Props = $props()
</script>

<!-- Keep the compact pill inside a full-size touch target. -->
<button
	{...rest}
	type="button"
	{disabled}
	aria-pressed={selected}
	aria-busy={loading || undefined}
	data-state={pressed ? 'pressed' : undefined}
	class={[
		'group/chip inline-flex min-h-11 min-w-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus enabled:cursor-pointer disabled:cursor-not-allowed enabled:aria-busy:cursor-progress',
		className,
	]}
>
	<span
		class="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong bg-surface px-3.5 font-ui text-label font-medium whitespace-nowrap text-ink transition-colors duration-(--duration-fast) ease-standard group-disabled/chip:border-line group-disabled/chip:bg-transparent group-disabled/chip:text-ink-disabled group-aria-pressed/chip:pl-2.5 group-[&:enabled[aria-busy=true]]/chip:text-ink-2 group-[&:enabled[aria-pressed=false]:is(:active,[data-state=pressed])]/chip:bg-fill-strong group-[&:enabled[aria-pressed=true]]/chip:border-transparent group-[&:enabled[aria-pressed=true]]/chip:bg-accent-soft group-[&:enabled[aria-pressed=true]:is(:active,[data-state=pressed])]/chip:bg-accent-soft-pressed group-[&:enabled[aria-pressed=true]:not([aria-busy=true])]/chip:text-accent-ink motion-reduce:transition-none"
	>
		{#if selected}
			<Icon name="check" size={16} />
		{/if}
		<span>{@render children()}</span>
		{#if loading}
			<Spinner size="sm" />
		{:else if count != null}
			<span class="font-semibold group-[&:enabled[aria-pressed=false]]/chip:text-ink-3">
				{count}
			</span>
		{/if}
	</span>
</button>
