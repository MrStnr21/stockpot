// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The one module that runs when the built server starts, before it takes a request: the `boot`
 * integration in astro.config.ts imports it from the Node adapter's server entry. Astro loads the
 * middleware and pages only on the first request, so anything that must happen at startup goes here.
 * Later stories add their startup here; the job runner's `startRunner()` (SRV-6) is the first.
 */
import { instanceAuth } from '#/server/auth'

/* Validates the environment (importing auth loads the config, which stops the process when it is
 * invalid), opens the database, so a failed migration stops the server too, and prints the setup
 * code while the instance has no owner. */
const auth = await instanceAuth()

auth.needsSetup()
