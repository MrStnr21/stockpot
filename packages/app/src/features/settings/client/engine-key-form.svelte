<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button } from '@stockpot/ui/button'
	import { Badge, StatusBadge } from '@stockpot/ui/status-badge'
	import { onDestroy } from 'svelte'

	import type { SettingsMessages } from '#/lib/i18n/settings-en'

	import type { PublicSettings } from '../shared/types'
	import ConfirmDialog from './confirm-dialog.svelte'
	import { EngineKey, type KeyEngine, type KeyState } from './engine-key.svelte'
	import { EngineTester } from './engine-tester.svelte'
	import { engineBadge, testResultLine, testState } from './engine-view'
	import { createSettingsApi, type SettingsApi } from './settings-api'
	import SettingsToast from './settings-toast.svelte'
	import { SettingsToasts } from './settings-toasts.svelte'

	interface Props {
		engine: KeyEngine
		/** Whether a key is saved: the page never knows the key itself. */
		keyState: KeyState
		/** Under the field, such as Gemini's free-tier note. */
		hint?: string | null
		/** Shows the test after a save here; a page with its own "Last call" block turns it off. */
		showResult?: boolean
		locale: string
		timeZone: string
		strings: Pick<SettingsMessages, 'keys' | 'testOutcome' | 'engineState' | 'errors'>
		/** Shared with the page, so its Test buttons and this test are one; else the form has its own. */
		tester?: EngineTester
		toasts?: SettingsToasts
		api?: Pick<SettingsApi, 'patchSettings' | 'testEngine'>
		onsaved?: (settings: PublicSettings) => void
	}

	const {
		engine,
		keyState,
		hint,
		showResult = true,
		locale,
		timeZone,
		strings,
		tester: sharedTester,
		toasts: sharedToasts,
		api = createSettingsApi(),
		onsaved,
	}: Props = $props()

	const id = $props.id()

	// The first props seed the form; it owns the key's state after them.
	const tester = sharedTester ?? new EngineTester({ api })

	const toasts = sharedToasts ?? new SettingsToasts()

	const key = new EngineKey({ engine, initial: keyState, api, tester, toasts, strings, onsaved })

	const result = $derived(key.tested ? tester.slot(engine).result : null)

	const context = $derived({ locale, timeZone })

	onDestroy(() => {
		if (sharedToasts === undefined) {
			toasts.destroy()
		}
	})
</script>

<!-- DES-5 390-07 "Key": the key's state only, a Replace that reveals a password field, and Clear. -->
<div class="flex flex-col gap-1.5 font-ui">
	{#if key.editing}
		<form
			class="flex flex-col gap-1.5"
			onsubmit={async (event) => {
				event.preventDefault()
				await key.save()
			}}
		>
			<label for={`${id}-key`} class="text-field-label text-ink-2">{strings.keys.label}</label>
			<div
				class="flex min-h-12 items-center rounded-md border border-line-strong bg-surface outline-focus focus-within:border-accent has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 data-error:border-danger"
				data-error={key.error === null ? undefined : ''}
			>
				<input
					id={`${id}-key`}
					type="password"
					autocomplete="off"
					spellcheck="false"
					autocapitalize="off"
					required
					aria-invalid={key.error !== null}
					aria-describedby={hint ? `${id}-hint` : undefined}
					bind:value={key.value}
					class="min-h-11 w-full min-w-0 flex-1 bg-transparent px-3.5 py-2.5 font-mono text-body text-ink outline-none"
				/>
			</div>
			{#if key.error !== null}
				<p role="alert" class="mx-0.5 text-detail font-medium text-danger-ink">{key.error}</p>
			{/if}
			<div class="flex gap-2 pt-1">
				<Button type="submit" size="sm" loading={key.saving} disabled={!key.canSave}>
					{strings.keys.save}
				</Button>
				<Button variant="ghost" size="sm" disabled={key.saving} onclick={() => key.cancel()}>
					{strings.keys.cancel}
				</Button>
			</div>
		</form>
	{:else}
		<span id={`${id}-label`} class="text-field-label text-ink-2">{strings.keys.label}</span>
		<div
			class="flex min-h-12 items-center gap-2 rounded-md border border-line-strong bg-surface py-1 ps-3.5 pe-1"
			aria-labelledby={`${id}-label`}
			role="group"
			data-key-state={key.state}
		>
			{#if key.state === 'set'}
				<span aria-hidden="true" class="font-mono text-body tracking-wide text-ink">
					•••• •••• ••••
				</span>
				<span class="min-w-0 flex-1 truncate text-detail text-ink-2">{strings.keys.saved}</span>
			{:else}
				<span class="min-w-0 flex-1 text-body text-ink-3">{strings.keys.none}</span>
			{/if}
			<Button variant="ghost" size="sm" onclick={() => key.start()}>
				{key.state === 'set' ? strings.keys.replace : strings.keys.add}
			</Button>
		</div>
	{/if}
	{#if hint}
		<p id={`${id}-hint`} class="mx-0.5 text-detail text-ink-2">{hint}</p>
	{/if}
	{#if showResult && result !== null}
		{@const badge = engineBadge({ state: testState(result), result }, context, strings.engineState)}
		<p class="flex flex-wrap items-center gap-2 pt-1 text-detail text-ink-2" aria-live="polite">
			{#if badge.status === null}
				<Badge>{badge.label}</Badge>
			{:else}
				<StatusBadge status={badge.status}>{badge.label}</StatusBadge>
			{/if}
			{testResultLine(result, context, strings.testOutcome)}
		</p>
	{/if}
	{#if key.state === 'set' && !key.editing}
		<Button variant="ghost" size="sm" class="self-start" onclick={() => key.askClear()}>
			{strings.keys.clear}
		</Button>
	{/if}
</div>

<ConfirmDialog
	open={key.confirmingClear}
	title={strings.keys.clearTitle}
	text={strings.keys.clearText}
	confirmLabel={strings.keys.clear}
	cancelLabel={strings.keys.cancel}
	busy={key.saving}
	onconfirm={async () => key.clear()}
	oncancel={() => key.cancelClear()}
/>

{#if sharedToasts === undefined}
	<SettingsToast toast={toasts.current} />
{/if}
