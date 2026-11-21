<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'
	import type {
		HTMLAnchorAttributes,
		HTMLButtonAttributes,
		MouseEventHandler,
	} from 'svelte/elements'

	import { Icon, type IconName } from '../icon'
	import { Spinner } from '../spinner'

	type ButtonTarget = HTMLAnchorElement | HTMLButtonElement

	type ButtonClick = MouseEventHandler<ButtonTarget>

	interface Props extends Omit<
		HTMLButtonAttributes & HTMLAnchorAttributes,
		'aria-busy' | 'aria-disabled' | 'children' | 'href' | 'type' | 'onclick' | 'onauxclick'
	> {
		children: Snippet
		variant?: 'primary' | 'tonal' | 'outline' | 'ghost' | 'danger'
		size?: 'sm' | 'md' | 'lg'
		icon?: IconName | null
		block?: boolean
		loading?: boolean
		disabled?: boolean
		pressed?: boolean
		type?: HTMLButtonAttributes['type']
		href?: string | null
		onclick?: ButtonClick
		onauxclick?: ButtonClick
	}

	const {
		children,
		variant = 'primary',
		size = 'md',
		icon,
		block = false,
		loading = false,
		disabled = false,
		pressed = false,
		type = 'button',
		href,
		onclick,
		onauxclick,
		class: className,
		tabindex,
		...attributes
	}: Props = $props()

	const unavailable = $derived(disabled || loading)

	const state = $derived(pressed && !unavailable ? 'pressed' : undefined)

	const classes = [
		'group/button inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-md font-ui text-(color:--button-ink) outline-focus',
		'data-[size=lg]:min-h-13 data-[size=sm]:rounded-sm data-block:w-full focus-visible:outline-2 focus-visible:outline-offset-2',
		'[--button-border:transparent] [--button-disabled-bg:var(--color-fill)]',
		'data-[variant=primary]:[--button-bg:var(--color-accent)] data-[variant=primary]:[--button-ink:var(--color-on-accent)] data-[variant=primary]:[--button-pressed-bg:var(--color-accent-pressed)]',
		'data-[variant=tonal]:[--button-bg:var(--color-accent-soft)] data-[variant=tonal]:[--button-ink:var(--color-accent-ink)] data-[variant=tonal]:[--button-pressed-bg:var(--color-accent-soft-pressed)]',
		'data-[variant=outline]:[--button-bg:var(--color-surface)] data-[variant=outline]:[--button-border:var(--color-line-strong)] data-[variant=outline]:[--button-ink:var(--color-ink)] data-[variant=outline]:[--button-pressed-bg:var(--color-fill-strong)]',
		'data-[variant=ghost]:[--button-bg:transparent] data-[variant=ghost]:[--button-disabled-bg:transparent] data-[variant=ghost]:[--button-ink:var(--color-accent-ink)] data-[variant=ghost]:[--button-pressed-bg:var(--color-fill)]',
		'data-[variant=danger]:[--button-bg:var(--color-danger)] data-[variant=danger]:[--button-ink:var(--color-on-danger)] data-[variant=danger]:[--button-pressed-bg:var(--color-danger-pressed)]',
		'aria-busy:cursor-progress data-disabled:cursor-not-allowed data-disabled:text-ink-disabled',
	]

	function handleClick(event: Parameters<ButtonClick>[0]) {
		if (unavailable) {
			event.preventDefault()
			event.stopPropagation()

			return
		}

		if (event.type === 'auxclick') {
			onauxclick?.(event)
		} else {
			onclick?.(event)
		}
	}
</script>

{#snippet surface()}
	<span
		class={[
			'relative inline-flex h-11 min-w-0 flex-1 items-center justify-center rounded-[inherit] border border-(color:--button-border) bg-(--button-bg) px-4.5 text-body/5 font-semibold',
			'group-data-[size=lg]/button:h-13 group-data-[size=lg]/button:px-5.5 group-data-[size=lg]/button:text-title-s/5 group-data-[size=lg]/button:tracking-normal',
			'group-data-[size=sm]/button:h-9 group-data-[size=sm]/button:px-3.5 group-data-[size=sm]/button:text-body-s/5',
			'transition-[background-color,scale] duration-(--duration-fast) ease-standard motion-reduce:transition-none',
			'group-data-disabled/button:border-transparent group-data-disabled/button:bg-(--button-disabled-bg)',
			'group-data-interactive/button:group-active/button:bg-(--button-pressed-bg) group-data-[state=pressed]/button:bg-(--button-pressed-bg)',
			'motion-safe:group-data-interactive/button:group-active/button:scale-(--scale-button-pressed) motion-safe:group-data-[state=pressed]/button:scale-(--scale-button-pressed)',
		]}
	>
		<span class="flex min-w-0 items-center justify-center gap-2 group-aria-busy/button:opacity-0">
			{#if icon}
				<Icon name={icon} class="size-5 group-data-[size=sm]/button:size-4" />
			{/if}
			<span>{@render children()}</span>
		</span>
		{#if loading}
			<Spinner class="absolute inset-0 m-auto" />
		{/if}
	</span>
{/snippet}

{#if href != null}
	<a
		{...attributes}
		href={unavailable ? undefined : href}
		role={unavailable ? 'link' : attributes.role}
		tabindex={disabled ? -1 : (tabindex ?? (loading ? 0 : undefined))}
		data-variant={variant}
		data-size={size}
		data-state={state}
		data-block={block || undefined}
		data-disabled={disabled || undefined}
		data-interactive={!unavailable || undefined}
		aria-busy={loading || undefined}
		aria-disabled={unavailable || undefined}
		class={[classes, className]}
		onclick={handleClick}
		onauxclick={handleClick}
	>
		{@render surface()}
	</a>
{:else}
	<button
		{...attributes}
		{type}
		{disabled}
		{tabindex}
		data-variant={variant}
		data-size={size}
		data-state={state}
		data-block={block || undefined}
		data-disabled={disabled || undefined}
		data-interactive={!unavailable || undefined}
		aria-busy={loading || undefined}
		aria-disabled={loading || undefined}
		class={[classes, className]}
		onclick={handleClick}
		onauxclick={handleClick}
	>
		{@render surface()}
	</button>
{/if}
