<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button } from '@stockpot/ui/button'
	import { TextField } from '@stockpot/ui/text-field'
	import { onDestroy } from 'svelte'

	import type { SettingsMessages } from '#/lib/i18n/settings-en'

	import { NewDevice } from './devices-controller.svelte'
	import { createSettingsApi } from './settings-api'
	import SettingsToast from './settings-toast.svelte'
	import { SettingsToasts } from './settings-toasts.svelte'

	interface Props {
		strings: Pick<SettingsMessages, 'devices' | 'errors'>
	}

	const { strings }: Props = $props()

	const id = $props.id()

	const toasts = new SettingsToasts()

	const added = new NewDevice({ api: createSettingsApi(), toasts, strings: strings.errors })

	function done() {
		added.done()
		location.assign('/settings/devices')
	}

	// Leaving the page drops the token with the component.
	onDestroy(() => {
		added.done()
		toasts.destroy()
	})
</script>

<!-- DES-5 390-09: a name, then the token, shown once. -->
<form
	class="flex flex-col gap-1.5"
	onsubmit={async (event) => {
		event.preventDefault()
		await added.create()
	}}
>
	<TextField
		label={strings.devices.name}
		bind:value={added.name}
		maxlength={100}
		required
		disabled={added.token !== null}
		hint={strings.devices.nameHint}
	/>
	{#if added.error !== null}
		<p role="alert" class="mx-0.5 font-ui text-detail font-medium text-danger-ink">{added.error}</p>
	{/if}
	{#if added.token === null}
		<Button type="submit" block class="mt-3" loading={added.creating} disabled={!added.canCreate}>
			{strings.devices.create}
		</Button>
	{/if}
</form>

{#if added.token !== null}
	<section
		aria-labelledby={`${id}-token`}
		class="flex flex-col gap-2.5 rounded-lg bg-fill px-4 py-3.5 font-ui"
	>
		<h2 id={`${id}-token`} class="text-field-label text-ink-2">{strings.devices.token}</h2>
		<code class="font-mono text-body font-medium tracking-wide break-all text-ink">
			{added.token}
		</code>
		<Button
			variant="ghost"
			size="sm"
			icon="copy"
			class="self-start"
			onclick={async () => added.copy(navigator.clipboard)}
		>
			{strings.devices.copy}
		</Button>
		<p class="text-detail text-ink-2">{strings.devices.tokenHint}</p>
	</section>
	<Button block onclick={done}>{strings.devices.done}</Button>
{/if}

<p class="sr-only" aria-live="polite">{added.copied ? strings.devices.copied : ''}</p>

<SettingsToast toast={toasts.current} />
