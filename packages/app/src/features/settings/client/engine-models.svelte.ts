// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { ModelsChange, PublicSettings, SettingsChange } from '../shared/types'
import { issueMessage } from './digest-view'
import type { KeyEngine } from './engine-key.svelte'
import type { SettingsApi } from './settings-api'
import { errorToast, type SettingsToasts } from './settings-toasts.svelte'

/** The fields of the models form: the OpenAI-compatible endpoint and a model per tier. */
export type ModelField = 'baseUrl' | 'fast' | 'standard' | 'deep'

export type ModelValues = Readonly<Record<ModelField, string>>

const tiers = ['fast', 'standard', 'deep'] as const

/** The form's values from the settings: a missing value is an empty field. */
export function modelValues(engine: KeyEngine, engines: PublicSettings['engines']): ModelValues {
	const { models } = engines[engine]
	const baseUrl = engine === 'openai-compatible' ? engines[engine].baseUrl : null

	return {
		baseUrl: baseUrl ?? '',
		fast: models.fast ?? '',
		standard: models.standard ?? '',
		deep: models.deep ?? '',
	}
}

/**
 * The fields a 400 names, each with its message: the server prefixes every issue with its path,
 * such as `engines.gemini.models.fast: …`.
 */
export function fieldIssues(
	engine: KeyEngine,
	issues: readonly string[] | undefined,
): Partial<Record<ModelField, string>> {
	const found: Partial<Record<ModelField, string>> = {}

	for (const issue of issues ?? []) {
		const path = issue.slice(0, Math.max(0, issue.indexOf(': ')))

		const field = (['baseUrl', ...tiers] as const).find(
			(name) => path === `engines.${engine}.${name}` || path === `engines.${engine}.models.${name}`,
		)

		if (field !== undefined && found[field] === undefined) {
			found[field] = issueMessage([issue]) ?? issue
		}
	}

	return found
}

/** The change one Save sends: only the fields that changed, an empty one as `null`. */
export function modelsChange(
	engine: KeyEngine,
	{ saved, values }: { readonly saved: ModelValues; readonly values: ModelValues },
): SettingsChange | null {
	const models: Record<string, string | null> = {}

	for (const tier of tiers) {
		const value = values[tier].trim()

		if (value !== saved[tier]) {
			models[tier] = value === '' ? null : value
		}
	}

	const hasModels = Object.keys(models).length > 0
	const modelChange: ModelsChange | undefined = hasModels ? models : undefined

	if (engine === 'gemini') {
		return modelChange === undefined ? null : { engines: { gemini: { models: modelChange } } }
	}

	const baseUrl = values.baseUrl.trim()
	const urlChanged = baseUrl !== saved.baseUrl

	if (!urlChanged && modelChange === undefined) {
		return null
	}

	return {
		engines: {
			'openai-compatible': {
				...(urlChanged && { baseUrl: baseUrl === '' ? null : baseUrl }),
				...(modelChange !== undefined && { models: modelChange }),
			},
		},
	}
}

export interface EngineModelsOptions {
	readonly engine: KeyEngine
	readonly initial: PublicSettings['engines']
	readonly api: Pick<SettingsApi, 'patchSettings'>
	readonly toasts: SettingsToasts
	readonly strings: { readonly saveFailed: string }
	/** Called with the settings after a save, such as to update the page. */
	readonly onsaved?: (settings: PublicSettings) => void
}

/** The models form (and the endpoint of the OpenAI-compatible engine), saved with one PATCH. */
export class EngineModels {
	public values: ModelValues

	public saving = $state(false)

	public errors = $state.raw<Partial<Record<ModelField, string>>>({})

	public saved: ModelValues

	readonly #options: EngineModelsOptions

	public constructor(options: EngineModelsOptions) {
		const initial = modelValues(options.engine, options.initial)

		this.values = $state(initial)
		this.saved = $state.raw(initial)
		this.#options = options
	}

	public get changed(): boolean {
		return modelsChange(this.#options.engine, { saved: this.saved, values: this.values }) !== null
	}

	public async save(): Promise<void> {
		const { engine, api, toasts, strings, onsaved } = this.#options
		const change = modelsChange(engine, { saved: this.saved, values: this.values })

		if (change === null || this.saving) {
			return
		}

		this.saving = true
		this.errors = {}

		const result = await api.patchSettings(change)

		this.saving = false

		if (result.ok) {
			this.saved = modelValues(engine, result.value.engines)
			this.values = { ...this.saved }
			onsaved?.(result.value)

			return
		}

		const errors = result.status === 400 ? fieldIssues(engine, result.issues) : {}

		if (Object.keys(errors).length > 0) {
			this.errors = errors
		} else if (result.status !== 401) {
			toasts.show(errorToast(strings.saveFailed))
		}
	}
}
