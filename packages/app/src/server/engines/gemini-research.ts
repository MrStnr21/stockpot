// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The research loop of the Gemini engine for an idea report (docs/engines.md, "The Gemini engine"):
 * plan the questions, search for each in turn, then write the report from what the searches found.
 * Deep Research is a preview agent that cannot return the report's schema within the research time
 * limit, so the engine does its own. Every request goes through `generate`, which holds the call's one
 * deadline, and the findings stay in this function: Google's terms let a grounded result be resubmitted
 * only within the call, so they are never stored, logged or kept for a retry.
 */
import type { GenerateContentConfig, GenerateContentResponse } from '@google/genai'
import * as v from 'valibot'

import { deriveJsonSchema, list, text } from '#/lib/json-schema'

import {
	EngineError,
	parseJsonText,
	parseOutput,
	type CardInput,
	type JsonValue,
	type OutputFormat,
	type Redacted,
	type ResearchProgress,
} from './contract'
import { capped, within } from './gemini-research-cap'
import {
	planStep,
	reportPrompt,
	searchStep,
	type Finding,
	type Source,
} from './gemini-research-prompts'
import { addUsage, answerText, readFacts, type Facts } from './gemini-response'
import { structured } from './gemini-schema'
import { researchThinking } from './gemini-thinking'
import { buildPrompt } from './prompt'
import type { RunReport } from './runs'

/** One request of a call; `step` stops that request alone, and the call goes on. */
export type Generate = (
	contents: string,
	config: GenerateContentConfig,
	step?: AbortSignal,
) => Promise<GenerateContentResponse>

/** What the loop works with: the call's requests, its run, its time and where to tell its progress. */
export interface ResearchCall {
	readonly model: string
	readonly generate: Generate
	readonly report: RunReport
	/** The one deadline of the whole call, which `generate` enforces. */
	readonly timeoutMs: number
	readonly onProgress?: (progress: ResearchProgress) => void
}

/*
 * The most questions a plan may hold. `requestsPerCall` counts a research call as the plan, one search
 * for each of these and the report, so the whole loop fits the usage limits before its first request.
 */
export const maxQuestions = 5

/*
 * The time of the call, in shares of its limit, so that specs stay small. Planning gets a tenth: it
 * writes a few lines. A search step gets a fifth, so that one slow page cannot eat the research. The
 * report keeps a third in reserve, because it reads every finding and thinks hard, and a call that
 * ran out of time there would lose all the searching (findings are not kept for a retry). That is
 * 1.5, 3 and 5 minutes of the 15 an idea report gets.
 */
const planShare = 0.1

const stepShare = 0.2

const reserveShare = 1 / 3

// A finding is a few notes by design; the cut guards the report's prompt against a runaway answer.
const findingChars = 4000

const plan = v.strictObject({
	questions: list(
		text(200, 'One question the research should answer.'),
		{ min: 2, max: maxQuestions },
		'The questions that together cover every section of the report, most important first.',
	),
})

const planFormat: OutputFormat<typeof plan> = {
	id: 'research-plan',
	instructions: '',
	schema: plan,
	jsonSchema: deriveJsonSchema(plan),
}

/** What one call to `researchIdea` shares among its steps. */
interface Loop {
	readonly call: ResearchCall
	/** The call's prompt, from `buildPrompt`. */
	readonly prompt: string
	readonly thinking: { readonly thinkingConfig?: ReturnType<typeof researchThinking> }
	readonly started: number
}

/** What the searches have found so far. */
interface Research {
	readonly findings: Finding[]
	readonly unanswered: string[]
	readonly sources: Map<string, Source>
	/** The sum of the queries of every step. */
	searches: number
	/** The first step's Search Suggestions, unmodified. */
	suggestions: string | null
	/** The steps that finished, answered or not. */
	searched: number
}

function elapsed({ started }: Loop): number {
	return Date.now() - started
}

function announce({ call: { onProgress } }: Loop, progress: ResearchProgress): void {
	try {
		onProgress?.(progress)
	} catch {
		// Progress is only shown to the owner: its failure must not fail the research.
	}
}

async function planQuestions(loop: Loop): Promise<readonly string[]> {
	const { call, prompt, thinking } = loop
	const config = { ...structured(planFormat), ...thinking }

	const planned = await within(call.timeoutMs * planShare, async (signal) => {
		const response = await call.generate(`${prompt}\n\n${planStep(maxQuestions)}`, config, signal)

		addUsage(call.report, response)

		return parseOutput(planFormat, parseJsonText(answerText(response)))
	})

	if (planned === capped) {
		throw new EngineError(
			{ kind: 'timeout', afterMs: elapsed(loop) },
			'The idea research could not plan its questions before its time limit',
		)
	}

	return planned.questions
}

