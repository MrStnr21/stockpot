<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'

	import { IconButton } from '../button'

	interface Props {
		title: string
		closeLabel: string
		/** A keyboard hint drawn next to the close button from `md` up, such as `esc`. */
		closeHint?: string | null
		children: Snippet
		footer?: Snippet
		open?: boolean
		/** For stories that show the open panel in the page without making it modal. */
		inline?: boolean
	}

	let {
		title,
		closeLabel,
		closeHint,
		children,
		footer,
		open = $bindable(false),
		inline = false,
	}: Props = $props()

	const titleId = $props.id()

	let dialog: HTMLDialogElement | undefined = $state()

	let beganOnBackdrop = false

	$effect(() => {
		if (inline || !dialog || open === dialog.open) {
			return
		}

		if (open) {
			dialog.showModal()
		} else {
			dialog.close()
		}
	})

	function dismiss() {
		open = false
	}

	function handleCancel(event: Event) {
		event.preventDefault()
		dismiss()
	}

	function handleClose(event: Event & { currentTarget: HTMLDialogElement }) {
		/* The browser queues close events, so an earlier close may arrive after reopening. */
		if (!event.currentTarget.open) {
			dismiss()
		}
	}

	function handlePointerDown(event: PointerEvent & { currentTarget: HTMLDialogElement }) {
		beganOnBackdrop = event.target === event.currentTarget
	}

	function handleBackdropClick(event: MouseEvent & { currentTarget: HTMLDialogElement }) {
		/* A pointer released outside the panel may have started on a control inside it. */
		if (beganOnBackdrop && event.target === event.currentTarget) {
			dismiss()
		}

		beganOnBackdrop = false
	}
</script>

{#snippet panel()}
	<div
		class={[
			'flex min-w-0 flex-col gap-4 rounded-t-xl bg-surface px-4 pt-2 pb-5 font-ui text-ink',
			'group-data-modal/sheet:pb-[calc(--spacing(5)+env(safe-area-inset-bottom))]',
			'md:group-data-modal/sheet:gap-3.5 md:group-data-modal/sheet:rounded-xl md:group-data-modal/sheet:px-6 md:group-data-modal/sheet:pt-5 md:group-data-modal/sheet:pb-6',
		]}
	>
		<span
			aria-hidden="true"
			class="h-1.25 w-9 self-center rounded-full bg-line-strong md:group-data-modal/sheet:hidden"
		></span>
		<header class="flex items-center justify-between gap-3">
			<h2 id={titleId} class="min-w-0 text-title-m wrap-break-word">{title}</h2>
			<div class="flex items-center gap-2">
				{#if closeHint}
					<kbd
						aria-hidden="true"
						class="hidden h-5 items-center rounded-xs bg-current/14 px-1.5 font-ui text-caption text-ink-3 md:pointer-fine:inline-flex"
					>
						{closeHint}
					</kbd>
				{/if}
				<IconButton icon="x" label={closeLabel} onclick={dismiss} />
			</div>
		</header>
		{@render children()}
		{#if footer}
			<footer class="grid grid-cols-2 gap-2.5">
				{@render footer()}
			</footer>
		{/if}
	</div>
{/snippet}

{#if inline}
	{#if open}
		<section aria-labelledby={titleId} class="rounded-t-xl shadow-(--shadow-sheet)">
			{@render panel()}
		</section>
	{/if}
{:else}
	<dialog
		bind:this={dialog}
		aria-labelledby={titleId}
		data-modal
		oncancel={handleCancel}
		onclose={handleClose}
		onpointerdown={handlePointerDown}
		onclick={handleBackdropClick}
		class={[
			'group/sheet fixed inset-x-0 top-auto bottom-0 m-0 h-fit max-h-dvh w-full max-w-none overflow-x-hidden overflow-y-auto rounded-t-xl bg-surface text-ink shadow-(--shadow-sheet) md:inset-0 md:mx-auto md:mt-24 md:mb-auto md:max-h-[calc(100dvh-(--spacing(48)))] md:max-w-sheet-max md:rounded-xl xl:mt-28 xl:max-h-[calc(100dvh-(--spacing(56)))]',
			'opacity-0 transition-[display,overlay,opacity,translate] transition-discrete duration-(--duration-base) ease-enter open:opacity-100 motion-reduce:transition-[display,overlay,opacity] starting:open:opacity-0',
			'motion-safe:translate-y-full motion-safe:open:translate-y-0 md:motion-safe:translate-y-4 motion-safe:starting:open:translate-y-full md:motion-safe:starting:open:translate-y-4',
			'backdrop:bg-scrim backdrop:opacity-0 backdrop:transition-[display,overlay,opacity] backdrop:transition-discrete backdrop:duration-(--duration-base) backdrop:ease-enter open:backdrop:opacity-100 starting:open:backdrop:opacity-0',
		]}
	>
		{@render panel()}
	</dialog>
{/if}
