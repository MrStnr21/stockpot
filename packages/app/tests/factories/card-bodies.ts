// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Card bodies as the database stores them: a sample card that passed its level's real schema, less
 * the `sources` and `uncertain` fields save.ts keeps in columns of their own.
 */
import { cardFactories } from '#tests/factories/cards'
import * as v from 'valibot'

import { formats } from '#/features/research/shared/formats'
import type { FormatId } from '#/lib/format-ids'
import type { Depth, JsonValue } from '#/server/engines/contract'

/** A card body as JSON, the way the `body` column holds it. */
export type StoredBodyJson = Readonly<Record<string, JsonValue>>

const columns = new Set(['sources', 'uncertain'])

/** A stored body in `format` at `depth`; `changes` replace fields of the sample before the check. */
export function storedBody(
	format: FormatId,
	depth: Depth,
	changes: StoredBodyJson = {},
): StoredBodyJson {
	const { schema } = formats[format].levels[depth]
	const sample = { ...cardFactories[format][depth].build(), ...changes }

	// Some samples carry `uncertain` where their level has none; keep only the fields the level has.
	const card = Object.fromEntries(Object.entries(sample).filter(([key]) => key in schema.entries))
	const parsed = v.parse(schema, card)

	return Object.fromEntries(Object.entries(parsed).filter(([key]) => !columns.has(key)))
}
