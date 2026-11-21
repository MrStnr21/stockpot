<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { MouseEventHandler } from 'svelte/elements'

	interface Props {
		children: Snippet
		disabled?: boolean
		pressed?: boolean
		onclick?: MouseEventHandler<HTMLButtonElement>
	}

	const { children, disabled = false, pressed = false, onclick }: Props = $props()
</script>

<button
	type="button"
	{disabled}
	data-state={pressed && !disabled ? 'pressed' : undefined}
	{onclick}
	class={[
		'group/action inline-flex min-h-11 min-w-11 flex-none cursor-pointer items-center justify-center rounded-md font-ui text-body-compact font-semibold text-inverse-accent outline-focus focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed',
		'[--toast-action-pressed-bg:color-mix(in_oklch,var(--color-inverse),var(--color-on-inverse)_var(--toast-action-pressed-mix))]',
		'disabled:text-[color-mix(in_oklch,var(--color-on-inverse)_var(--toast-action-disabled-mix),var(--color-inverse))]',
	]}
>
	<span
		class="grid min-h-10 place-items-center rounded-md px-3 transition-colors duration-(--duration-fast) ease-standard group-enabled/action:group-active/action:bg-(--toast-action-pressed-bg) group-data-[state=pressed]/action:bg-(--toast-action-pressed-bg) motion-reduce:transition-none"
	>
		{@render children()}
	</span>
</button>
