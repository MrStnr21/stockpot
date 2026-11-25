<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button, IconButton } from '@stockpot/ui/button'
	import { Icon } from '@stockpot/ui/icon'
	import { Sheet } from '@stockpot/ui/sheet'
	import { ToggleRow } from '@stockpot/ui/switch'
	import { TextField } from '@stockpot/ui/text-field'
	import { onDestroy, onMount } from 'svelte'

	import type { CaptureCategory } from '../shared/types'
	import { CaptureController, maxTermLength } from './capture-controller.svelte'
	import { historyMatch } from './capture-model'
	import CaptureToast from './capture-toast.svelte'
	import type { CaptureStrings } from './capture-toasts.svelte'
	import CategoryRow from './category-row.svelte'
	import HistoryPanel from './history-panel.svelte'
	import SenseChoice from './sense-choice.svelte'
	import { isApplePlatform, isPlainClick, opensSheet, sheetShortcut } from './shortcuts'
	import { contextFieldMaxLength } from './split-context'

	interface Props {
		categories: readonly CaptureCategory[]
		strings: CaptureStrings
		/** Opens the sheet once it hydrates, as on `/add`. */
		initiallyOpen?: boolean
	}

	const { categories, strings, initiallyOpen = false }: Props = $props()

	const controller = new CaptureController({
		categories,
		strings,
		fetch: async (url, init) => fetch(url, init),
		signIn: () => {
			location.assign('/signin')
		},
	})

	const byId = $derived(new Map(categories.map((category) => [category.id, category])))

	/* Both depend on the browser, so they are set once it runs the island. */
	let isApple = $state(true)

	let canPaste = $state(false)

	const match = $derived(
		controller.answer !== null && (controller.panel === 'saved' || controller.panel === 'seen')
			? historyMatch(controller.answer, controller.panel)
			: null,
	)

	const primaryLabel = $derived(
		controller.error?.kind === 'network'
			? strings.tryAgain
			: { save: strings.save, addContext: strings.addContext, repeat: strings.saveAsRepeat }[
					controller.actions.primary
				],
	)

	function captionFor(panel: typeof controller.panel): string | null {
		if (panel === 'saved') {
			return strings.addContextCaption
		}

		return panel === 'seen' ? strings.repeatCaption : null
	}

	const caption = $derived(captionFor(controller.panel))

	onMount(() => {
		isApple = isApplePlatform(navigator.userAgent)
		canPaste = 'clipboard' in navigator && 'readText' in navigator.clipboard

		if (initiallyOpen) {
			controller.setOpen(true)
		}
	})

	onDestroy(() => {
		controller.destroy()
	})

	async function readClipboard() {
		return navigator.clipboard.readText().catch(() => '')
	}

	async function pasteTerm() {
		controller.pasteTerm(await readClipboard())
	}

	async function pasteLink() {
		controller.pasteLink(await readClipboard())
	}

	/* Every link to /add opens the sheet instead; before the island runs they still go to the page. */
	function handleClick(event: MouseEvent) {
		const link = event.target instanceof Element ? event.target.closest('a[href="/add"]') : null

		if (link !== null && isPlainClick(event)) {
			event.preventDefault()
			controller.setOpen(true)
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (controller.open) {
			const shortcut = sheetShortcut(event)

			if (shortcut !== null) {
				event.preventDefault()
				controller.submit(shortcut === 'save' ? 'primary' : 'secondary').catch(() => null)
			}

			return
		}

		const target = event.target instanceof HTMLElement ? event.target : null

		if (opensSheet(event, target, document.querySelector('dialog[open]') !== null)) {
			event.preventDefault()
			controller.setOpen(true)
		}
	}
</script>

<svelte:document onclick={handleClick} onkeydown={handleKeydown} />

{#snippet kbd(hint: string)}
	<span
		aria-hidden="true"
		class="ml-2 hidden h-5 items-center rounded-xs bg-current/14 px-1.5 text-caption/4 tracking-wide md:pointer-fine:inline-flex"
	>
		{hint}
	</span>
{/snippet}

{#snippet pasteButton()}
	<Button variant="outline" size="sm" icon="clipboard" class="mr-1" onclick={pasteTerm}>
		{strings.paste}
	</Button>
{/snippet}

{#snippet pasteLinkButton()}
	<IconButton icon="link" label={strings.pasteLink} variant="plain" onclick={pasteLink} />
{/snippet}

<Sheet
	bind:open={() => controller.open, (open) => controller.setOpen(open)}
	title={strings.title}
	closeLabel={strings.close}
	closeHint={strings.closeHint}
>
	<TextField
		label={strings.termLabel}
		placeholder={strings.termPlaceholder}
		size="lg"
		hideLabel
		autofocus
		autocapitalize="off"
		enterkeyhint="done"
		spellcheck="false"
		maxlength={maxTermLength}
		bind:value={controller.term}
		oninput={() => {
			controller.termChanged()
		}}
		trailing={canPaste && controller.term === '' ? pasteButton : undefined}
	/>

	{#if controller.panel === null}
		<CategoryRow
			row={controller.row}
			categories={byId}
			pickedId={controller.selection.categoryId}
			{strings}
			onpick={(categoryId) => {
				controller.pickCategory(categoryId)
			}}
			ontoggleall={() => {
				controller.toggleAll()
			}}
		/>
	{:else if controller.panel === 'senses'}
		<SenseChoice
			senses={controller.answer?.senses ?? []}
			categories={byId}
			selected={controller.selection.senseIndex}
			{strings}
			onpick={(index) => {
				controller.pickSense(index)
			}}
			onnone={() => {
				controller.noneOfThese()
			}}
		/>
	{:else if match !== null && (controller.panel === 'saved' || controller.panel === 'seen')}
		<HistoryPanel
			kind={controller.panel}
			{match}
			category={match.categoryId === null ? null : (byId.get(match.categoryId) ?? null)}
			{strings}
			ondifferent={() => {
				controller.differentMeaning()
			}}
		/>
	{/if}

	<TextField
		label={strings.contextLabel}
		placeholder={strings.contextPlaceholder}
		hideLabel
		maxlength={contextFieldMaxLength}
		bind:value={controller.contextField}
		trailing={canPaste ? pasteLinkButton : undefined}
	/>
	{#if controller.isPrivate}
		<p class="-mt-1.5 ml-0.5 flex items-center gap-1.5 font-ui text-caption text-ink-2">
			<Icon name="lock" size={16} class="size-3.5" />
			{strings.staysOnServer}
		</p>
	{/if}

	<div
		data-on={controller.isPrivate || undefined}
		class="rounded-md px-3 py-2.5 transition-colors duration-(--duration-base) ease-standard data-on:bg-accent-soft motion-reduce:transition-none"
	>
		<ToggleRow
			icon="lock"
			title={strings.private}
			description={controller.isPrivate
				? strings.privateOn.replace('{term}', controller.term.trim())
				: strings.privateOff}
			checked={controller.isPrivate}
			onchange={(checked) => {
				controller.isPrivate = checked
				controller.privateChanged()
			}}
		/>
	</div>

	{#if controller.error !== null}
		<div
			role="alert"
			class="flex items-start gap-2.5 rounded-md bg-danger-soft px-3.5 py-3 font-ui text-body-s text-danger-ink"
		>
			<Icon name="alert" class="size-5 flex-none" />
			{#if controller.error.kind === 'network'}
				<span><b class="font-semibold">{strings.errorTitle}</b> {strings.errorBody}</span>
			{:else}
				<span>{controller.error.message ?? strings.errorTitle}</span>
			{/if}
		</div>
	{/if}

	{#snippet footer()}
		<Button
			variant="tonal"
			size="lg"
			class="[&>span]:px-3!"
			disabled={!controller.canSubmit}
			onclick={() => {
				controller.submit('secondary').catch(() => null)
			}}
		>
			{controller.actions.secondary === 'deeper' ? strings.deeperNow : strings.researchNow}
			{@render kbd(isApple ? strings.kbdResearch : strings.kbdResearchCtrl)}
		</Button>
		<Button
			size="lg"
			disabled={controller.selection.categoryId === null}
			loading={controller.isSaving}
			onclick={() => {
				controller.submit('primary').catch(() => null)
			}}
		>
			{primaryLabel}
			{@render kbd(isApple ? strings.kbdSave : strings.kbdSaveCtrl)}
		</Button>
		{#if caption !== null}
			<p class="col-span-2 -mt-1 text-center font-ui text-caption text-ink-2">{caption}</p>
		{/if}
	{/snippet}
</Sheet>

<CaptureToast
	toast={controller.toasts.current}
	{strings}
	onundo={(noteId) => {
		controller.undo(noteId).catch(() => null)
	}}
	onview={() => {
		location.assign('/notes')
	}}
/>
