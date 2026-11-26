<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { CardAction } from '@stockpot/ui/card'

	import type { ActionControl } from './card-action-controls'

	interface Props {
		controls: readonly ActionControl[]
		label: string
		/** `page`: fixed at the bottom of a phone, in flow from 768. `pane`: a bordered bar that sticks. */
		placement: 'page' | 'pane'
		busy: boolean
		onaction: (control: ActionControl) => void
	}

	const { controls, label, placement, busy, onaction }: Props = $props()
</script>

<div
	role="toolbar"
	aria-label={label}
	aria-busy={busy || undefined}
	data-placement={placement}
	class={[
		'grid auto-cols-fr grid-flow-col border-line bg-surface px-1.5 pt-1',
		'data-[placement=page]:fixed data-[placement=page]:inset-x-0 data-[placement=page]:bottom-0 data-[placement=page]:z-5 data-[placement=page]:border-t data-[placement=page]:pb-[calc(--spacing(1)+env(safe-area-inset-bottom))]',
		'md:data-[placement=page]:static md:data-[placement=page]:rounded-lg md:data-[placement=page]:border md:data-[placement=page]:pb-1',
		'data-[placement=pane]:sticky data-[placement=pane]:bottom-0 data-[placement=pane]:-mx-1.5 data-[placement=pane]:mt-2 data-[placement=pane]:rounded-lg data-[placement=pane]:border data-[placement=pane]:pb-1',
	]}
>
	{#each controls as control (control.key)}
		<CardAction
			icon={control.icon}
			tone={control.tone}
			disabled={control.disabled}
			onclick={() => {
				onaction(control)
			}}
		>
			{control.label}
		</CardAction>
	{/each}
</div>
