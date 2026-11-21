<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements'

	import { Icon, type IconName } from '../icon'

	interface Props extends Omit<HTMLButtonAttributes, 'children'> {
		icon: IconName
		label: string
		variant?: 'filled' | 'plain'
		iconSize?: 16 | 24 | 32
		pressed?: boolean
	}

	const {
		icon,
		label,
		variant = 'filled',
		iconSize,
		pressed = false,
		disabled = false,
		type = 'button',
		class: className,
		...attributes
	}: Props = $props()
</script>

<button
	{...attributes}
	{type}
	{disabled}
	aria-label={label}
	data-variant={variant}
	data-icon-size={iconSize ?? 'default'}
	data-state={pressed && !disabled ? 'pressed' : undefined}
	class={[
		'group/icon-button inline-grid size-11 flex-none cursor-pointer place-items-center rounded-full text-ink-2 outline-focus',
		'enabled:active:bg-fill-strong enabled:data-[state=pressed]:bg-fill-strong data-[variant=filled]:bg-fill',
		'transition-colors duration-(--duration-fast) ease-standard motion-reduce:transition-none',
		'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:text-ink-disabled',
		className,
	]}
>
	<Icon name={icon} size={iconSize} class="group-data-[icon-size=default]/icon-button:size-5" />
</button>
