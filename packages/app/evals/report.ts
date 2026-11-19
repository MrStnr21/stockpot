// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The eval report: pass rate and latency per format and per check, rendered as Markdown for people and
 * kept whole as JSON, plus the manual score sheet (evals/rubric.md).
 */
import * as v from 'valibot'

import { formatIds } from '#/lib/format-ids'
import type { JsonValue, Task } from '#/server/engines/contract'

import { checkIds, type CheckId, type CheckResult } from './checks'

/** One engine call and what the checks found. */
export interface CallRecord {
	readonly noteId: string
	readonly task: Task
	/** The card format, or `suggestion`. */
	readonly format: string
	readonly elapsedMs: number
	/** Why the call gave no answer, such as `timeout`. An `invalid` answer is a `schema` fail instead. */
	readonly error: string | null
	readonly checks: readonly CheckResult[]
	readonly answer: JsonValue | null
}

export interface ReportNote {
	readonly id: string
	readonly text: string
	readonly source: 'owner' | 'composed'
	readonly private: boolean
	readonly format: string
	/** Whether any of the note came from a local file. */
	readonly local: boolean
}

export interface GroupStats {
	readonly calls: number
	readonly errors: number
	/** Calls that answered and passed every check that applied. */
	readonly passed: number
	readonly passRate: number
	/** Latency of the calls that answered; `null` when none did. Errors would skew it either way. */
	readonly p50Ms: number | null
	readonly p95Ms: number | null
}

export interface CheckStats {
	readonly applied: number
	readonly passed: number
	readonly failed: number
	/** Applied but not verifiable, as the private check for an engine whose payload is not recorded. */
	readonly unverifiable: number
	/** Of the verified results; `null` when none was verified. */
	readonly passRate: number | null
}

export interface Summary {
	readonly byFormat: Readonly<Record<string, GroupStats>>
	readonly byCheck: Readonly<Partial<Record<CheckId, CheckStats>>>
}

export interface EvalReport {
	/** Why the run stopped before its last call, or `null` when it ran to the end. */
	readonly stopped: string | null
	readonly engine: string
	readonly language: string
	readonly startedAt: string
	readonly notes: readonly ReportNote[]
	readonly calls: readonly CallRecord[]
	readonly summary: Summary
}

const checkResultSchema = v.strictObject({
	check: v.picklist(checkIds),
	passed: v.nullable(v.boolean()),
	detail: v.nullable(v.string()),
})

const callRecordSchema = v.strictObject({
	noteId: v.string(),
	task: v.picklist(['suggest', 'explain', 'research']),
	format: v.string(),
	elapsedMs: v.number(),
	error: v.nullable(v.string()),
	checks: v.array(checkResultSchema),
	// The value came from JSON.parse, so whatever it holds is JSON.
	answer: v.custom<JsonValue>((value) => value !== undefined),
})

const callLine = v.pipe(v.string(), v.parseJson(), callRecordSchema)

/** The calls a run appended to its `calls.jsonl`, one per line, in order. */
export function parseCalls(text: string): CallRecord[] {
	return text
		.split('\n')
		.filter((line) => line.trim() !== '')
		.map((line) => v.parse(callLine, line))
}

/** The nearest-rank percentile: the smallest value that `p` percent of the values do not exceed. */
export function percentile(values: readonly number[], p: number): number | null {
	const sorted = values.toSorted((a, b) => a - b)
	const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))

	return sorted.at(rank - 1) ?? null
}

function hasPassed(call: CallRecord): boolean {
	return call.error === null && call.checks.every(({ passed }) => passed !== false)
}

function groupStats(calls: readonly CallRecord[]): GroupStats {
	const passed = calls.filter((call) => hasPassed(call)).length
	const answered = calls.filter(({ error }) => error === null)
	const durations = answered.map(({ elapsedMs }) => elapsedMs)

	return {
		calls: calls.length,
		errors: calls.length - answered.length,
		passed,
		passRate: calls.length === 0 ? 0 : passed / calls.length,
		p50Ms: percentile(durations, 50),
		p95Ms: percentile(durations, 95),
	}
}

const groupOrder = ['suggestion', ...formatIds]

export function summarize(calls: readonly CallRecord[]): Summary {
	const byFormat = Object.fromEntries(
		groupOrder.flatMap((format) => {
			const group = calls.filter((call) => call.format === format)

			return group.length === 0 ? [] : [[format, groupStats(group)]]
		}),
	)

	const results = calls.flatMap(({ checks }) => checks)

	const byCheck = Object.fromEntries(
		checkIds.flatMap((id) => {
			const applied = results.filter(({ check }) => check === id)
			const passed = applied.filter((result) => result.passed === true).length
			const failed = applied.filter((result) => result.passed === false).length

			if (applied.length === 0) {
				return []
			}

			const unverifiable = applied.length - passed - failed
			const passRate = passed + failed === 0 ? null : passed / (passed + failed)

			return [[id, { applied: applied.length, passed, failed, unverifiable, passRate }]]
		}),
	)

	return { byFormat, byCheck }
}

