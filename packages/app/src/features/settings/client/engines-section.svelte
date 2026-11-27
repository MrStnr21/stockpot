<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { onDestroy } from 'svelte'

	import type { SettingsMessages } from '#/lib/i18n/settings-en'

	import type { EngineOverview, PublicSettings } from '../shared/types'
	import EngineCard from './engine-card.svelte'
	import { EngineTester, testNoticeText } from './engine-tester.svelte'
	import { engineDisplayOrder } from './engine-view'
	import FallbackOrder from './fallback-order.svelte'
	import { createSettingsApi } from './settings-api'
	import SettingsToast from './settings-toast.svelte'
	import { errorToast, SettingsToasts } from './settings-toasts.svelte'

	interface Props {
		/** The settings without their keys (`toPublicSettings`). */
		engines: PublicSettings['engines']
		fallbackOrder: PublicSettings['routing']['fallbackOrder']
		overview: readonly EngineOverview[]
		/** The server's time of the render, ISO, so the first render matches it. */
		now: string
		locale: string
		timeZone: string
		strings: Pick<
			SettingsMessages,
			'engines' | 'engineState' | 'testOutcome' | 'when' | 'errors' | 'categories'
		>
	}

	const { engines, fallbackOrder, overview, now, locale, timeZone, strings }: Props = $props()

	const api = createSettingsApi()

	const tester = new EngineTester({ api })

	const toasts = new SettingsToasts()

	const context = $derived({ now: new Date(now), locale, timeZone })

	const cards = $derived(
		engineDisplayOrder.flatMap((id) => overview.filter((engine) => engine.id === id)),
	)

	const configured = $derived(overview.filter((engine) => engine.configured).map(({ id }) => id))

	async function test(engine: EngineOverview) {
		const notice = await tester.test(engine.id)

		if (notice !== null) {
			toasts.show(errorToast(testNoticeText(notice, strings)))
		}
	}

	onDestroy(() => {
		toasts.destroy()
	})
</script>

<div class="flex flex-col gap-3">
	{#each cards as engine (engine.id)}
		<EngineCard
			overview={engine}
			{engines}
			slot={tester.slot(engine.id)}
			{context}
			{strings}
			ontest={async () => test(engine)}
		/>
	{/each}
</div>

<FallbackOrder
	order={fallbackOrder}
	{configured}
	{api}
	{toasts}
	strings={{
		engines: strings.engines,
		move: strings.categories.move,
		position: strings.categories.position,
		orderFailed: strings.errors.orderFailed,
	}}
/>

<SettingsToast toast={toasts.current} />
