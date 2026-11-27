<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Icon } from '@stockpot/ui/icon'
	import { tick } from 'svelte'

	import type { SettingsMessages } from '#/lib/i18n/settings-en'

	import type { EngineId } from '../shared/engines'
	import { positionText } from './category-view'
	import { engineName, fallbackRoles, fullFallbackOrder } from './engine-view'
	import { OrderedList } from './ordered-list.svelte'
	import { isMoveKey, keyTarget } from './reorder'
	import type { SettingsApi } from './settings-api'
	import SettingsGroup from './settings-group.svelte'
	import { errorToast, type SettingsToasts } from './settings-toasts.svelte'
	import { sortable } from './sortable.svelte'

	interface Props {
		/** The stored order; engines it leaves out are drawn after it and saved with the first move. */
		order: readonly EngineId[]
		configured: readonly EngineId[]
		api: Pick<SettingsApi, 'patchSettings'>
		toasts: SettingsToasts
		strings: {
			engines: SettingsMessages['engines']
			move: string
			position: string
			orderFailed: string
		}
	}

	const { order, configured, api, toasts, strings }: Props = $props()

	// The first props seed the list; it owns the order after them.
	// The engines in the saved order: one left out is skipped until a move saves all of them.
	let listed = $state.raw(new Set(order))

	const list = new OrderedList<EngineId>({
		initial: fullFallbackOrder(order),
		save: async (fallbackOrder) => {
			const result = await api.patchSettings({ routing: { fallbackOrder } })

			if (result.ok) {
				listed = new Set(result.value.routing.fallbackOrder)
			}

			return result.ok
		},
	})

	const roles = $derived(fallbackRoles(list.items, { configured: new Set(configured), listed }))

	let announcement = $state('')

	let listElement = $state<HTMLOListElement>()

	function subtitle(id: EngineId) {
		const role = roles.get(id)

		if (role?.role === 'main') {
			return strings.engines.fallbackMain
		}

		if (role?.role === 'unlisted') {
			return strings.engines.fallbackUnlisted
		}

		return role?.role === 'backup'
			? strings.engines.fallbackBackup.replaceAll('{name}', engineName(role.main, strings.engines))
			: strings.engines.fallbackSkipped
	}

	async function save() {
		if (!(await list.commit())) {
			toasts.show(errorToast(strings.orderFailed))
		}
	}

	async function onKeyDown(event: KeyboardEvent, index: number) {
		if (!isMoveKey(event.key)) {
			return
		}

		event.preventDefault()

		const target = keyTarget(list.items.length, index, event.key)
		const id = list.items[index]

		if (id === undefined || target === index) {
			return
		}

		list.move(index, target)
		await tick()
		listElement?.querySelector<HTMLButtonElement>(`[data-grip="${id}"]`)?.focus()
		announcement = positionText(strings.position, engineName(id, strings.engines), {
			index: target,
			total: list.items.length,
		})
	}

	async function onKeyUp(event: KeyboardEvent) {
		if (isMoveKey(event.key)) {
			await save()
		}
	}
</script>

<!-- DES-5 390-05: the numbered order with grips; an engine that is not set up is greyed and skipped. -->
<SettingsGroup head={strings.engines.fallbackHead} foot={strings.engines.fallbackFoot} card={false}>
	<ol
		bind:this={listElement}
		class="overflow-hidden rounded-lg border border-line bg-surface"
		aria-label={strings.engines.fallbackHead}
	>
		{#each list.items as id, index (id)}
			{@const name = engineName(id, strings.engines)}
			<li
				data-sortable-row
				data-engine={id}
				data-off={roles.get(id)?.role === 'skipped' || roles.get(id)?.role === 'unlisted'
					? ''
					: undefined}
				class="group relative flex min-h-13 items-center gap-3 bg-surface py-1 ps-3.5 pe-1.5 font-ui not-first:before:pointer-events-none not-first:before:absolute not-first:before:inset-s-3.5 not-first:before:inset-e-0 not-first:before:top-0 not-first:before:border-t not-first:before:border-line data-dragging:z-1 data-dragging:shadow-toast"
			>
				<span
					class="grid size-6 shrink-0 place-items-center rounded-full bg-fill text-caption font-semibold text-ink-2"
				>
					{index + 1}
				</span>
				<span class="flex min-w-0 flex-1 flex-col gap-px">
					<span class="truncate text-body/5.5 text-ink group-data-off:text-ink-3">{name}</span>
					<span class="truncate text-detail text-ink-2">{subtitle(id)}</span>
				</span>
				<button
					type="button"
					aria-label={strings.move.replaceAll('{name}', name)}
					class="grid size-11 shrink-0 cursor-grab touch-none place-items-center rounded-full text-ink-3 outline-focus focus-visible:outline-2 active:cursor-grabbing"
					data-grip={id}
					onkeydown={async (event) => onKeyDown(event, index)}
					onkeyup={onKeyUp}
					{@attach sortable({
						index: () => list.items.indexOf(id),
						count: () => list.items.length,
						onMove: (from, to) => {
							list.move(from, to)
						},
						onDrop: save,
					})}
				>
					<Icon name="grip" class="size-5" />
				</button>
			</li>
		{/each}
	</ol>
</SettingsGroup>

<p class="sr-only" aria-live="polite">{announcement}</p>
