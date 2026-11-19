// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The engine contract (docs/engines.md): the one boundary between the product and language models.
 * Features call the router with these types and concrete engines implement `Engine`. Nothing here may
 * import a feature, so each call carries its output format as data: the Valibot schema that validates
 * the answer and the JSON Schema derived from it for the provider.
 */
import type { JsonSchema } from '@valibot/to-json-schema'
import * as v from 'valibot'

/** `suggest` proposes categories while a note is typed, `explain` writes a card, `research` a report. */
export type Task = 'suggest' | 'explain' | 'research'

/** How deep a card goes: 1 is the first card, 2 how it works and its trade-offs, 3 hands-on. */
export type Depth = 1 | 2 | 3

/** Which of an engine's models a call wants. Settings map each tier to a model ID per engine. */
export type Tier = 'fast' | 'standard' | 'deep'

/** JSON as a provider returns it or a card is stored, before it is validated. */
export type JsonValue =
	string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/** The shape a call must answer in. */
export interface OutputFormat<TSchema extends v.GenericSchema = v.GenericSchema> {
	/** The format id, such as `technology`, or `suggestion`. */
	readonly id: string
	/** The format's part of the prompt; field-level guidance travels in `jsonSchema`. */
	readonly instructions: string
	/** Validates the answer: it is the source of truth, whatever the provider was told. */
	readonly schema: TSchema
	/** Tells the provider what to return, through its structured-output option. */
	readonly jsonSchema: JsonSchema
}

/** What an engine may learn about a note. A private one reaches it as its term alone (`redactPrivate`). */
export interface EngineNote {
	/** The normalized text of the note. */
	readonly term: string
	/** The note as typed, when it says more than the term. */
	readonly text: string | null
	/** Where the owner saw it. */
	readonly context: string | null
	/** A link the owner saved with it. */
	readonly url: string | null
	readonly isPrivate: boolean
}

export interface SuggestCategory {
	readonly id: string
	readonly name: string
	/** What belongs in the category, from its format or the owner's instructions. */
	readonly hint: string | null
}

interface TaskInput<TSchema extends v.GenericSchema> {
	readonly note: EngineNote
	/** The card language from settings, as an ISO 639-1 code. */
	readonly language: string
	readonly output: OutputFormat<TSchema>
}

export interface SuggestInput<
	TSchema extends v.GenericSchema = v.GenericSchema,
> extends TaskInput<TSchema> {
	readonly task: 'suggest'
	/** The owner's categories to choose from. */
	readonly categories: readonly SuggestCategory[]
}

export interface CardInput<
	TTask extends 'explain' | 'research' = 'explain' | 'research',
	TSchema extends v.GenericSchema = v.GenericSchema,
> extends TaskInput<TSchema> {
	readonly task: TTask
	readonly category: {
		readonly name: string
		/** The owner's additions to the format's instructions. */
		readonly instructions: string | null
	}
	readonly depth: Depth
	/** The note's cards at the levels below `depth`, so a deeper card builds on them. */
	readonly previous: readonly JsonValue[]
}

export type EngineInput = SuggestInput | CardInput

export interface RunOptions {
	readonly tier: Tier
	/** The engine stops the call and fails with `timeout` after this long. */
	readonly timeoutMs: number
	readonly signal?: AbortSignal
	/** The job the call runs in, recorded with its `engine_runs` row; a suggestion runs outside any job. */
	readonly jobId?: number
}

/*
 * Starting values, to be confirmed by measurement (ENG-7): a suggestion must arrive within its 1.5 s
 * p95 budget or not at all, a card gets three minutes and an idea report fifteen.
 */
export const defaultTimeoutMs = {
	suggest: 3000,
	explain: 3 * 60_000,
	research: 15 * 60_000,
} as const satisfies Record<Task, number>

export interface EngineResult<TOutput> {
	readonly output: TOutput
	/** The id of the engine in settings, such as `gemini`. */
	readonly engine: string
	/** The model ID the provider reported, when it reports one. */
	readonly model: string | null
	/**
	 * The Search Suggestions HTML a call grounded in Google Search returned. Google's terms require
	 * showing it with the answer, unmodified, to the owner who asked (docs/engines.md).
	 */
	readonly searchSuggestions: string | null
	readonly elapsedMs: number
}

/*
 * Set only by `redactPrivate`. The symbol is not exported, so no other module can build a `Redacted`
 * value without a type assertion, which review rejects.
 */
const redactedMark: unique symbol = Symbol('redacted')

