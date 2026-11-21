<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { MouseEventHandler } from 'svelte/elements'

	import { Icon, type IconName } from '../icon'
	import { useCardDisabled } from './card-disabled'

	interface Props {
		children: Snippet
		icon: IconName
		tone?: 'default' | 'accent'
		disabled?: boolean
		pressed?: boolean
		onclick?: MouseEventHandler<HTMLButtonElement>
	}

	const { children, icon, tone = 'default', disabled, pressed, onclick }: Props = $props()

	const cardDisabled = useCardDisabled()

	const unavailable = $derived(disabled || cardDisabled())
</script>

<button
	type="button"
	disabled={unavailable}
	data-tone={tone}
	data-state={pressed && !unavailable ? 'pressed' : undefined}
	{onclick}
	class={[
		'flex min-h-13.5 min-w-11 cursor-pointer flex-col items-center justify-center gap-0.75 rounded-md px-1 py-1 font-ui text-micro wrap-anywhere text-ink-2 outline-focus',
		'focus-visible:outline-2 focus-visible:outline-offset-2 enabled:active:bg-fill disabled:cursor-not-allowed disabled:text-ink-disabled data-[state=pressed]:bg-fill data-[tone=accent]:enabled:text-accent-ink',
	]}
>
	<Icon name={icon} class="size-5" />
	<span>{@render children()}</span>
</button>
