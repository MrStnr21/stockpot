// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import * as v from 'valibot'

import { engineIds, type EngineId } from '../shared/engines'
import type {
	CategoryFields,
	CategoryRecord,
	DeviceRow,
	EngineTestResult,
	PublicSettings,
	SettingsChange,
} from '../shared/types'

/**
 * How a request ended: its parsed answer, or the status and error code the server sent. A network
 * failure is status 0 with `network`, and an answer that does not parse keeps its status with
 * `unreadable`. `issues` comes with a 400, `retryAfter` (seconds) with a 429, and `notes` with the
 * 409 of a category that still has notes.
 */
export type ApiResult<T> =
	| { readonly ok: true; readonly value: T }
	| {
			readonly ok: false
			readonly status: number
			readonly code: string
			readonly issues?: readonly string[] | undefined
			readonly retryAfter?: number | undefined
			readonly notes?: number | undefined
	  }

export type ApiFailure = Extract<ApiResult<unknown>, { ok: false }>

export type SettingsFetch = (
	url: string,
	init: RequestInit & { readonly body?: string },
) => Promise<Response>

export interface SettingsApiOptions {
	readonly fetch?: SettingsFetch
	/** Called on a 401: the session ended, so the owner signs in again. */
	readonly signIn?: () => void
}

/** A device just created: the only answer that ever carries its token. */
export interface CreatedDevice {
	readonly device: DeviceRow
	readonly token: string
}

export interface SettingsApi {
	readonly patchSettings: (change: SettingsChange) => Promise<ApiResult<PublicSettings>>
	readonly testEngine: (id: EngineId) => Promise<ApiResult<EngineTestResult>>
	readonly listDevices: () => Promise<ApiResult<readonly DeviceRow[]>>
	readonly createDevice: (name: string) => Promise<ApiResult<CreatedDevice>>
	readonly revokeDevice: (id: number) => Promise<ApiResult<null>>
	readonly createCategory: (category: CategoryFields) => Promise<ApiResult<CategoryRecord>>
	readonly changeCategory: (
		id: number,
		change: Partial<CategoryFields>,
	) => Promise<ApiResult<CategoryRecord>>
	readonly deleteCategory: (id: number, moveTo?: number) => Promise<ApiResult<null>>
	readonly reorderCategories: (ids: readonly number[]) => Promise<ApiResult<null>>
	readonly setCategoryEngine: (id: number, engine: EngineId | null) => Promise<ApiResult<null>>
}

const rowId = v.pipe(v.number(), v.integer(), v.minValue(1))

const count = v.pipe(v.number(), v.integer(), v.minValue(0))

const isoDate = v.pipe(v.string(), v.isoTimestamp())

const secretState = v.picklist(['set', 'not set'])

const text = v.string()

const nullableText = v.nullable(text)

const nullableCount = v.nullable(count)

const models = v.object({ fast: nullableText, standard: nullableText, deep: nullableText })

const limit = v.object({ perMinute: nullableCount, perDay: nullableCount })

const limits = v.object({ fast: limit, standard: limit, deep: limit })

const engineId = v.picklist(engineIds)

const route = v.object({ engine: engineId, tier: v.picklist(['fast', 'standard', 'deep']) })

const engines = v.object({
	'agent-command': v.object({ command: secretState }),
	gemini: v.object({ apiKey: secretState, models, limits }),
	'openai-compatible': v.object({ baseUrl: nullableText, apiKey: secretState, models }),
})

export const publicSettingsSchema = v.object({
	digest: v.object({ time: text, batchTime: text, limit: count, timeZone: text }),
	cardLanguage: text,
	engines,
	routing: v.object({ categories: v.record(text, route), fallbackOrder: v.array(engineId) }),
}) satisfies v.GenericSchema<unknown, PublicSettings>

const tested = { engine: engineId, testedAt: isoDate }

export const testResultSchema = v.variant('outcome', [
	v.object({
		...tested,
		outcome: v.literal('ok'),
		elapsedMs: count,
		model: nullableText,
	}),
	v.object({ ...tested, outcome: v.literal('rate_limited'), resetsAt: isoDate }),
	v.object({ ...tested, outcome: v.picklist(['auth', 'timeout', 'invalid', 'error']) }),
]) satisfies v.GenericSchema<unknown, EngineTestResult>

