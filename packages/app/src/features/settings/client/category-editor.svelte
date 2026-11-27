<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button } from '@stockpot/ui/button'
	import { CategoryTile } from '@stockpot/ui/category'
	import { categoryColors, Icon, type CategoryColor, type IconName } from '@stockpot/ui/icon'
	import { TextField } from '@stockpot/ui/text-field'
	import { onDestroy, tick } from 'svelte'

	import { categoryIcons } from '#/lib/category-look'
	import type { SettingsMessages } from '#/lib/i18n/settings-en'

	import type { EngineId } from '../shared/engines'
	import {
		CategoryEditor,
		maxInstructionsLength,
		maxNameLength,
		type CategoryDraft,
	} from './category-editor-state.svelte'
	import { formatOptions, radioTarget } from './category-view'
	import ConfirmDialog from './confirm-dialog.svelte'
	import { engineDisplayOrder, engineName } from './engine-view'
	import SettingRow from './setting-row.svelte'
	import { createSettingsApi } from './settings-api'
	import SettingsGroup from './settings-group.svelte'
	import SettingsToast from './settings-toast.svelte'
	import { SettingsToasts } from './settings-toasts.svelte'

	interface Props {
		/** `null` for a new category. */
		id: number | null
		initial: CategoryDraft
		noteCount: number
		others: readonly { readonly id: number; readonly name: string }[]
		/** The engine that writes the category's cards by default, or `null` when none is set up. */
		defaultEngine: EngineId | null
		configured: readonly EngineId[]
		strings: Pick<SettingsMessages, 'categories' | 'editor' | 'formats' | 'engines' | 'errors'>
	}

	const { id, initial, noteCount, others, defaultEngine, configured, strings }: Props = $props()

	const toasts = new SettingsToasts()

	// The first props seed the editor; it owns the form after them.
	const editor = new CategoryEditor({
		id,
		initial,
		noteCount,
		others,
		api: createSettingsApi(),
		toasts,
		strings: { ...strings.errors, nameTaken: strings.editor.nameTaken },
		done: () => {
			location.assign('/settings/categories')
		},
	})

	const fieldId = $props.id()

	const formats = formatOptions(strings.formats)

	const swatchClasses = {
		english: 'bg-cat-english aria-checked:ring-cat-english',
		ai: 'bg-cat-ai aria-checked:ring-cat-ai',
		tech: 'bg-cat-tech aria-checked:ring-cat-tech',
		concept: 'bg-cat-concept aria-checked:ring-cat-concept',
		idea: 'bg-cat-idea aria-checked:ring-cat-idea',
		other: 'bg-cat-other aria-checked:ring-cat-other',
	} satisfies Record<CategoryColor, string>

	const title = $derived(
		editor.isNew ? strings.editor.newTitle : editor.draft.name.trim() || initial.name,
	)

	const defaultLabel = strings.editor.engineDefault.replaceAll(
		'{engine}',
		defaultEngine === null ? strings.editor.engineNone : engineName(defaultEngine, strings.engines),
	)

	const question = $derived(editor.question)

	const deleteText = $derived.by(() => {
		const notes = question?.notes ?? 0

		if (notes === 0) {
			return strings.editor.deleteEmpty
		}

		return notes === 1
			? strings.editor.deleteTextOne
			: strings.editor.deleteText.replaceAll('{count}', String(notes))
	})

	/** Arrow keys move the choice, and the focus with it (WAI-ARIA radio group). */
	async function onRadioKey<T>(
		event: KeyboardEvent,
		{ options, current, pick }: { options: readonly T[]; current: T; pick: (value: T) => void },
	) {
		const target = radioTarget(options.indexOf(current), event.key, options.length)
		const next = target === null ? undefined : options[target]

		if (next === undefined) {
			return
		}

		event.preventDefault()
		pick(next)
		await tick()

		const group = event.currentTarget

		if (group instanceof HTMLElement) {
			group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
		}
	}

	onDestroy(() => {
		toasts.destroy()
	})
</script>

