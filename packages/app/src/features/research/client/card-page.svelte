<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button, IconButton } from '@stockpot/ui/button'
	import { onDestroy, onMount } from 'svelte'

	import { NotesAnnouncer } from '#/lib/events'
	import type { CardMessages } from '#/lib/i18n/card-en'

	import type { CardView } from '../shared/card-view'
	import { CardController } from './card-controller.svelte'
	import { connectCard } from './card-island'
	import { canArchive } from './card-screen'
	import MoreSheet from './more-sheet.svelte'
	import OpenedCard from './opened-card.svelte'

	interface Props {
		initial: CardView
		categories: readonly NonNullable<CardView['category']>[]
		timeZone: string
		batchTime: string
		locale: string
		strings: CardMessages
		statuses: Readonly<Record<CardView['note']['status'], string>>
		/** Where the back chevron leads: the list the card was opened from. */
		backHref?: '/notes' | '/base'
		/** The back chevron's text, naming that list; by default `strings.back`. */
		backLabel?: string
	}

	const {
		initial,
		categories,
		timeZone,
		batchTime,
		locale,
		strings,
		statuses,
		backHref = '/notes',
		backLabel,
	}: Props = $props()

	const announcer = new NotesAnnouncer()

	// The island's props are its starting state; the controller owns every change after that.
	const controller = new CardController({
		initial,
		strings,
		fetch: async (url, init) => fetch(url, init),
		notesChanged: announcer.announce,
	})

	const context = { strings, locale, timeZone, batchTime }

	let moreOpen = $state(false)

	let categoryOpen = $state(false)

	const view = $derived(controller.state.kind === 'card' ? controller.state.view : null)

	onMount(() => connectCard({ controller, announcer, followsList: false }))

	onDestroy(() => {
		controller.destroy()
	})
</script>

<div class="-mx-2 -mt-2 flex h-11 items-center justify-between">
	<Button variant="ghost" size="sm" icon="chevron" href={backHref} class="[&_svg]:rotate-180">
		{backLabel ?? strings.back}
	</Button>
	{#if view !== null}
		<IconButton
			icon="more"
			label={strings.more}
			variant="plain"
			onclick={() => {
				moreOpen = true
			}}
		/>
	{/if}
</div>

<OpenedCard {controller} {categories} {context} {statuses} placement="page" bind:categoryOpen />

{#if view !== null}
	<MoreSheet
		{strings}
		canArchive={canArchive(view)}
		disabled={!controller.canAct}
		bind:open={moreOpen}
		oncategory={() => {
			categoryOpen = true
		}}
		onarchive={() => {
			controller.run({ kind: 'archive' }).catch(() => null)
		}}
	/>
{/if}
