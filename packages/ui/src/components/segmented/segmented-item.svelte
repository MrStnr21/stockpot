<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { HTMLButtonAttributes, MouseEventHandler } from 'svelte/elements'

	import { tabAfterKey } from './segmented-keys'

	interface Props extends Omit<
		HTMLButtonAttributes,
		'aria-selected' | 'children' | 'onclick' | 'onkeydown' | 'role' | 'tabindex' | 'type'
	> {
		children: Snippet
		selected?: boolean
		/** Drawn in a fainter ink, such as a level that is not written yet. */
		muted?: boolean
		/** A dot after the label: hollow while waiting, accent while in progress. */
		dot?: 'queued' | 'researching' | null
		/** Read out in place of the dot, which is drawn only. */
		dotLabel?: string | null
		onclick?: MouseEventHandler<HTMLButtonElement>
	}

	const {
		children,
		selected = false,
		muted = false,
		dot = null,
		dotLabel = null,
		onclick,
		class: className,
		...attributes
	}: Props = $props()

	/* Arrow keys move along the row and select the tab they land on. */
	function move(event: KeyboardEvent & { currentTarget: HTMLButtonElement }) {
		const list = event.currentTarget.closest('[role="tablist"]')

		if (list === null) {
			return
		}

		const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')]

		const next = tabAfterKey(event.key, {
			index: tabs.indexOf(event.currentTarget),
			count: tabs.length,
			rtl: getComputedStyle(list).direction === 'rtl',
		})

		const tab = next === null ? undefined : tabs[next]

		if (tab === undefined) {
			return
		}

		event.preventDefault()
		tab.focus()
		tab.click()
	}
</script>

<button
	{...attributes}
	type="button"
	role="tab"
	aria-selected={selected}
	tabindex={selected ? 0 : -1}
	data-muted={muted || undefined}
	{onclick}
	onkeydown={move}
	class={[
		'inline-flex h-9.5 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-segment bg-transparent px-1.5 text-label whitespace-nowrap text-ink-2 data-muted:text-ink-3',
		'aria-selected:bg-surface aria-selected:shadow-card aria-selected:not-data-muted:text-ink',
		'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
		'transition-colors duration-(--duration-fast) ease-standard motion-reduce:transition-none',
		className,
	]}
>
	<span class="truncate">{@render children()}</span>
	{#if dot !== null}
		<span
			aria-hidden="true"
			data-dot={dot}
			class="size-1.5 shrink-0 rounded-full data-[dot=queued]:inset-shadow-status-queued data-[dot=researching]:bg-accent"
		></span>
		{#if dotLabel}
			<span class="sr-only">{dotLabel}</span>
		{/if}
	{/if}
</button>
