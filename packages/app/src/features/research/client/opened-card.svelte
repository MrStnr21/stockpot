<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { CardMessages } from '#/lib/i18n/card-en'

	import type { CardView } from '../shared/card-view'
	import { actionControls } from './card-action-controls'
	import type { CardAction } from './card-actions'
	import CardActionsBar from './card-actions-bar.svelte'
	import type { CardController } from './card-controller.svelte'
	import CardGone from './card-gone.svelte'
	import type { ScreenContext } from './card-screen'
	import CardToast from './card-toast.svelte'
	import CategorySheet from './category-sheet.svelte'
	import NoteCard from './note-card.svelte'

	type Category = NonNullable<CardView['category']>

	interface Props {
		controller: CardController
		categories: readonly Category[]
		context: ScreenContext
		statuses: Readonly<Record<CardView['note']['status'], string>>
		placement: 'page' | 'pane'
		categoryOpen: boolean
	}

	let {
		controller,
		categories,
		context,
		statuses,
		placement,
		categoryOpen = $bindable(false),
	}: Props = $props()

	const strings: CardMessages = $derived(context.strings)

	const busy = $derived(!controller.canAct)

	function run(action: CardAction | null) {
		if (action !== null) {
			controller.run(action).catch(() => null)
		}
	}
</script>

<div aria-busy={controller.loading || undefined} class="flex flex-col gap-4">
	{#if controller.state.kind === 'card' && controller.layout !== null}
		<NoteCard
			view={controller.state.view}
			layout={controller.layout}
			{context}
			{statuses}
			headingLevel={placement === 'page' ? 1 : 2}
			{busy}
			onpick={(depth) => {
				controller.pick(depth)
			}}
			onbutton={(control) => {
				if (control.action === null) {
					categoryOpen = true
				} else {
					run(control.action)
				}
			}}
		/>
		{#if controller.layout.actions !== null}
			<CardActionsBar
				controls={actionControls(controller.layout, strings, controller.canAct)}
				label={strings.actions}
				{placement}
				{busy}
				onaction={(control) => {
					run(control.action)
				}}
			/>
		{/if}
		<CategorySheet
			{categories}
			currentId={controller.state.view.category?.id ?? null}
			{strings}
			disabled={busy}
			bind:open={categoryOpen}
			onmove={(category) => {
				run({ kind: 'move', categoryId: category.id, categoryName: category.name })
			}}
		/>
	{:else}
		<CardGone
			state={controller.state.kind === 'card' ? { kind: 'empty' } : controller.state}
			{strings}
			backLink={placement === 'page'}
			busy={controller.running === 'undo'}
			onundo={() => {
				run({ kind: 'undo' })
			}}
			onretry={() => {
				controller.retry().catch(() => null)
			}}
		/>
	{/if}
</div>

<CardToast toast={controller.toasts.current} />
