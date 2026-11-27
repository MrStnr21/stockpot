// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { readSettings } from '#/features/settings/server'
import { config } from '#/server/config'
import type { Db } from '#/server/db/client'
import { instanceDb } from '#/server/db/instance'
import { createEngineTester, type EngineTester } from '#/server/engines/probe'
import {
	createEngines,
	createRouter,
	type EngineSet,
	type Router,
	type RouterSettings,
} from '#/server/engines/router'

/*
 * The process's engines, built once from the settings feature and shared by the router and the
 * settings "Test" button: Gemini counts its requests inside its engine, so a test call and real
 * work must go through the same one for its limits to hold.
 */

interface SharedEngines {
	readonly db: Db
	readonly settings: () => RouterSettings
	readonly engines: EngineSet
}

interface EngineServices {
	shared?: Promise<SharedEngines>
	router?: Promise<Router>
	tester?: Promise<EngineTester>
}

const thisProcess: EngineServices = {}

async function sharedEngines(): Promise<SharedEngines> {
	thisProcess.shared ??= instanceDb().then((db) => {
		function settings() {
			const { engines, routing } = readSettings(db)

			return { engines, routing }
		}

		const engines = createEngines({ db, settings, agentCommand: config.agentCommand })

		return { db, settings, engines }
	})

	return thisProcess.shared
}

/** The engines of the process, each built once. */
export async function instanceEngineSet(): Promise<EngineSet> {
	const { engines } = await sharedEngines()

	return engines
}

export async function instanceRouter(): Promise<Router> {
	thisProcess.router ??= sharedEngines().then(({ db, settings, engines }) =>
		createRouter({ db, settings, agentCommand: config.agentCommand, build: () => engines }),
	)

	return thisProcess.router
}

/** The one engine tester of the process, so its guard holds across requests. */
export async function instanceEngineTester(): Promise<EngineTester> {
	thisProcess.tester ??= sharedEngines().then(({ settings, engines }) =>
		createEngineTester({ engines, settings, agentCommand: config.agentCommand }),
	)

	return thisProcess.tester
}
