// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { FormatId } from '#/lib/format-ids'
import type { SuggestCategory } from '#/server/engines/contract'

/** The built-in categories (docs/engines.md, "Formats"); each id is its format id. */
export const builtInCategories = [
	{
		id: 'vocabulary',
		name: 'English',
		hint: 'A word or phrase in a language the owner is learning',
	},
	{ id: 'technology', name: 'Technology', hint: 'A technology or technical term' },
	{
		id: 'comparison',
		name: 'AI',
		hint: 'A product or model in a crowded field, against its alternatives',
	},
	{ id: 'concept', name: 'Concept', hint: 'An idea from any field: a principle, a pattern, a law' },
	{ id: 'report', name: 'Idea', hint: 'An idea the owner might build' },
	{ id: 'brief', name: 'Other', hint: 'Anything else: a short explanation with links' },
] as const satisfies readonly (SuggestCategory & { readonly id: FormatId })[]
