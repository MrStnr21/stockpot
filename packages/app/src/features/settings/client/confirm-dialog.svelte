<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button } from '@stockpot/ui/button'
	import type { Snippet } from 'svelte'

	interface Props {
		open: boolean
		title: string
		text: string
		confirmLabel: string
		cancelLabel: string
		busy?: boolean
		/** Whether the confirm button can be pressed, such as once a target is picked. */
		canConfirm?: boolean
		onconfirm: () => void
		oncancel: () => void
		/** Extra controls between the text and the buttons, such as where notes move to. */
		children?: Snippet
	}

	const {
		open,
		title,
		text,
		confirmLabel,
		cancelLabel,
		busy = false,
		canConfirm = true,
		onconfirm,
		oncancel,
		children,
	}: Props = $props()

	const id = $props.id()

	let dialog = $state<HTMLDialogElement>()

	// The native dialog makes the page inert and puts the focus on Cancel (its autofocus).
	$effect(() => {
		if (open && dialog?.open === false) {
			dialog.showModal()
		} else if (!open && dialog?.open === true) {
			dialog.close()
		}
	})
</script>

<!-- DES-5 390-04: an alert over the editor that asks before a delete. -->
<dialog
	bind:this={dialog}
	role="alertdialog"
	aria-labelledby={`${id}-title`}
	aria-describedby={`${id}-text`}
	oncancel={(event) => {
		event.preventDefault()
		oncancel()
	}}
	class="m-auto w-80 max-w-[calc(100vw-(--spacing(8)))] flex-col gap-3.5 rounded-xl bg-surface p-5 text-ink shadow-toast backdrop:bg-scrim open:flex"
>
	<h2 id={`${id}-title`} class="font-ui text-title-m">{title}</h2>
	<p id={`${id}-text`} class="font-ui text-body-compact text-ink-2">{text}</p>
	{@render children?.()}
	<Button variant="danger" block loading={busy} disabled={!canConfirm} onclick={onconfirm}>
		{confirmLabel}
	</Button>
	<Button variant="outline" block autofocus onclick={oncancel}>{cancelLabel}</Button>
</dialog>
