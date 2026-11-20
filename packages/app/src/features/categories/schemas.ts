// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import { categoryColors, categoryIcons } from '#/lib/category-look'
import { formatIds } from '#/lib/format-ids'

const fields = {
	name: v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(40)),
	icon: v.picklist(categoryIcons),
	color: v.picklist(categoryColors),
	format: v.picklist(formatIds),
	instructions: v.pipe(v.string(), v.trim(), v.maxLength(2000)),
}

export const newCategorySchema = v.strictObject({
	...fields,
	instructions: v.optional(fields.instructions, ''),
})

export const categoryChangeSchema = v.pipe(
	v.partial(v.strictObject(fields)),
	v.check((change) => Object.keys(change).length > 0, 'Change at least one category field.'),
)

const rowId = v.pipe(v.number(), v.safeInteger(), v.minValue(1))

export const categoryIdSchema = v.pipe(
	v.string(),
	v.regex(/^[1-9]\d*$/u, 'Use a positive integer.'),
	v.transform(Number),
	rowId,
)

export const categoryOrderSchema = v.strictObject({ ids: v.array(rowId) })

export type NewCategory = v.InferOutput<typeof newCategorySchema>

export type CategoryChange = v.InferOutput<typeof categoryChangeSchema>
