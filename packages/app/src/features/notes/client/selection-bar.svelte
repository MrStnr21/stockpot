<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { CardAction } from '@stockpot/ui/card'

	import type { NotesController } from './notes-controller.svelte'
	import type { NotesListStrings } from './row-view'

	interface Props {
		controller: NotesController
		strings: NotesListStrings
		/** Opens the sheet that picks the category to move the notes to. */
		onmove: () => void
	}

	const { controller, strings, onmove }: Props = $props()
</script>

<!-- Phones only: it takes the tab bar's place; from `md` the right pane offers the same actions. -->
<div
	role="toolbar"
	aria-label={strings.toolbarLabel}
	class="fixed inset-x-0 bottom-0 z-10 grid min-h-[calc(--spacing(16)+env(safe-area-inset-bottom))] grid-cols-3 border-t border-line bg-surface px-2 pt-0.75 pb-[calc(--spacing(0.75)+env(safe-area-inset-bottom))] md:hidden"
>
	<CardAction
		icon="bolt"
		tone="accent"
		disabled={!controller.canAct}
		onclick={() => {
			controller.run({ kind: 'research' }).catch(() => null)
		}}
	>
		{strings.researchNow}
	</CardAction>
	<CardAction icon="tag" tone="accent" disabled={!controller.canAct} onclick={onmove}>
		{strings.categoryAction}
	</CardAction>
	<CardAction
		icon="archive"
		tone="accent"
		disabled={!controller.canAct}
		onclick={() => {
			controller.run({ kind: 'archive' }).catch(() => null)
		}}
	>
		{strings.archive}
	</CardAction>
</div>
