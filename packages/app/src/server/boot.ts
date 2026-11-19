// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The one module that runs when the built server starts, before it takes a request: the `boot`
 * integration in astro.config.ts imports it from the Node adapter's server entry. Astro loads the
 * middleware and pages only on the first request, so anything that must happen at startup goes here.
 * Today that is validating the environment, which stops the process when it is invalid. Later stories
 * add their startup here; the job runner's `startRunner()` (SRV-6) is the first.
 */
import '#/server/config'
