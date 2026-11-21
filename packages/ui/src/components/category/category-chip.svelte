<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { HTMLButtonAttributes } from 'svelte/elements'

	import { Icon, type CategoryColor, type IconName } from '../icon'
	import { categoryColorClasses } from './category-colors'

	interface Props {
		color: CategoryColor
		icon: IconName
		variant: 'label' | 'suggestion'
		size?: 'sm' | 'md'
		picked?: boolean
		disabled?: boolean
		pressed?: boolean
		onclick?: HTMLButtonAttributes['onclick']
		children: Snippet
	}

	const {
		color,
		icon,
		variant,
		size = 'md',
		picked = false,
		disabled = false,
		pressed = false,
		onclick,
		children,
	}: Props = $props()
</script>

{#if variant === 'label'}
	<span
		data-color={color}
		data-size={size}
		class={[
			categoryColorClasses,
			'group/category inline-flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-transparent bg-(--c-soft) pr-3 pl-2.25 font-ui text-category-label text-(color:--c-ink) data-[size=sm]:h-6 data-[size=sm]:gap-1 data-[size=sm]:pr-2.25 data-[size=sm]:pl-1.75 data-[size=sm]:text-(length:--text-caption)',
		]}
	>
		<Icon name={icon} size={16} class="text-(color:--c) group-data-[size=sm]/category:size-3.5" />
		<span class="truncate">{@render children()}</span>
	</span>
{:else}
	<button
		type="button"
		data-color={color}
		data-state={pressed && !disabled ? 'pressed' : undefined}
		aria-pressed={picked}
		{disabled}
		{onclick}
		class={[
			categoryColorClasses,
			'group/category inline-flex h-11 max-w-full min-w-11 cursor-pointer items-center rounded-full font-ui focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed',
		]}
	>
		<span
			class={[
				'inline-flex h-10 min-w-0 items-center gap-1.5 rounded-full border border-line-strong bg-surface pr-3.5 pl-2.75 text-label leading-(--text-caption--line-height) text-ink',
				'transition-colors duration-(--duration-fast) ease-standard motion-reduce:transition-none',
				'group-disabled/category:border-line group-disabled/category:bg-transparent group-disabled/category:text-ink-disabled',
				'group-[&:enabled[aria-pressed=true]]/category:border-(color:--c) group-[&:enabled[aria-pressed=true]]/category:bg-(--c-soft) group-[&:enabled[aria-pressed=true]]/category:text-(color:--c-ink)',
				'group-[&:enabled[aria-pressed=false]:is(:active,[data-state=pressed])]/category:bg-fill-strong',
				'group-[&:enabled[aria-pressed=true]:is(:active,[data-state=pressed])]/category:bg-[color:color-mix(in_oklch,var(--c-soft),var(--c)_var(--category-pressed-mix))]',
			]}
		>
			<Icon
				name={icon}
				size={16}
				class="size-4.5 text-(color:--c) group-disabled/category:text-ink-disabled"
			/>
			<span class="truncate">{@render children()}</span>
		</span>
	</button>
{/if}
