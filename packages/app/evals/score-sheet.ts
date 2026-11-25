// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The manual score sheet (evals/rubric.md): a row per card of a run, to score by hand.
 */
import * as v from 'valibot'

import type { JsonValue } from '#/server/engines/contract'

import { table, type CallRecord, type EvalReport } from './report'

const senseField = v.looseObject({ sense: v.optional(v.string(), '') })

function senseOf(answer: JsonValue | null): string {
	const result = v.safeParse(senseField, answer)

	return result.success ? result.output.sense : ''
}

const notApplicable = '—'

function levelOne(card: CallRecord | undefined): string {
	return card?.answer === null || card === undefined ? 'no answer' : senseOf(card.answer)
}

/**
 * The manual score sheet: a row per card, with the scores of evals/rubric.md left blank. A level-2
 * card follows its note's first card, and has no sense to judge, only whether it builds on level 1.
 */
export function renderScoreSheet(report: EvalReport): string {
	const cards = new Map(
		report.calls
			.filter(({ task }) => task !== 'suggest')
			.map((call) => [`${call.noteId} ${call.depth}`, call]),
	)

	const rows = report.notes.flatMap((note) => {
		const second = cards.get(`${note.id} 2`)

		return [
			[
				note.id,
				'1',
				note.source,
				note.text,
				note.format,
				levelOne(cards.get(`${note.id} 1`)),
				'',
				'',
				'',
				notApplicable,
				'',
			],
			...(second === undefined
				? []
				: [
						[
							note.id,
							'2',
							note.source,
							note.text,
							note.format,
							second.answer === null ? 'no answer' : notApplicable,
							'',
							'',
							notApplicable,
							'',
							'',
						],
					]),
		]
	})

	return [
		`# Score sheet: ${report.engine}, ${report.startedAt}`,
		'Score each card as evals/rubric.md says: Accurate and Clear from 1 to 5, Right sense yes or no. On a level-2 row, also Builds on, yes or no. The cards are in report.json.',
		table(
			[
				'Note',
				'Level',
				'Source',
				'Text',
				'Format',
				'Sense explained',
				'Accurate',
				'Clear',
				'Right sense',
				'Builds on',
				'Comment',
			],
			rows,
		),
		'',
	].join('\n\n')
}
