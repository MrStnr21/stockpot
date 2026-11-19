// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Records what the agent command sends, for the eval's `private` check: the eval puts this script in
 * front of the owner's template, so it receives the agent's arguments and the prompt on stdin. It
 * writes them, with the files the arguments name, to the capture folder, then runs the agent with the
 * same input. It stays in the agent's process group, so the engine's signals reach both.
 *
 *   bun record-agent.ts <capture folder> <agent command and arguments…>
 */
import { argv, file, spawn, stdin, write } from 'bun'
import { isAbsolute, join } from 'node:path'

const captureDir = argv.at(2)

const command = argv.slice(3)

if (captureDir === undefined || command.length === 0) {
	throw new Error('Usage: bun record-agent.ts <capture folder> <command…>')
}

const input = await stdin.text()

// The prompt and schema files, when the template passes them by path.
const files = await Promise.all(
	command
		.filter((arg) => isAbsolute(arg))
		.map(async (path) =>
			file(path)
				.text()
				.catch(() => null),
		),
)

await write(
	join(captureDir, `${crypto.randomUUID()}.json`),
	JSON.stringify({ args: command, stdin: input, files }),
)

const agent = spawn({
	cmd: command,
	stdin: new Blob([input]),
	stdout: 'inherit',
	stderr: 'inherit',
})

process.exit(await agent.exited)
