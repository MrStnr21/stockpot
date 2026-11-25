// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { toJsonSchema } from '@valibot/to-json-schema'
import { cardInputFactory } from '#tests/factories/engine-input'
import { configuredSettingsFactory } from '#tests/factories/settings'
import { createTestDb } from '#tests/setup/db'
import * as v from 'valibot'

import {
	parseOutput,
	type EngineInput,
	type OutputFormat,
	type Redacted,
	type ResearchProgress,
	type RunOptions,
} from './contract'
import { createRouter, type Router } from './router'
import { defaultRouting, type EngineId } from './settings'

const { db } = await createTestDb()

const schema = v.strictObject({ summary: v.string() })

const output: OutputFormat<typeof schema> = {
	id: 'report',
	instructions: 'Research the idea.',
	schema,
	jsonSchema: toJsonSchema(schema),
}

const input = { ...cardInputFactory.build(), task: 'research', output } as const

const { engines } = configuredSettingsFactory.build()

describe('router progress', () => {
	let received: RunOptions[]
	let router: Router

	beforeEach(() => {
		received = []

		async function research<TSchema extends v.GenericSchema>(
			_input: Redacted<EngineInput & { readonly output: OutputFormat<TSchema> }>,
			options: RunOptions,
		) {
			received.push(options)

			return {
				output: parseOutput(output, { summary: 'An idea.' }),
				engine: 'gemini' as const satisfies EngineId,
				model: null,
				searchSuggestions: null,
				elapsedMs: 0,
			}
		}

		const gemini = { id: 'gemini' as const, suggest: research, explain: research, research }

		router = createRouter({
			db,
			settings: () => ({ engines, routing: defaultRouting() }),
			agentCommand: null,
			build: () => ({ 'agent-command': null, gemini, 'openai-compatible': gemini }),
		})
	})

	it("hands a research call's onProgress to the engine", async () => {
		const onProgress = mock<(progress: ResearchProgress) => void>()

		await router.research(input, { categoryId: 1, onProgress })
		received[0]?.onProgress?.({ step: 'planning', questions: 0, searched: 0, pages: 0 })

		expect(received[0]?.onProgress).toBe(onProgress)
		expect(onProgress).toHaveBeenCalledWith({
			step: 'planning',
			questions: 0,
			searched: 0,
			pages: 0,
		})
	})

	it('passes undefined when the call has none', async () => {
		await router.research(input, { categoryId: 1 })

		expect(received[0]?.onProgress).toBeUndefined()
	})
})
