// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { CategoryColor, IconName } from '@stockpot/ui/icon'

import type { FormatId } from '#/lib/format-ids'

import type { EngineId } from '../shared/engines'
import type { CategoryFields } from '../shared/types'
import type { ApiFailure, SettingsApi } from './settings-api'
import { errorToast, type SettingsToasts } from './settings-toasts.svelte'

/** What the editor changes: the category's fields and the engine that writes its cards. */
export interface CategoryDraft {
	readonly name: string
	readonly icon: IconName
	readonly color: CategoryColor
	readonly format: FormatId
	readonly instructions: string
	/** `null` routes the category the default way. */
	readonly engine: EngineId | null
}

/** A new category starts as Other, in the Brief format: "anything else". */
export const newCategoryDraft: CategoryDraft = {
	name: '',
	icon: 'other',
	color: 'other',
	format: 'brief',
	instructions: '',
	engine: null,
}

export const maxNameLength = 40

export const maxInstructionsLength = 2000

export interface CategoryEditorStrings {
	readonly nameTaken: string
	readonly saveFailed: string
	readonly deleteFailed: string
}

export interface CategoryEditorOptions {
	/** The category's id, or `null` for a new one. */
	readonly id: number | null
	readonly initial: CategoryDraft
	/** Its notes, which a delete asks to move. */
	readonly noteCount: number
	/** The categories its notes may move to, in list order. */
	readonly others: readonly { readonly id: number; readonly name: string }[]
	readonly api: Pick<
		SettingsApi,
		'createCategory' | 'changeCategory' | 'setCategoryEngine' | 'deleteCategory'
	>
	readonly toasts: SettingsToasts
	readonly strings: CategoryEditorStrings
	/** Leaves for the list once a save or a delete is done. */
	readonly done: () => void
}

/** The delete question on screen: how many notes move, and where to. */
export interface DeleteQuestion {
	readonly notes: number
	readonly moveTo: number | null
}

type FieldKey = Exclude<keyof CategoryDraft, 'engine'>

const fieldKeys = [
	'name',
	'icon',
	'color',
	'format',
	'instructions',
] as const satisfies readonly FieldKey[]

function trimmed(draft: CategoryDraft): CategoryDraft {
	return { ...draft, name: draft.name.trim(), instructions: draft.instructions.trim() }
}

/**
 * The category editor: Save sends only the fields that changed, then the engine when it changed, and
 * goes back to the list. A name another category has shows under Name; any other failure keeps the
 * form and shows a toast. Delete asks first, and where the notes go when there are any.
 */
export class CategoryEditor {
	public draft: CategoryDraft

	public nameError: string | null

	public busy: boolean

	public question: DeleteQuestion | null

	#id: number | null

	/** The category as the server has it, so a retry after a partial save sends only the rest. */
	#saved: CategoryDraft

	readonly #options: CategoryEditorOptions

	public constructor(options: CategoryEditorOptions) {
		this.draft = $state.raw(options.initial)
		this.nameError = $state.raw(null)
		this.busy = $state.raw(false)
		this.question = $state.raw(null)
		this.#id = options.id
		this.#saved = options.initial
		this.#options = options
	}

	public get isNew(): boolean {
		return this.#id === null
	}

	/** Whether Save does anything: a change, and a name. */
	public get canSave(): boolean {
		const draft = trimmed(this.draft)

		const changed =
			fieldKeys.some((key) => draft[key] !== this.#saved[key]) ||
			draft.engine !== this.#saved.engine

		return changed && draft.name !== '' && !this.busy
	}

	public set<Key extends keyof CategoryDraft>(key: Key, value: CategoryDraft[Key]): void {
		this.draft = { ...this.draft, [key]: value }

		if (key === 'name') {
			this.nameError = null
		}
	}

	public async save(): Promise<void> {
		if (!this.canSave) {
			return
		}

		this.busy = true

		try {
			if ((await this.#saveFields()) && (await this.#saveEngine())) {
				this.#options.done()
			}
		} finally {
			this.busy = false
		}
	}

	/** Opens the delete question, with the first other category as the notes' target. */
	public askDelete(): void {
		this.question = {
			notes: this.#options.noteCount,
			moveTo: this.#options.others.at(0)?.id ?? null,
		}
	}

	public pickTarget(id: number): void {
		if (this.question !== null) {
			this.question = { ...this.question, moveTo: id }
		}
	}

	public cancelDelete(): void {
		this.question = null
	}

	public async confirmDelete(): Promise<void> {
		const id = this.#id
		const { question } = this

		if (id === null || question === null || this.busy) {
			return
		}

		const moveTo = question.notes > 0 ? question.moveTo : null

		if (question.notes > 0 && moveTo === null) {
			return
		}

		this.busy = true

		try {
			const result = await this.#options.api.deleteCategory(id, moveTo ?? undefined)

			if (result.ok) {
				this.question = null
				this.#options.done()

				return
			}

			// Notes were filed meanwhile: ask again with their count.
			if (result.code === 'category_in_use' && result.notes !== undefined) {
				this.question = {
					notes: result.notes,
					moveTo: question.moveTo ?? this.#options.others.at(0)?.id ?? null,
				}

				return
			}

			this.#fail(result, this.#options.strings.deleteFailed)
		} finally {
			this.busy = false
		}
	}

	async #saveFields(): Promise<boolean> {
		const draft = trimmed(this.draft)
		const { api } = this.#options

		if (this.#id === null) {
			const { engine: _engine, ...fields } = draft
			const result = await api.createCategory(fields)

			if (!result.ok) {
				return this.#fail(result, this.#options.strings.saveFailed)
			}

			this.#id = result.value.id
			this.#saved = { ...draft, engine: null }

			return true
		}

		const change: Partial<CategoryFields> = Object.fromEntries(
			fieldKeys.flatMap((key) => (draft[key] === this.#saved[key] ? [] : [[key, draft[key]]])),
		)

		if (Object.keys(change).length === 0) {
			return true
		}

		const result = await api.changeCategory(this.#id, change)

		if (!result.ok) {
			return this.#fail(result, this.#options.strings.saveFailed)
		}

		this.#saved = { ...draft, engine: this.#saved.engine }

		return true
	}

	async #saveEngine(): Promise<boolean> {
		const { engine } = this.draft

		if (this.#id === null || engine === this.#saved.engine) {
			return true
		}

		const result = await this.#options.api.setCategoryEngine(this.#id, engine)

		if (!result.ok) {
			return this.#fail(result, this.#options.strings.saveFailed)
		}

		this.#saved = { ...this.#saved, engine }

		return true
	}

	#fail(result: ApiFailure, message: string): false {
		if (result.code === 'category_exists') {
			this.nameError = this.#options.strings.nameTaken
		} else if (result.status !== 401) {
			this.#options.toasts.show(errorToast(message))
		}

		return false
	}
}
