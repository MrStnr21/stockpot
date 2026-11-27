<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button } from '@stockpot/ui/button'
	import { Icon } from '@stockpot/ui/icon'
	import { onDestroy } from 'svelte'

	import type { SettingsMessages } from '#/lib/i18n/settings-en'

	import type { DeviceRow } from '../shared/types'
	import ConfirmDialog from './confirm-dialog.svelte'
	import { deviceIcon, DevicesList, deviceSubtitle } from './devices-controller.svelte'
	import { createSettingsApi } from './settings-api'
	import SettingsGroup from './settings-group.svelte'
	import SettingsToast from './settings-toast.svelte'
	import { SettingsToasts } from './settings-toasts.svelte'

	interface Props {
		devices: readonly DeviceRow[]
		/** The server's time of the render, ISO, so the first render matches it. */
		now: string
		locale: string
		timeZone: string
		strings: Pick<SettingsMessages, 'devices' | 'when' | 'errors' | 'keys'>
	}

	const { devices, now, locale, timeZone, strings }: Props = $props()

	const toasts = new SettingsToasts()

	// The first props seed the list; it owns the rows after them.
	const list = new DevicesList({
		initial: devices,
		api: createSettingsApi(),
		toasts,
		strings: strings.errors,
	})

	const when = $derived({ now: new Date(now), locale, timeZone, strings })

	onDestroy(() => {
		toasts.destroy()
	})
</script>

<!-- DES-5 390-08 "Devices": each device with its last use and a Revoke. -->
<SettingsGroup
	head={strings.devices.head}
	foot={strings.devices.foot}
	card={list.devices.length > 0}
>
	{#each list.devices as device (device.id)}
		<div
			data-device={device.id}
			class="relative flex min-h-14 items-center gap-3 bg-surface py-2 ps-3.5 pe-1.5 font-ui not-first:before:pointer-events-none not-first:before:absolute not-first:before:inset-s-14 not-first:before:inset-e-0 not-first:before:top-0 not-first:before:border-t not-first:before:border-line"
		>
			<span class="grid size-8 shrink-0 place-items-center rounded-xs bg-fill text-ink-2">
				<Icon name={deviceIcon(device.name)} class="size-4.5" />
			</span>
			<span class="flex min-w-0 flex-1 flex-col gap-px">
				<span class="truncate text-body/5.5 text-ink">{device.name}</span>
				<span class="truncate text-detail text-ink-2">{deviceSubtitle(device, when)}</span>
			</span>
			<button
				type="button"
				aria-label={strings.devices.revokeLabel.replaceAll('{name}', device.name)}
				class="inline-flex min-h-11 shrink-0 items-center rounded-sm px-2 text-label text-danger-ink outline-focus focus-visible:outline-2 active:bg-fill"
				onclick={() => {
					list.askRevoke(device)
				}}
			>
				{strings.devices.revoke}
			</button>
		</div>
	{/each}
</SettingsGroup>

<Button href="/settings/devices/new" variant="tonal" icon="plus" class="self-start">
	{strings.devices.add}
</Button>

<ConfirmDialog
	open={list.revoking !== null}
	title={strings.devices.revokeTitle.replaceAll('{name}', list.revoking?.name ?? '')}
	text={strings.devices.revokeText}
	confirmLabel={strings.devices.revoke}
	cancelLabel={strings.keys.cancel}
	busy={list.busy}
	onconfirm={async () => list.confirmRevoke()}
	oncancel={() => {
		list.cancelRevoke()
	}}
/>

<SettingsToast toast={toasts.current} />
