<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { HTMLAttributes } from 'svelte/elements'

	import { setCardDisabled } from './card-disabled'

	interface Props extends Omit<HTMLAttributes<HTMLElement>, 'aria-disabled' | 'children'> {
		children: Snippet
		pressed?: boolean
		disabled?: boolean
		compact?: boolean
	}

	const {
		children,
		pressed = false,
		disabled = false,
		compact = false,
		class: className,
		...attributes
	}: Props = $props()

	setCardDisabled(() => disabled)
</script>

<article
	{...attributes}
	aria-disabled={disabled || undefined}
	data-compact={compact || undefined}
	data-state={pressed && !disabled ? 'pressed' : undefined}
	class={[
		'flex min-w-0 flex-col gap-3.5 rounded-lg border border-line bg-surface px-4 pt-4 pb-1.5 text-ink shadow-(--shadow-card)',
		'transition-[background-color,scale] duration-(--duration-fast) ease-standard motion-reduce:transition-colors',
		'[--card-pressed-bg:color-mix(in_oklch,var(--color-surface),var(--color-ink)_var(--card-pressed-mix))]',
		'not-aria-disabled:active:bg-(--card-pressed-bg) data-[state=pressed]:bg-(--card-pressed-bg) motion-safe:not-aria-disabled:active:scale-(--scale-card-pressed) motion-safe:data-[state=pressed]:scale-(--scale-card-pressed)',
		'aria-busy:pb-4 aria-disabled:opacity-(--opacity-card-disabled) aria-disabled:shadow-none',
		className,
	]}
>
	{@render children()}
</article>
