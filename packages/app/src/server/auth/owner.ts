// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { password } from 'bun'
import * as v from 'valibot'

import type { Db } from '#/server/db/client'
import { owner } from '#/server/db/schema/auth'

import type { Queryable } from './sessions'

/*
 * At least 12 characters: sign-in backoff slows guessing down but cannot stop it on an exposed
 * instance (D6). At most 1,000, so a client cannot make the server hash megabytes.
 */
export const passwordSchema = v.pipe(
	v.string(),
	v.minLength(12, 'Use at least 12 characters.'),
	v.maxLength(1000, 'Use at most 1,000 characters.'),
)

export function hasOwner(db: Pick<Db, 'select'>): boolean {
	return db.select({ id: owner.id }).from(owner).get() !== undefined
}

/** The password's argon2id hash, at the cost Bun picks by default. */
export async function hashPassword(plain: string): Promise<string> {
	return password.hash(plain, { algorithm: 'argon2id' })
}

/** Creates the owner unless one exists (D5); returns whether this call created it. */
export function insertOwner(db: Queryable, passwordHash: string): boolean {
	return db.insert(owner).values({ id: 1, passwordHash }).onConflictDoNothing().run().changes > 0
}

/** Whether the password is the owner's; `false` when there is no owner yet. */
export async function verifyPassword(db: Pick<Db, 'select'>, plain: string): Promise<boolean> {
	const row = db.select({ passwordHash: owner.passwordHash }).from(owner).get()

	return row !== undefined && password.verify(plain, row.passwordHash)
}

// Crockford's base32: no I, L, O or U, so a code read off a log cannot be mistyped as a lookalike.
const codeAlphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * A one-time setup code: 16 symbols of 5 random bits each (80 bits, far beyond guessing over HTTP),
 * shown in groups of four. 256 is a multiple of 32, so taking each byte modulo 32 keeps them uniform.
 */
export function createSetupCode(): string {
	const symbols = Array.from(
		crypto.getRandomValues(new Uint8Array(16)),
		(byte) => codeAlphabet[byte % codeAlphabet.length],
	).join('')

	return symbols.match(/.{4}/gu)?.join('-') ?? symbols
}

/** A code as typed, in any case and with or without spaces and dashes, in the form it is compared in. */
export function normalizeSetupCode(input: string): string {
	return input.toUpperCase().replaceAll(/[\s-]/gu, '')
}
