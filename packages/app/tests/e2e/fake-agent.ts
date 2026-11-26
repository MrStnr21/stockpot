// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * A stand-in for the agent command in end-to-end tests: it reads the prompt on stdin and suggests
 * Technology for every note. Any other task fails, so a spec never waits on a card from it; with
 * `--hold` any other task never answers instead, so the job it runs keeps the job runner busy until
 * the server stops it.
 */
import { argv, stdin, stdout, write } from 'bun'

const prompt = await stdin.text()

const technology = /^- (?<id>\d+): Technology(?:,|$)/mu.exec(prompt)?.groups?.id

const isSuggestion = prompt.includes('Suggest categories')

if (!isSuggestion && argv.includes('--hold')) {
	// The server's stop interrupts the process group, which ends this timer with the process.
	setInterval(() => {
		// Nothing to do: the timer only keeps the process alive.
	}, 60_000)
} else {
	if (!isSuggestion || technology === undefined) {
		// The engine reads an uncaught error's exit status 1 as a failed run.
		throw new Error('The fake agent only suggests categories, and needs a Technology category.')
	}

	const answer = { categories: [technology], senses: [], language: 'en' }

	await write(stdout, JSON.stringify({ structured_output: answer }))
}