function percent(rate: number | null): string {
	return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

/** A duration short enough to read: milliseconds, seconds or minutes. */
export function formatDuration(ms: number | null): string {
	if (ms === null) {
		return '—'
	}

	if (ms < 1000) {
		return `${Math.round(ms)} ms`
	}

	return ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${(ms / 60_000).toFixed(1)} min`
}

function cell(text: string): string {
	return text.replaceAll('|', String.raw`\|`).replaceAll(/\s+/gu, ' ')
}

function tableRow(cells: readonly string[]): string {
	return `| ${cells.map((text) => cell(text)).join(' | ')} |`
}

function table(header: readonly string[], rows: readonly (readonly string[])[]): string {
	const divider = header.map(() => '---')

	return [tableRow(header), tableRow(divider), ...rows.map((row) => tableRow(row))].join('\n')
}

function failures(calls: readonly CallRecord[]): string[][] {
	return calls.flatMap((call) => {
		const failed = call.checks.filter(({ passed }) => passed === false)
		const error = call.error === null ? [] : [[call.noteId, call.format, 'error', call.error]]

		return [
			...error,
			...failed.map(({ check, detail }) => [call.noteId, call.format, check, detail ?? '']),
		]
	})
}

export function renderMarkdown(report: EvalReport): string {
	const owner = report.notes.filter(({ source }) => source === 'owner').length
	const privateNotes = report.notes.filter((note) => note.private).length
	const { byFormat, byCheck } = report.summary

	const formatRows = Object.entries(byFormat).map(([format, stats]) => [
		format,
		String(stats.calls),
		percent(stats.passRate),
		String(stats.calls - stats.errors),
		String(stats.errors),
		formatDuration(stats.p50Ms),
		formatDuration(stats.p95Ms),
	])

	const checkRows = Object.entries(byCheck).map(([check, stats]) => [
		check,
		String(stats.applied),
		String(stats.passed),
		String(stats.failed),
		String(stats.unverifiable),
		percent(stats.passRate),
	])

	const failureRows = failures(report.calls)

	return [
		`# Eval report: ${report.engine}`,
		...(report.stopped === null
			? []
			: [
					`**Stopped early:** ${report.stopped}. The report covers the ${report.calls.length} calls made before that.`,
				]),
		`Started ${report.startedAt}, card language \`${report.language}\`, ${report.notes.length} notes (${owner} from the owner, ${report.notes.length - owner} composed, ${privateNotes} private). Compare the numbers with the thresholds in evals/rubric.md.`,
		'## By format',
		'Latency counts only the calls that answered; the calls that failed are in Errors.',
		table(['Format', 'Calls', 'Pass rate', 'Answered', 'Errors', 'p50', 'p95'], formatRows),
		'## By check',
		table(['Check', 'Applied', 'Passed', 'Failed', 'Not verifiable', 'Pass rate'], checkRows),
		'## Failures',
		failureRows.length === 0 ? 'None.' : table(['Note', 'Format', 'Check', 'Detail'], failureRows),
		'',
	].join('\n\n')
}

const senseField = v.looseObject({ sense: v.optional(v.string(), '') })

function senseOf(answer: JsonValue | null): string {
	const result = v.safeParse(senseField, answer)

	return result.success ? result.output.sense : ''
}

/** The manual score sheet: a row per card, with the scores of evals/rubric.md left blank. */
export function renderScoreSheet(report: EvalReport): string {
	const cards = new Map(
		report.calls.filter(({ task }) => task !== 'suggest').map((call) => [call.noteId, call]),
	)

	const rows = report.notes.map((note) => {
		const card = cards.get(note.id)

		const answered =
			card?.answer === null || card === undefined ? 'no answer' : senseOf(card.answer)

		return [note.id, note.source, note.text, note.format, answered, '', '', '', '']
	})

	return [
		`# Score sheet: ${report.engine}, ${report.startedAt}`,
		'Score each card as evals/rubric.md says: Accurate and Clear from 1 to 5, Right sense yes or no. The cards are in report.json.',
		table(
			[
				'Note',
				'Source',
				'Text',
				'Format',
				'Sense explained',
				'Accurate',
				'Clear',
				'Right sense',
				'Comment',
			],
			rows,
		),
		'',
	].join('\n\n')
}
