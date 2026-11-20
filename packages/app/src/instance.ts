// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { createSuggester, type Suggester } from '#/features/capture/server/suggest'
import { readSettings } from '#/features/settings/server'
import { config } from '#/server/config'
import { instanceDb } from '#/server/db/instance'
import { createRouter, type Router } from '#/server/engines/router'

/*
 * The process's shared services that are built from features: the router reads the settings feature,
 * the suggester belongs to capture. server/ may not import features, so they live in this entry
 * module, opened on first use like the database. One router keeps each engine and Gemini's usage
 * counters once per process; one suggester keeps one cache.
 */

interface ProcessServices {
	router?: Promise<Router>
	suggester?: Promise<Suggester>
}

const thisProcess: ProcessServices = {}

export async function instanceRouter(): Promise<Router> {
	thisProcess.router ??= instanceDb().then((db) =>
		createRouter({
			db,
			settings: () => {
				const { engines, routing } = readSettings(db)

				return { engines, routing }
			},
			agentCommand: config.agentCommand,
		}),
	)

	return thisProcess.router
}

export async function instanceSuggester(): Promise<Suggester> {
	thisProcess.suggester ??= instanceRouter().then((router) => createSuggester({ router }))

	return thisProcess.suggester
}
