// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The manual score sheet (evals/rubric.md): a row per card of a run, to score by hand.
 */
import * as v from 'valibot'

import type { JsonValue } from '#/server/engines/contract'

import { table, type EvalReport } from './report'

const senseField = v.looseObject({ sense: v.optional(v.string(), '') })

function senseOf(answer: JsonValue | null): string {
	const result = v.safeParse(senseField, answer)

	return result.success ? result.output.sense : ''
}

/** The manual score sheet: a row per card, with the scores of evals/rubric.md left blank. */
export function renderScoreSheet(report: EvalReport): string {
	const cards = new Map(
		report.calls.filter(({ task }) => task !== 'suggest').map((call) => [call.noteId, call]),
	)

	const rows = report.notes.map((note) => {
		const card = cards.get(note.id)

		const answered =
			card?.answer === null || card === undefined ? 'no answer' : senseOf(card.answer)

		return [note.id, note.source, note.text, note.format, answered, '', '', '', '']
	})

	return [
		`# Score sheet: ${report.engine}, ${report.startedAt}`,
		'Score each card as evals/rubric.md says: Accurate and Clear from 1 to 5, Right sense yes or no. The cards are in report.json.',
		table(
			[
				'Note',
				'Source',
				'Text',
				'Format',
				'Sense explained',
				'Accurate',
				'Clear',
				'Right sense',
				'Comment',
			],
			rows,
		),
		'',
	].join('\n\n')
}
