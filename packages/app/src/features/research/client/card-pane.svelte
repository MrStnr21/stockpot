<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { onDestroy, onMount } from 'svelte'

	import type { CardMessages } from '#/lib/i18n/card-en'

	import type { CardView } from '../shared/card-view'
	import { CardController } from './card-controller.svelte'
	import { connectCard, NotesAnnouncer } from './card-island'
	import OpenedCard from './opened-card.svelte'

	interface Props {
		/** The card of the note the page's URL opened, or `null` for an empty pane. */
		initial: CardView | null
		categories: readonly NonNullable<CardView['category']>[]
		timeZone: string
		batchTime: string
		locale: string
		strings: CardMessages
		statuses: Readonly<Record<CardView['note']['status'], string>>
	}

	const { initial, categories, timeZone, batchTime, locale, strings, statuses }: Props = $props()

	const announcer = new NotesAnnouncer()

	// The island's props are its starting state; the controller owns every change after that.
	const controller = new CardController({
		initial,
		strings,
		fetch: async (url, init) => fetch(url, init),
		notesChanged: announcer.announce,
	})

	const context = { strings, locale, timeZone, batchTime }

	let categoryOpen = $state(false)

	onMount(() => connectCard({ controller, announcer, followsList: true }))

	onDestroy(() => {
		controller.destroy()
	})
</script>

<div class="mx-auto w-full max-w-column px-5 pt-10 pb-10 xl:px-0">
	<OpenedCard {controller} {categories} {context} {statuses} placement="pane" bind:categoryOpen />
</div>
