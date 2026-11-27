<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { CategoryTile } from '@stockpot/ui/category'
	import { Icon } from '@stockpot/ui/icon'
	import { onDestroy, tick } from 'svelte'

	import { categoryLook } from '#/lib/category-look'
	import type { SettingsMessages } from '#/lib/i18n/settings-en'

	import type { CategoryRow } from '../shared/types'
	import { categorySubtitle, positionText } from './category-view'
	import { OrderedList } from './ordered-list.svelte'
	import { isMoveKey, keyTarget } from './reorder'
	import { createSettingsApi } from './settings-api'
	import SettingsToast from './settings-toast.svelte'
	import { errorToast, SettingsToasts } from './settings-toasts.svelte'
	import { sortable } from './sortable.svelte'

	interface Props {
		categories: readonly CategoryRow[]
		strings: Pick<SettingsMessages, 'categories' | 'formats' | 'errors'>
	}

	const { categories, strings }: Props = $props()

	const api = createSettingsApi()

	const toasts = new SettingsToasts()

	// The first props seed the list; it owns the order after them.
	const list = new OrderedList<CategoryRow>({
		initial: categories,
		save: async (rows) => {
			const result = await api.reorderCategories(rows.map(({ id }) => id))

			return result.ok
		},
	})

	let announcement = $state('')

	let listElement = $state<HTMLUListElement>()

	async function save() {
		if (!(await list.commit())) {
			toasts.show(errorToast(strings.errors.orderFailed))
		}
	}

	async function onKeyDown(event: KeyboardEvent, index: number) {
		if (!isMoveKey(event.key)) {
			return
		}

		event.preventDefault()

		const target = keyTarget(list.items.length, index, event.key)
		const row = list.items[index]

		if (row === undefined || target === index) {
			return
		}

		list.move(index, target)
		// Moving the row in the page can drop the focus; the grip keeps it, so the next key and the keyup land.
		await tick()
		listElement?.querySelector<HTMLButtonElement>(`[data-grip="${row.id}"]`)?.focus()
		announcement = positionText(strings.categories.position, row.name, {
			index: target,
			total: list.items.length,
		})
	}

	async function onKeyUp(event: KeyboardEvent) {
		if (isMoveKey(event.key)) {
			await save()
		}
	}

	onDestroy(() => {
		toasts.destroy()
	})
</script>

<ul
	bind:this={listElement}
	role="list"
	class="overflow-hidden rounded-lg border border-line bg-surface"
>
	{#each list.items as category, index (category.id)}
		{@const look = categoryLook(category.color, category.icon)}
		<li
			data-sortable-row
			class="relative flex min-h-14 items-center gap-3 bg-surface px-3.5 py-2 font-ui not-first:before:pointer-events-none not-first:before:absolute not-first:before:inset-s-14 not-first:before:inset-e-0 not-first:before:top-0 not-first:before:border-t not-first:before:border-line data-dragging:z-1 data-dragging:shadow-toast"
		>
			<CategoryTile color={look.color} icon={look.icon} size="sm" />
			<a
				href={`/settings/categories/${category.id}`}
				class="flex min-w-0 flex-1 flex-col gap-px outline-focus after:absolute after:inset-0 focus-visible:after:rounded-sm focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
			>
				<span class="truncate text-body/5.5 text-ink">{category.name}</span>
				<span class="truncate text-detail text-ink-2">
					{categorySubtitle(category, strings.categories, strings.formats)}
				</span>
			</a>
			<button
				type="button"
				aria-label={strings.categories.move.replaceAll('{name}', category.name)}
				class="relative z-1 grid size-11 shrink-0 cursor-grab touch-none place-items-center rounded-full text-ink-3 outline-focus focus-visible:outline-2 active:cursor-grabbing"
				data-grip={category.id}
				onkeydown={async (event) => onKeyDown(event, index)}
				onkeyup={onKeyUp}
				{@attach sortable({
					index: () => list.items.findIndex(({ id }) => id === category.id),
					count: () => list.items.length,
					onMove: (from, to) => {
						list.move(from, to)
					},
					onDrop: save,
				})}
			>
				<Icon name="grip" class="size-5" />
			</button>
			<Icon name="chevron" class="size-4 text-ink-3" />
		</li>
	{/each}
</ul>

<p class="sr-only" aria-live="polite">{announcement}</p>

<SettingsToast toast={toasts.current} />
