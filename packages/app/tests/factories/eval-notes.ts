// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Notes for the eval runner's own specs. They are not the eval set: the real notes come from the owner
 * and live in evals/notes.jsonl and each owner's evals/local/.
 */
import { faker } from '@faker-js/faker'
import { Factory } from 'fishery'

import type { EvalNote } from '../../evals/notes'

export const evalNoteFactory = Factory.define<EvalNote>(({ sequence }) => ({
	id: `note-${sequence}`,
	text: faker.word.noun(),
	context: null,
	url: null,
	private: false,
	language: 'en',
	source: 'composed',
	expected: { format: 'technology', alsoAccept: [], senses: [], uncertain: false },
	tests: faker.lorem.sentence(),
}))

/** A private note with its own context, which must stay on the instance. */
export const privateEvalNoteFactory = Factory.define<EvalNote>(() => ({
	...evalNoteFactory.build(),
	private: true,
	context: faker.lorem.sentence(),
}))

/** A note composed to be unknowable: its card must be uncertain. */
export const unknowableEvalNoteFactory = evalNoteFactory.params({
	expected: { format: 'brief', alsoAccept: [], senses: [], uncertain: true },
})