/** An input that went through `redactPrivate`: the only kind an engine accepts. */
export type Redacted<TInput extends EngineInput> = TInput & { readonly [redactedMark]: true }

type Run<TInput extends EngineInput> = <TSchema extends v.GenericSchema>(
	input: Redacted<TInput & { readonly output: OutputFormat<TSchema> }>,
	options: RunOptions,
) => Promise<EngineResult<v.InferOutput<TSchema>>>

/**
 * A language model provider behind the contract. Its methods take only a `Redacted` input, so every
 * path to an engine, fallback included, goes through `redactPrivate`. An engine validates its answer
 * with `parseOutput` and reports every failure it recognises as an `EngineError`; anything else it
 * throws is retried by the job runner as an ordinary error.
 */
export interface Engine {
	readonly id: string
	readonly suggest: Run<SuggestInput>
	readonly explain: Run<CardInput<'explain'>>
	readonly research: Run<CardInput<'research'>>
}

/**
 * The four ways a call can fail that an engine reports. The router falls back to the next engine on
 * `rate_limited` and `auth`; the job runner retries `timeout` and `invalid` on the same engine.
 */
export type EngineFailure =
	| { readonly kind: 'rate_limited'; readonly resetsAt: Date }
	| { readonly kind: 'auth' }
	| { readonly kind: 'timeout'; readonly afterMs: number }
	| { readonly kind: 'invalid'; readonly issues: readonly string[] }

export type EngineErrorKind = EngineFailure['kind']

export class EngineError extends Error {
	public override readonly name = 'EngineError'
	public readonly failure: EngineFailure

	public constructor(failure: EngineFailure, message: string, options?: ErrorOptions) {
		super(message, options)
		this.failure = failure
	}

	public get kind(): EngineErrorKind {
		return this.failure.kind
	}
}

function describeIssue(issue: v.BaseIssue<unknown>): string {
	const path = v.getDotPath(issue)

	return path === null ? issue.message : `${path}: ${issue.message}`
}

/** Parses the JSON text a provider returned, failing with `invalid` when it is not JSON. */
export function parseJsonText(text: string): JsonValue {
	try {
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SAFETY: JSON.parse returns only JSON values.
		return JSON.parse(text) as JsonValue
	} catch (error) {
		throw new EngineError(
			{ kind: 'invalid', issues: ['The answer is not JSON'] },
			'The answer is not JSON',
			{
				cause: error,
			},
		)
	}
}

/**
 * Checks an answer against the call's format, failing with `invalid` when it does not match. Each
 * engine first parses the provider's JSON text itself, with `parseJsonText` or its own reading.
 */
export function parseOutput<TSchema extends v.GenericSchema>(
	output: OutputFormat<TSchema>,
	answer: JsonValue,
): v.InferOutput<TSchema> {
	const result = v.safeParse(output.schema, answer)

	if (result.success) {
		return result.output
	}

	throw new EngineError(
		{ kind: 'invalid', issues: result.issues.map(describeIssue) },
		`The answer does not match the ${output.id} format`,
	)
}

function redactNote({ term, text, context, url, isPrivate }: EngineNote): EngineNote {
	return isPrivate
		? { term, text: null, context: null, url: null, isPrivate }
		: { term, text, context, url, isPrivate }
}

/**
 * The privacy rule: a private note reaches an engine as its term alone, without its text, context,
 * link or earlier cards. The task's own settings (format, category, language) are not note data and
 * stay. The result is rebuilt from the fields the contract defines, so nothing else a caller put on
 * the input, private or not, reaches an engine.
 */
export function redactPrivate<TSchema extends v.GenericSchema>(
	input: SuggestInput<TSchema>,
): Redacted<SuggestInput<TSchema>>
export function redactPrivate<
	TTask extends 'explain' | 'research',
	TSchema extends v.GenericSchema,
>(input: CardInput<TTask, TSchema>): Redacted<CardInput<TTask, TSchema>>
export function redactPrivate(input: EngineInput): Redacted<EngineInput> {
	const shared = {
		note: redactNote(input.note),
		language: input.language,
		output: input.output,
		[redactedMark]: true,
	} as const

	if (input.task === 'suggest') {
		const categories = input.categories.map(({ id, name, hint }) => ({ id, name, hint }))

		return { ...shared, task: input.task, categories }
	}

	const { name, instructions } = input.category

	return {
		...shared,
		task: input.task,
		category: { name, instructions },
		depth: input.depth,
		previous: input.note.isPrivate ? [] : input.previous,
	}
}
