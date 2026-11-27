// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { SettingsMessages } from '#/lib/i18n/settings-en'

import type { DeviceRow } from '../shared/types'
import { issueMessage } from './digest-view'
import type { SettingsApi } from './settings-api'
import { errorToast, type SettingsToasts } from './settings-toasts.svelte'
import { formatWhen, type WhenOptions } from './when'

/** A device row's tile: a laptop for a Mac, else a phone. Only the icon; devices carry no kind. */
export function deviceIcon(name: string): 'laptop' | 'phone' {
	return /mac/iu.test(name) ? 'laptop' : 'phone'
}

/** "Last used {when} · {hint}", or "Never used · {hint}". */
export function deviceSubtitle(
	{ lastUsedAt, hint }: Pick<DeviceRow, 'lastUsedAt' | 'hint'>,
	{
		strings,
		...when
	}: Omit<WhenOptions, 'strings'> & {
		readonly strings: Pick<SettingsMessages, 'devices' | 'when'>
	},
): string {
	if (lastUsedAt === null) {
		return strings.devices.neverUsed.replaceAll('{hint}', hint)
	}

	return strings.devices.lastUsed
		.replaceAll('{when}', formatWhen(lastUsedAt, { ...when, strings: strings.when }))
		.replaceAll('{hint}', hint)
}

export interface DevicesListOptions {
	readonly initial: readonly DeviceRow[]
	readonly api: Pick<SettingsApi, 'revokeDevice'>
	readonly toasts: SettingsToasts
	readonly strings: { readonly revokeFailed: string }
}

/*
 * Revoking a device cannot lock the owner out: the web uses its session, never a device token, and
 * every device route refuses tokens (403), so no revoke reaches the session.
 */

/** The devices list: a revoke asks first, then the row goes. */
export class DevicesList {
	public devices: readonly DeviceRow[]

	/** The device the confirm dialog asks about. */
	public revoking = $state.raw<DeviceRow | null>(null)

	public busy = $state(false)

	readonly #options: DevicesListOptions

	public constructor(options: DevicesListOptions) {
		this.devices = $state.raw(options.initial)
		this.#options = options
	}

	public askRevoke(device: DeviceRow): void {
		this.revoking = device
	}

	public cancelRevoke(): void {
		if (!this.busy) {
			this.revoking = null
		}
	}

	public async confirmRevoke(): Promise<void> {
		const device = this.revoking

		if (device === null || this.busy) {
			return
		}

		this.busy = true

		const result = await this.#options.api.revokeDevice(device.id)

		this.busy = false
		this.revoking = null

		// A 404 means it is gone already, which is what the owner asked for.
		if (result.ok || result.status === 404) {
			this.devices = this.devices.filter(({ id }) => id !== device.id)
		} else if (result.status !== 401) {
			this.#options.toasts.show(errorToast(this.#options.strings.revokeFailed))
		}
	}
}

export interface NewDeviceOptions {
	readonly api: Pick<SettingsApi, 'createDevice'>
	readonly toasts: SettingsToasts
	readonly strings: { readonly saveFailed: string; readonly copyFailed: string }
}

/**
 * Adding a device: its token is shown once. The token lives only here, never in a URL, storage, a
 * toast or the log, and `done` drops it.
 */
export class NewDevice {
	public name = $state('')

	public creating = $state(false)

	public error = $state<string | null>(null)

	public token = $state<string | null>(null)

	public copied = $state(false)

	readonly #options: NewDeviceOptions

	public constructor(options: NewDeviceOptions) {
		this.#options = options
	}

	public get canCreate(): boolean {
		return this.name.trim() !== '' && !this.creating && this.token === null
	}

	public async create(): Promise<void> {
		if (!this.canCreate) {
			return
		}

		this.creating = true
		this.error = null

		const result = await this.#options.api.createDevice(this.name.trim())

		this.creating = false

		if (result.ok) {
			this.token = result.value.token

			return
		}

		if (result.status === 400) {
			this.error = issueMessage(result.issues) ?? this.#options.strings.saveFailed
		} else if (result.status !== 401) {
			this.#options.toasts.show(errorToast(this.#options.strings.saveFailed))
		}
	}

	/** Copies the token; a refused clipboard says so without the token. */
	public async copy(clipboard: Pick<Clipboard, 'writeText'>): Promise<void> {
		if (this.token === null) {
			return
		}

		try {
			await clipboard.writeText(this.token)
			this.copied = true
		} catch {
			this.#options.toasts.show(errorToast(this.#options.strings.copyFailed))
		}
	}

	/** Forgets the token: the device has it now, and the server keeps only its hash. */
	public done(): void {
		this.token = null
		this.copied = false
		this.name = ''
	}
}
