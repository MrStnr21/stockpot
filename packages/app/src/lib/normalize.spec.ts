// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'

import { normalizeTerm, termVariants } from './normalize'

describe('normalize', () => {
	describe('normalizeTerm', () => {
		const maxLengthTerm = faker.string.alpha({ length: 80, casing: 'lower' })

		it.each([
			['mixed case', 'KuBeRnEtEs', 'kubernetes'],
			['compatibility forms', '（Ｎｏｄｅ．ＪＳ）', 'node.js'],
			['quotes and brackets', ' «„{[(`Node.js`)]}”» ', 'node.js'],
			['sentence punctuation', ' ,;:!? …Node.js …!?.,;: ', 'node.js'],
			['a leading ellipsis', '… .NET', '.net'],
			['an inner ellipsis', 'Wait…What?', 'wait...what'],
			['plus signs', 'C++!', 'c++'],
			['a hash sign', 'C#.', 'c#'],
			['a leading period', '(.NET.)', '.net'],
			['a slash', 'CI/CD', 'ci/cd'],
			['other technical symbols', '-_@Scope&*%/+', '-_@scope&*%/+'],
			['curly apostrophes', 'Don’t, don‘t, donʼt.', "don't, don't, don't"],
			[
				'Unicode dashes',
				'Real‐time real‑time real‒time real–time real—time.',
				'real-time real-time real-time real-time real-time',
			],
			['whitespace runs', '  Best\t\n  Practice\u00A0 ', 'best practice'],
			['lone surrogates', 'lone\uD800 best practices\uDC00', 'lone� best practices�'],
			['a surrogate pair', 'Plane ✈ 🛩', 'plane ✈ 🛩'],
			['a plural as written', 'Queries', 'queries'],
			['empty text', '', null],
			['whitespace alone', '\t \n', null],
			['sentence punctuation alone', '“ (...!?…) ”', null],
			['80 characters after stripping', `“${maxLengthTerm}!”`, maxLengthTerm],
			['81 characters', `${maxLengthTerm}a`, null],
		])('normalizes %s', (_case, input, expected) => {
			expect(normalizeTerm(input)).toBe(expected)
		})
	})

	describe('termVariants', () => {
		it.each([
			['queries', ['queries', 'query', 'querie']],
			['caches', ['caches', 'cach', 'cache']],
			['cards', ['cards', 'card']],
			['day', ['day', 'days']],
			['buzz', ['buzz', 'buzzes']],
			['brush', ['brush', 'brushes']],
			['best practice', ['best practice', 'best practices']],
			['c++', ['c++']],
			['io', ['io']],
			['café', ['café']],
			['best news', ['best news']],
			['postgresql', ['postgresql', 'postgresqls', 'postgres']],
		])('lists the lookup forms of %s in order', (term, expected) => {
			expect(termVariants(term)).toEqual(expected)
		})

		it.each([
			['class', 'classes'],
			['query', 'queries'],
			['cookie', 'cookies'],
			['bus', 'buses'],
			['cache', 'caches'],
			['box', 'boxes'],
			['match', 'matches'],
			['brush', 'brushes'],
			['buzz', 'buzzes'],
			['plane', 'planes'],
			['state', 'states'],
			['note', 'notes'],
			['status', 'statuses'],
			['best practice', 'best practices'],
		])('shares a lookup form for %s and %s', (first, second) => {
			const firstVariants = termVariants(first)
			const secondVariants = termVariants(second)

			expect(firstVariants).toContain(second)
			expect(secondVariants).toContain(first)
		})

		it.each([
			['k8s', 'Kubernetes'],
			['i18n', 'internationalization'],
			['l10n', 'localization'],
			['a11y', 'accessibility'],
			['js', 'javascript'],
			['ts', 'typescript'],
			['postgres', 'postgresql'],
		])('matches seeded aliases %s and %s both ways', (first, second) => {
			const canonical = second.toLowerCase()

			expect(normalizeTerm(second)).toBe(canonical)
			expect(termVariants(first)).toContain(canonical)
			expect(termVariants(canonical)).toContain(first)
		})

		it.each([
			['new', 'news'],
			['news', 'new'],
			['kubernetes', 'kubernete'],
			['ios', 'io'],
			['status', 'statu'],
			['redis', 'redi'],
			['analysis', 'analysi'],
			['planes', 'plan'],
			['states', 'stat'],
			['codes', 'cod'],
			['uses', 'us'],
			['notes', 'not'],
		])('%s has no lookup variant %s', (first, second) => {
			expect(termVariants(first)).not.toContain(second)
		})
	})
})