/** One search request: its notes and pages, or `null` when the answer is blocked, empty or cut off. */
async function ask(
	loop: Loop,
	research: Research,
	{ question, signal }: { readonly question: string; readonly signal: AbortSignal },
): Promise<Facts | null> {
	const { call, prompt } = loop
	const { report } = call
	const tools = [{ googleSearch: {} }, { urlContext: {} }]

	try {
		const response = await call.generate(`${prompt}\n\n${searchStep(question)}`, { tools }, signal)

		addUsage(report, response)

		const facts = readFacts(response, report)

		/* `readFacts` overwrites these with its own step's; the run keeps the sum of the queries and
		 * the first entry point, unmodified, which the terms allow with the final result. */
		research.searches += report.searches ?? 0
		research.suggestions ??= report.searchSuggestions
		report.searches = research.searches
		report.searchSuggestions = research.suggestions

		return facts
	} catch (error) {
		if (error instanceof EngineError && error.kind === 'invalid') {
			return null
		}

		throw error
	}
}

/** Searches one question within its cap and keeps what it found; a failed one is left unanswered. */
async function searchQuestion(loop: Loop, research: Research, question: string): Promise<void> {
	const cap = loop.call.timeoutMs * stepShare
	const found = await within(cap, async (signal) => ask(loop, research, { question, signal }))

	research.searched += 1

	if (found === capped || found === null) {
		research.unanswered.push(question)

		return
	}

	research.findings.push({ question, text: found.text.slice(0, findingChars) })

	for (const source of found.sources) {
		if (!research.sources.has(source.uri)) {
			research.sources.set(source.uri, source)
		}
	}
}

const jsonObject = v.record(
	v.string(),
	v.custom<JsonValue>(() => true),
)

/** The answer with `uncertain` set, for a report written from only part of the research. */
function markUncertain(answer: JsonValue): JsonValue {
	return v.is(jsonObject, answer) && 'uncertain' in answer ? { ...answer, uncertain: true } : answer
}

async function writeReport<TSchema extends v.GenericSchema>(
	input: Redacted<CardInput & { readonly output: OutputFormat<TSchema> }>,
	{ call, prompt, thinking }: Loop,
	{ findings, sources, unanswered }: Research,
): Promise<v.InferOutput<TSchema>> {
	const parts = { prompt, findings, sources: [...sources.values()], unanswered }
	const config = { ...structured(input.output), ...thinking }
	const response = await call.generate(reportPrompt(parts), config)

	addUsage(call.report, response)

	const answer = parseJsonText(answerText(response))

	return parseOutput(input.output, unanswered.length === 0 ? answer : markUncertain(answer))
}

/**
 * Writes the report of an idea. A question whose search is capped, blocked or empty, or that never
 * started for want of time, is left unanswered and the loop goes on; the report is then written from
 * the rest, marked uncertain and told to name the gaps. With no answer at all there is nothing to
 * write, and the call fails with `timeout`. Rate limits, a bad key, an abort and the call's deadline
 * fail it unchanged.
 */
export async function researchIdea<TSchema extends v.GenericSchema>(
	input: Redacted<CardInput & { readonly output: OutputFormat<TSchema> }>,
	call: ResearchCall,
): Promise<v.InferOutput<TSchema>> {
	const thinkingConfig = researchThinking(call.model)
	const thinking = thinkingConfig === undefined ? {} : { thinkingConfig }
	const prompt = buildPrompt(input, { canSearch: true })
	const loop: Loop = { call, prompt, thinking, started: Date.now() }

	const research: Research = {
		findings: [],
		unanswered: [],
		sources: new Map(),
		searches: 0,
		suggestions: null,
		searched: 0,
	}

	// A search starts only while its whole cap still leaves the report its reserve.
	const searchUntil = call.timeoutMs * (1 - reserveShare)
	const stepCap = call.timeoutMs * stepShare

	announce(loop, { step: 'planning', questions: 0, searched: 0, pages: 0 })

	const questions = await planQuestions(loop)

	function progress(step: ResearchProgress['step']): ResearchProgress {
		return {
			step,
			questions: questions.length,
			searched: research.searched,
			pages: research.sources.size,
		}
	}

	announce(loop, progress('searching'))

	for (const [index, question] of questions.entries()) {
		if (elapsed(loop) + stepCap > searchUntil) {
			research.unanswered.push(...questions.slice(index))
			break
		}

		// oxlint-disable-next-line no-await-in-loop -- The questions are searched one at a time, in order.
		await searchQuestion(loop, research, question)
		announce(loop, progress('searching'))
	}

	if (research.findings.length === 0) {
		throw new EngineError(
			{ kind: 'timeout', afterMs: elapsed(loop) },
			'The idea research found nothing before its time limit',
		)
	}

	announce(loop, progress('writing'))

	return writeReport(input, loop, research)
}
