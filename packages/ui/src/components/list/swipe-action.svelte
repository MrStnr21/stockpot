<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { MouseEventHandler } from 'svelte/elements'

	import { Icon, type IconName } from '../icon'
	import { Spinner } from '../spinner'

	interface Props {
		children: Snippet
		icon: IconName
		tone: 'neutral' | 'danger' | 'accent'
		disabled?: boolean
		loading?: boolean
		pressed?: boolean
		onclick?: MouseEventHandler<HTMLButtonElement>
	}

	const {
		children,
		icon,
		tone,
		disabled = false,
		loading = false,
		pressed = false,
		onclick,
	}: Props = $props()

	const interactive = $derived(!disabled && !loading)

	function handleClick(event: Parameters<MouseEventHandler<HTMLButtonElement>>[0]) {
		if (!interactive) {
			event.preventDefault()
			event.stopPropagation()

			return
		}

		onclick?.(event)
	}
</script>

<button
	type="button"
	{disabled}
	aria-busy={loading || undefined}
	aria-disabled={loading || undefined}
	data-tone={tone}
	data-interactive={interactive || undefined}
	data-state={pressed && interactive ? 'pressed' : undefined}
	onclick={handleClick}
	class={[
		'flex min-h-11 w-20 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 bg-(--swipe-bg) text-center text-caption font-semibold tracking-normal text-(color:--swipe-ink)',
		'transition-colors duration-(--duration-fast) ease-standard motion-reduce:transition-none',
		'focus-visible:inset-ring-2 focus-visible:inset-ring-surface focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-focus',
		'data-[tone=neutral]:[--swipe-bg:var(--color-ink-3)] data-[tone=neutral]:[--swipe-ink:var(--color-canvas)] data-[tone=neutral]:[--swipe-pressed-bg:var(--color-ink-2)]',
		'data-[tone=danger]:[--swipe-bg:var(--color-danger)] data-[tone=danger]:[--swipe-ink:var(--color-on-danger)] data-[tone=danger]:[--swipe-pressed-bg:var(--color-danger-pressed)]',
		'data-[tone=accent]:w-26 data-[tone=accent]:[--swipe-bg:var(--color-accent)] data-[tone=accent]:[--swipe-ink:var(--color-on-accent)] data-[tone=accent]:[--swipe-pressed-bg:var(--color-accent-pressed)]',
		'data-interactive:active:bg-(--swipe-pressed-bg) data-[state=pressed]:bg-(--swipe-pressed-bg)',
		'disabled:cursor-not-allowed disabled:bg-fill-strong disabled:text-ink-disabled aria-busy:cursor-progress',
	]}
>
	{#if loading}
		<Spinner />
	{:else}
		<Icon name={icon} class="size-5" />
	{/if}
	{@render children()}
</button>