<div class="flex min-h-11 items-center justify-between gap-3">
	<a
		href="/settings/categories"
		class="-ms-1 inline-flex min-h-11 items-center gap-1 rounded-sm px-1 font-ui text-label font-medium text-accent-ink outline-focus focus-visible:outline-2 focus-visible:outline-offset-2"
	>
		<Icon name="chevron" class="size-4 -scale-x-100" />
		{strings.categories.title}
	</a>
	<Button
		variant="ghost"
		size="sm"
		disabled={!editor.canSave}
		loading={editor.busy && question === null}
		onclick={async () => editor.save()}
	>
		{strings.editor.save}
	</Button>
</div>

<h1 class="font-ui text-title-l">{title}</h1>

<div
	class="flex items-center gap-3.5 rounded-lg border border-line bg-surface p-4"
	aria-hidden="true"
>
	<CategoryTile color={editor.draft.color} icon={editor.draft.icon} size="lg" />
	<span class="min-w-0 truncate font-read text-title-m">{editor.draft.name.trim() || title}</span>
</div>

<div class="flex flex-col gap-1.5">
	<TextField
		label={strings.editor.name}
		value={editor.draft.name}
		maxlength={maxNameLength}
		required
		autocapitalize="sentences"
		oninput={(event) => {
			editor.set('name', event.currentTarget.value)
		}}
	/>
	{#if editor.nameError}
		<p role="alert" class="mx-0.5 font-ui text-detail font-medium text-danger-ink">
			{editor.nameError}
		</p>
	{/if}
</div>

<SettingsGroup head={strings.editor.icon} card={false}>
	<div
		role="radiogroup"
		aria-label={strings.editor.icon}
		tabindex="-1"
		class="grid grid-cols-6 gap-2"
		onkeydown={async (event) =>
			onRadioKey<IconName>(event, {
				options: categoryIcons,
				current: editor.draft.icon,
				pick: (icon) => {
					editor.set('icon', icon)
				},
			})}
	>
		{#each categoryIcons as icon (icon)}
			{@const checked = editor.draft.icon === icon}
			<button
				type="button"
				role="radio"
				aria-checked={checked}
				aria-label={strings.editor.icons[icon]}
				tabindex={checked ? 0 : -1}
				onclick={() => {
					editor.set('icon', icon)
				}}
				class="grid aspect-square min-h-11 cursor-pointer place-items-center rounded-sm border border-line bg-surface text-ink-2 outline-focus focus-visible:outline-2 focus-visible:outline-offset-2 aria-checked:border-accent aria-checked:bg-accent-soft aria-checked:text-accent-ink aria-checked:ring-1 aria-checked:ring-accent"
			>
				<Icon name={icon} class="size-5" />
			</button>
		{/each}
	</div>
</SettingsGroup>

<SettingsGroup head={strings.editor.colour} foot={strings.editor.colourFoot} card={false}>
	<div
		role="radiogroup"
		aria-label={strings.editor.colour}
		tabindex="-1"
		class="flex flex-wrap gap-2.5"
		onkeydown={async (event) =>
			onRadioKey<CategoryColor>(event, {
				options: categoryColors,
				current: editor.draft.color,
				pick: (color) => {
					editor.set('color', color)
				},
			})}
	>
		{#each categoryColors as color (color)}
			{@const checked = editor.draft.color === color}
			<button
				type="button"
				role="radio"
				aria-checked={checked}
				aria-label={strings.editor.colours[color]}
				tabindex={checked ? 0 : -1}
				onclick={() => {
					editor.set('color', color)
				}}
				class={[
					swatchClasses[color],
					'grid size-11 cursor-pointer place-items-center rounded-full text-surface outline-focus focus-visible:outline-2 focus-visible:outline-offset-4 aria-checked:ring-2 aria-checked:ring-offset-2 aria-checked:ring-offset-surface',
				]}
			>
				{#if checked}
					<Icon name="check" class="size-4.5" />
				{/if}
			</button>
		{/each}
	</div>
</SettingsGroup>

<SettingsGroup head={strings.editor.format}>
	{#each formats as format (format.id)}
		<label
			class="relative flex cursor-pointer items-start gap-3 bg-surface px-3.5 py-3 font-ui not-first:before:pointer-events-none not-first:before:absolute not-first:before:inset-s-12 not-first:before:inset-e-0 not-first:before:top-0 not-first:before:border-t not-first:before:border-line has-focus-visible:outline-2 has-focus-visible:-outline-offset-4 has-focus-visible:outline-focus"
		>
			<input
				type="radio"
				name={`${fieldId}-format`}
				value={format.id}
				checked={editor.draft.format === format.id}
				onchange={() => {
					editor.set('format', format.id)
				}}
				class="mt-0.5 size-5 shrink-0 cursor-pointer accent-accent"
			/>
			<span class="flex flex-col gap-0.5">
				<span class="text-label text-ink">{format.name}</span>
				<span class="text-detail text-ink-2">{format.text}</span>
			</span>
		</label>
	{/each}
</SettingsGroup>

<SettingsGroup head={strings.editor.instructions} card={false}>
	<TextField
		label={strings.editor.instructionsLabel}
		value={editor.draft.instructions}
		multiline
		maxlength={maxInstructionsLength}
		hint={strings.editor.instructionsHint}
		oninput={(event) => {
			editor.set('instructions', event.currentTarget.value)
		}}
	/>
</SettingsGroup>

<SettingsGroup head={strings.editor.engine}>
	<SettingRow label={strings.editor.engineLabel} for={`${fieldId}-engine`}>
		<select
			id={`${fieldId}-engine`}
			value={editor.draft.engine ?? ''}
			onchange={(event) => {
				const picked = engineDisplayOrder.find((engine) => engine === event.currentTarget.value)

				editor.set('engine', picked ?? null)
			}}
			class="min-h-11 max-w-3/5 min-w-0 cursor-pointer appearance-none truncate rounded-sm bg-transparent text-end font-ui text-body/5.5 text-ink-2 outline-focus focus-visible:outline-2 focus-visible:outline-offset-2"
		>
			<option value="">{defaultLabel}</option>
			{#each engineDisplayOrder as engine (engine)}
				<option value={engine}>
					{configured.includes(engine)
						? engineName(engine, strings.engines)
						: strings.editor.engineNotSetUp.replaceAll(
								'{engine}',
								engineName(engine, strings.engines),
							)}
				</option>
			{/each}
		</select>
		<Icon name="chevron" class="pointer-events-none size-4 text-ink-3" />
	</SettingRow>
</SettingsGroup>

{#if !editor.isNew}
	<Button
		variant="outline"
		icon="trash"
		block
		class="text-danger-ink"
		onclick={() => {
			editor.askDelete()
		}}
	>
		{strings.editor.delete}
	</Button>
{/if}

<ConfirmDialog
	open={question !== null}
	title={strings.editor.deleteTitle.replaceAll('{name}', initial.name)}
	text={deleteText}
	confirmLabel={question !== null && question.notes > 0
		? strings.editor.deleteAndMove
		: strings.editor.deleteConfirm}
	cancelLabel={strings.editor.cancel}
	busy={editor.busy}
	canConfirm={question === null || question.notes === 0 || question.moveTo !== null}
	onconfirm={async () => editor.confirmDelete()}
	oncancel={() => {
		editor.cancelDelete()
	}}
>
	{#if question !== null && question.notes > 0}
		<label
			class="flex min-h-11 items-center gap-3 rounded-md border border-line px-3.5 font-ui text-body-compact"
		>
			<span class="flex-1">{strings.editor.moveTo}</span>
			<select
				value={question.moveTo ?? ''}
				onchange={(event) => {
					editor.pickTarget(Number(event.currentTarget.value))
				}}
				class="min-h-11 max-w-1/2 cursor-pointer appearance-none truncate bg-transparent text-end text-ink-2 outline-focus focus-visible:outline-2"
			>
				{#each others as other (other.id)}
					<option value={other.id}>{other.name}</option>
				{/each}
			</select>
			<Icon name="chevron" class="pointer-events-none size-4 text-ink-3" />
		</label>
	{/if}
</ConfirmDialog>

<SettingsToast toast={toasts.current} />
