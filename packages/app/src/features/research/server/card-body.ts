// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Reads a stored card body back. A body is the engine's answer without `sources` and `uncertain`
 * (save.ts, depth-save.ts), so it is checked against its level's schema without those two fields.
 * Rows written by an older format or by hand may no longer fit; they read as `null`, never a throw.
 */
import * as v from 'valibot'

import type { Block } from '#/features/research/shared/blocks'
import { cardBlocks, type CardBody } from '#/features/research/shared/blocks-levels'
import { formats } from '#/features/research/shared/formats'
import type { FormatId } from '#/lib/format-ids'
import type { explanations } from '#/server/db/schema/explanations'
import type { Depth } from '#/server/engines/contract'

const stored = new Set(['sources', 'uncertain'])

const schemas = new Map<string, v.GenericSchema>()

/** The level's schema without the fields a stored body leaves out, built once per format and depth. */
function bodySchema(format: FormatId, depth: Depth): v.GenericSchema {
	const key = `${format}:${depth}`
	const known = schemas.get(key)

	if (known !== undefined) {
		return known
	}

	const { entries } = formats[format].levels[depth].schema

	const schema = v.strictObject(
		Object.fromEntries(Object.entries(entries).filter(([name]) => !stored.has(name))),
	)

	schemas.set(key, schema)

	return schema
}

/** A stored card: its body as the database holds it. */
export type StoredCard = Pick<typeof explanations.$inferSelect, 'body'>

/** The blocks of a stored card read as `format` at `depth`, or `null` when its body does not fit. */
export function readCardBody(format: FormatId, depth: Depth, card: StoredCard): Block[] | null {
	const parsed = v.safeParse(bodySchema(format, depth), card.body)

	if (!parsed.success) {
		return null
	}

	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SAFETY: the body passed this format and depth's own schema, less the two fields a stored body omits.
	const body = parsed.output as CardBody<typeof format, typeof depth>

	return cardBlocks(format, depth, body)
}
