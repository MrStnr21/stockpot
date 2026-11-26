// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * A stand-in for the agent command in end-to-end tests: it reads the prompt on stdin and suggests
 * Technology for every note. Any other task fails, so a spec never waits on a card from it.
 */
import { stdin, stdout, write } from 'bun'

const prompt = await stdin.text()

const technology = /^- (?<id>\d+): Technology(?:,|$)/mu.exec(prompt)?.groups?.id

if (!prompt.includes('Suggest categories') || technology === undefined) {
	// The engine reads an uncaught error's exit status 1 as a failed run.
	throw new Error('The fake agent only suggests categories, and needs a Technology category.')
}

const answer = { categories: [technology], senses: [], language: 'en' }

await write(stdout, JSON.stringify({ structured_output: answer }))
