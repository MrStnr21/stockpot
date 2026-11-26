<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button } from '@stockpot/ui/button'
	import { EmptyState } from '@stockpot/ui/empty-state'

	import type { CardMessages } from '#/lib/i18n/card-en'

	import type { CardState } from './card-controller.svelte'

	interface Props {
		state: Exclude<CardState, { kind: 'card' }>
		strings: CardMessages
		/** The card page links back to the list; the pane sits beside it. */
		backLink: boolean
		busy: boolean
		onundo: () => void
	}

	const { state, strings, backLink, busy, onundo }: Props = $props()
</script>

{#if state.kind === 'deleted'}
	<EmptyState icon="trash" title={strings.deletedTitle}>
		{strings.deleted}
		{#snippet action()}
			<div class="flex flex-wrap justify-center gap-2">
				{#if state.canUndo}
					<Button loading={busy} onclick={onundo}>{strings.undo}</Button>
				{/if}
				{#if backLink}
					<Button variant="ghost" href="/notes">{strings.backToNotes}</Button>
				{/if}
			</div>
		{/snippet}
	</EmptyState>
{:else if state.kind === 'missing'}
	<EmptyState icon="search" title={strings.missingTitle}>{strings.missing}</EmptyState>
{:else}
	<EmptyState icon="list" title={strings.pickTitle}>{strings.pick}</EmptyState>
{/if}
