// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type * as v from 'valibot'

import type { Depth, OutputFormat } from '#/server/engines/contract'

import { brief } from './brief'
import type { Format } from './common'
import { comparison } from './comparison'
import { concept } from './concept'
import { deriveJsonSchema } from './json-schema'
import { report } from './report'
import { technology } from './technology'
import { vocabulary } from './vocabulary'

export { sourceSchema, type Format, type Level, type Source } from './common'

export { suggestionFormat, type Suggestion } from './suggestion'

/** Format ids are stored with each category, so renaming one needs a migration. */
export const formatIds = [
	'vocabulary',
	'technology',
	'comparison',
	'concept',
	'report',
	'brief',
] as const

export type FormatId = (typeof formatIds)[number]

export const depths = [1, 2, 3] as const satisfies readonly Depth[]

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

export function isFormatId(value: string): value is FormatId {
	return Object.hasOwn(formats, value)
}

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
