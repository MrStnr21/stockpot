// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Device tokens (D5): every client other than the web app, such as a Shortcut, an MCP client or the
 * iOS app, signs in with a named token of its own, sent as `Authorization: Bearer <token>`. Only the
 * token's hash is stored, so the token is shown once, in the answer that creates it. Revoking a device
 * deletes its row, and its token stops working on the next request.
 */
import { desc, eq } from 'drizzle-orm'
import * as v from 'valibot'

import { devices, owner } from '#/server/db/schema/auth'
import type { Owner } from '#/server/policy'

import type { Queryable } from './sessions'
import { hashToken, randomToken } from './tokens'

/* `sp1_`, for stockpot device tokens of the first format, lets people and secret scanners recognise a
 * token pasted into a log or an issue. After it come the 43 characters of randomToken(). */
export const deviceTokenPrefix = 'sp1_'

const deviceTokenPattern = /^sp1_[\w-]{43}$/u

/** A busy device writes its last-used time once a minute, not on every request. */
export const lastUsedInterval = 60 * 1000

// Four of 43 random characters: enough to tell tokens apart, 24 of their 256 bits.
const hintLength = 4

export const newDeviceSchema = v.object({
	name: v.pipe(
		v.string(),
		v.trim(),
		v.nonEmpty('Name the device, such as "iPhone Shortcut".'),
		v.maxLength(100, 'Use at most 100 characters.'),
	),
})

/** A device as the owner sees it: never with its token or the token's hash. */
export interface Device {
	readonly id: number
	readonly name: string
	/** The token's prefix and last characters, such as `sp1_…x7Qa`, to match a device to its token. */
	readonly hint: string
	readonly createdAt: Date
	/** `null` until the token is first used; it moves at most once a minute. */
	readonly lastUsedAt: Date | null
}

export interface CreatedDevice {
	readonly device: Device
	/** The token, returned this once and never again. */
	readonly token: string
}

const deviceColumns = {
	id: devices.id,
	name: devices.name,
	hint: devices.tokenHint,
	createdAt: devices.createdAt,
	lastUsedAt: devices.lastUsedAt,
}

function maskToken(token: string) {
	return `${deviceTokenPrefix}…${token.slice(-hintLength)}`
}

/** Creates a device with a new token. */
export function createDevice(db: Queryable, name: string, now = new Date()): CreatedDevice {
	const token = `${deviceTokenPrefix}${randomToken()}`

	const device = db
		.insert(devices)
		.values({ name, tokenHash: hashToken(token), tokenHint: maskToken(token), createdAt: now })
		.returning(deviceColumns)
		.get()

	return { device, token }
}

/** Every device, newest first. */
export function listDevices(db: Queryable): Device[] {
	return db
		.select(deviceColumns)
		.from(devices)
		.orderBy(desc(devices.createdAt), desc(devices.id))
		.all()
}

/** Deletes a device, so its token signs nobody in; returns whether the device existed. */
export function revokeDevice(db: Queryable, id: number): boolean {
	return db.delete(devices).where(eq(devices.id, id)).run().changes > 0
}

const bearerPattern = /^Bearer +(?<token>\S+) *$/iu

/**
 * The device token a request presents: `undefined` when it presents none, and `null` when its bearer
 * token starts with the device prefix but is not shaped like a device token. A bearer token without
 * the prefix is someone else's, such as the metrics token or one a proxy in front of stockpot adds,
 * and does not count as a device token at all.
 */
export function presentedDeviceToken(request: Request): string | null | undefined {
	const token = bearerPattern.exec(request.headers.get('authorization') ?? '')?.groups?.token

	if (token === undefined || !token.startsWith(deviceTokenPrefix)) {
		return undefined
	}

	return deviceTokenPattern.test(token) ? token : null
}

/**
 * The owner a device token signs in, or `null` for a token that is unknown or revoked. The device's
 * last-used time moves when it is at least a minute old.
 */
export function resolveDevice(db: Queryable, token: string, now = new Date()): Owner | null {
	// Joined with the owner, so devices left over from a deleted owner sign nobody in.
	const device = db
		.select({ id: devices.id, ownerId: owner.id, lastUsedAt: devices.lastUsedAt })
		.from(devices)
		.crossJoin(owner)
		.where(eq(devices.tokenHash, hashToken(token)))
		.get()

	if (device === undefined) {
		return null
	}

	if (
		device.lastUsedAt === null ||
		now.getTime() - device.lastUsedAt.getTime() >= lastUsedInterval
	) {
		db.update(devices).set({ lastUsedAt: now }).where(eq(devices.id, device.id)).run()
	}

	return { id: device.ownerId, via: 'device' }
}