export const deviceSchema = v.object({
	id: rowId,
	name: v.string(),
	hint: v.string(),
	createdAt: isoDate,
	lastUsedAt: v.nullable(isoDate),
}) satisfies v.GenericSchema<unknown, DeviceRow>

const devicesSchema = v.pipe(
	v.object({ devices: v.array(deviceSchema) }),
	v.transform(({ devices }) => devices),
)

const createdDeviceSchema = v.object({ device: deviceSchema, token: v.string() })

export const categoryRecordSchema = v.object({
	id: rowId,
	name: v.string(),
	icon: v.string(),
	color: v.string(),
	format: v.string(),
	instructions: v.string(),
	position: v.pipe(v.number(), v.integer()),
}) satisfies v.GenericSchema<unknown, CategoryRecord>

const issues = v.optional(v.array(text))

const errorSchema = v.object({
	error: v.object({ code: text, issues, notes: v.optional(count) }),
})

const noContent = v.null()

// Stands for a body that is not JSON, which no schema accepts.
const unreadable = Symbol('unreadable')

function signInAgain() {
	location.assign('/signin')
}

async function failureOf(response: Response): Promise<ApiFailure> {
	const retry = Number(response.headers.get('retry-after') ?? Number.NaN)
	const retryAfter = Number.isInteger(retry) && retry >= 0 ? retry : undefined
	const body = v.safeParse(errorSchema, await response.json().catch(() => null))

	if (!body.success) {
		return { ok: false, status: response.status, code: 'unreadable', retryAfter }
	}

	const { code, issues: found, notes } = body.output.error

	return { ok: false, status: response.status, code, issues: found, notes, retryAfter }
}

type RequestBody =
	| SettingsChange
	| Partial<CategoryFields>
	| { readonly name: string }
	| { readonly ids: readonly number[] }
	| { readonly engine: EngineId | null }

function jsonInit(
	method: 'PATCH' | 'POST' | 'PUT',
	body: RequestBody,
): RequestInit & { body: string } {
	return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

/** The settings pages' requests, each answer parsed before a page reads it. */
export function createSettingsApi({
	fetch = async (url, init) => globalThis.fetch(url, init),
	signIn = signInAgain,
}: SettingsApiOptions = {}): SettingsApi {
	async function request<T>(
		url: string,
		init: RequestInit & { readonly body?: string },
		schema: v.GenericSchema<unknown, T>,
	): Promise<ApiResult<T>> {
		let response: Response

		try {
			response = await fetch(url, init)
		} catch {
			return { ok: false, status: 0, code: 'network' }
		}

		if (response.status === 401) {
			signIn()

			return { ok: false, status: 401, code: 'unauthorized' }
		}

		if (!response.ok) {
			return failureOf(response)
		}

		const answer: unknown =
			response.status === 204 ? null : await response.json().catch(() => unreadable)

		const parsed = v.safeParse(schema, answer)

		return parsed.success
			? { ok: true, value: parsed.output }
			: { ok: false, status: response.status, code: 'unreadable' }
	}

	return {
		patchSettings: async (change) =>
			request('/api/settings', jsonInit('PATCH', change), publicSettingsSchema),
		testEngine: async (id) =>
			request(`/api/engines/${id}/test`, { method: 'POST' }, testResultSchema),
		listDevices: async () => request('/api/devices', { method: 'GET' }, devicesSchema),
		createDevice: async (name) =>
			request('/api/devices', jsonInit('POST', { name }), createdDeviceSchema),
		revokeDevice: async (id) => request(`/api/devices/${id}`, { method: 'DELETE' }, noContent),
		createCategory: async (category) =>
			request('/api/categories', jsonInit('POST', category), categoryRecordSchema),
		changeCategory: async (id, change) =>
			request(`/api/categories/${id}`, jsonInit('PATCH', change), categoryRecordSchema),
		deleteCategory: async (id, moveTo) =>
			request(
				moveTo === undefined ? `/api/categories/${id}` : `/api/categories/${id}?moveTo=${moveTo}`,
				{ method: 'DELETE' },
				noContent,
			),
		reorderCategories: async (ids) =>
			request('/api/categories/order', jsonInit('PUT', { ids }), noContent),
		setCategoryEngine: async (id, engine) =>
			request(`/api/categories/${id}/engine`, jsonInit('PUT', { engine }), noContent),
	}
}
