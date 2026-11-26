<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button } from '@stockpot/ui/button'
	import { EmptyState } from '@stockpot/ui/empty-state'

	import type { NotesController } from './notes-controller.svelte'
	import { counted } from './notes-toasts.svelte'
	import type { NotesListStrings } from './row-view'

	interface Props {
		controller: NotesController
		strings: NotesListStrings
		/** Opens the sheet that picks the category to move the notes to. */
		onmove: () => void
	}

	const { controller, strings, onmove }: Props = $props()

	const count = $derived(controller.selection.ids.length)
</script>

<EmptyState icon="list" title={counted(strings.paneSelectedOne, strings.paneSelectedOther, count)}>
	{strings.paneText}
	{#snippet action()}
		<div class="flex flex-wrap justify-center gap-2">
			<Button
				variant="tonal"
				size="sm"
				icon="bolt"
				disabled={!controller.canAct}
				loading={controller.running === 'research'}
				onclick={() => {
					controller.run({ kind: 'research' }).catch(() => null)
				}}
			>
				{strings.researchNow}
			</Button>
			<Button
				variant="outline"
				size="sm"
				icon="tag"
				disabled={!controller.canAct}
				loading={controller.running === 'move'}
				onclick={onmove}
			>
				{strings.changeCategory}
			</Button>
			<Button
				variant="outline"
				size="sm"
				icon="archive"
				disabled={!controller.canAct}
				loading={controller.running === 'archive'}
				onclick={() => {
					controller.run({ kind: 'archive' }).catch(() => null)
				}}
			>
				{strings.archive}
			</Button>
		</div>
	{/snippet}
</EmptyState>
