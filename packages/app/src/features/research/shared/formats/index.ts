// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type * as v from 'valibot'

import type { FormatId } from '#/lib/format-ids'
import { deriveJsonSchema } from '#/lib/json-schema'
import type { Depth, OutputFormat } from '#/server/engines/contract'

import { brief } from './brief'
import type { Format } from './common'
import { comparison } from './comparison'
import { concept } from './concept'
import { report } from './report'
import { technology } from './technology'
import { vocabulary } from './vocabulary'

export { earlierCard, sourceSchema, type Format, type Level, type Source } from './common'

export const depths = [1, 2, 3] as const satisfies readonly Depth[]

/** The schemas behind each format id in `#/lib/format-ids`. */
export const formats = {
	vocabulary,
	technology,
	comparison,
	concept,
	report,
	brief,
} as const satisfies Record<FormatId, Format>

export type CardSchema<
	F extends FormatId,
	D extends Depth,
> = (typeof formats)[F]['levels'][D]['schema']

/** A card as an engine returns it, in format `F` at depth `D`. */
export type Card<F extends FormatId, D extends Depth> = v.InferOutput<CardSchema<F, D>>

/** What the research feature hands an engine for a card in format `id` at `depth`. */
export function cardFormat<F extends FormatId, D extends Depth>(
	id: F,
	depth: D,
): OutputFormat<CardSchema<F, D>> {
	const format: Format = formats[id]
	const level = formats[id].levels[depth]

	return {
		id,
		instructions: `${format.instructions}\n\n${level.instructions}`,
		schema: level.schema,
		jsonSchema: deriveJsonSchema(level.schema),
	}
}
