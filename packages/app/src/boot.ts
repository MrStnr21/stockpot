// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The one module that runs when the built server starts, before it takes a request: the `boot`
 * integration in astro.config.ts imports it from the Node adapter's server entry. Astro loads the
 * middleware and pages only on the first request, so anything that must happen at startup goes here.
 */
import { readBatchTime, readTimeZone } from '#/features/settings/server'
import { instanceBatchJob, instanceResearchJob } from '#/instance'
import { instanceAuth } from '#/server/auth'
import { instanceDb } from '#/server/db/instance'
import { startRunner, stopRunner } from '#/server/jobs/runner'
import { log } from '#/server/log'

/* Validates the environment (importing auth loads the config, which stops the process when it is
 * invalid), opens the database, so a failed migration stops the server too, and prints the setup
 * code while the instance has no owner. */
const auth = await instanceAuth()

auth.needsSetup()

const db = await instanceDb()

// An entry module, so it may hand the runner the features' jobs; server/ may not import them.
await startRunner({
	db,
	jobs: [await instanceResearchJob()],
	schedules: [{ job: await instanceBatchJob(), at: () => readBatchTime(db) }],
	timeZone: () => readTimeZone(db),
})

/* The Node adapter installs no signal handlers, so without these a stop would end the process with
 * a job in hand. The job is requeued on the next start either way; stopping first lets it finish. */
function exit(code: number) {
	// oxlint-disable-next-line no-undef -- process is a Bun global; docs/guidelines/runtime.md allows process.exit.
	process.exit(code)
}

function shutDown(signal: NodeJS.Signals) {
	log.info(`Received ${signal}, stopping the job runner`)
	stopRunner().then(
		() => {
			exit(0)
		},
		() => {
			exit(1)
		},
	)
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
	// oxlint-disable-next-line no-undef -- process is a Bun global; docs/guidelines/runtime.md allows process.once for shutdown signals.
	process.once(signal, shutDown)
}
