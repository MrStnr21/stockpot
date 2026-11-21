<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { HTMLAnchorAttributes } from 'svelte/elements'

	import { Icon, type IconName } from '../icon'

	interface Props extends Omit<HTMLAnchorAttributes, 'aria-current' | 'children' | 'href'> {
		href: string
		icon: IconName
		children: Snippet
		current?: boolean
		badge?: number | null
		badgeLabel?: string | null
		add?: boolean
		pressed?: boolean
	}

	const {
		href,
		icon,
		children,
		current = false,
		badge = null,
		badgeLabel,
		add = false,
		pressed = false,
		class: className,
		...attributes
	}: Props = $props()
</script>

<a
	{...attributes}
	{href}
	aria-current={current ? 'page' : undefined}
	data-add={add || undefined}
	data-state={pressed ? 'pressed' : undefined}
	class={[
		'group/tab relative flex min-h-12.5 min-w-0 flex-col items-center justify-center gap-0.75 rounded-sm text-center font-ui text-micro text-ink-3 outline-focus',
		'focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 aria-[current=page]:text-accent-ink',
		className,
	]}
>
	<span class="min-w-0 wrap-anywhere">{@render children()}</span>
	<span
		class={[
			'relative order-first grid h-7.5 w-13 max-w-full shrink-0 place-items-center rounded-full',
			'group-aria-[current=page]/tab:[--tab-fill:var(--color-accent-soft)] group-data-add/tab:[--tab-fill:var(--color-accent)]',
			'bg-(color:--tab-fill) group-active/tab:bg-fill-strong group-data-[state=pressed]/tab:bg-fill-strong',
			'group-data-add/tab:h-10 group-data-add/tab:rounded-md group-data-add/tab:text-on-accent group-data-add/tab:group-active/tab:bg-accent-pressed group-data-add/tab:group-data-[state=pressed]/tab:bg-accent-pressed',
			'transition-colors duration-(--duration-fast) ease-standard motion-reduce:transition-none',
		]}
	>
		<Icon name={icon} />
		{#if badge !== null && badge > 0}
			<span
				aria-hidden="true"
				class="absolute -top-0.75 right-1.5 h-4.5 min-w-4.5 rounded-full border-2 border-surface bg-accent px-1.25 text-center text-tab-badge text-on-accent"
			>
				{badge > 99 ? '99+' : badge}
			</span>
			<span class="sr-only">{badgeLabel ?? badge}</span>
		{/if}
	</span>
</a>
