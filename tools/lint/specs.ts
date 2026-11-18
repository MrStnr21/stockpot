// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Oxlint plugin for the spec layout in docs/guidelines/tests.md: one top-level `describe` per file,
 * every `it` and hook inside it. Oxlint's `jest` and `vitest` rules only recognise those calls as
 * globals or imports from their own packages, so they see nothing in a file that imports from
 * `bun:test`; this rule reads the callee names instead.
 */
import { definePlugin, defineRule, type ESTree } from '@oxlint/plugins'

const testCases = new Set(['it', 'test'])

const hooks = new Set(['beforeAll', 'beforeEach', 'afterAll', 'afterEach'])

// Doubles created at module level outlive the test that needs them; they belong in a hook.
const doubles = new Set(['spyOn', 'mock'])

/** The identifier a call chain starts from: `it.each(rows)('name', fn)` and `describe.skip()` start at `it` and `describe`. */
function calleeRoot(node: ESTree.Node): string | undefined {
	if (node.type === 'Identifier') {
		return node.name
	}

	if (node.type === 'MemberExpression') {
		return calleeRoot(node.object)
	}

	if (node.type === 'CallExpression') {
		return calleeRoot(node.callee)
	}

	return undefined
}

/** The callee root of a top-level expression statement, looking through `await`. */
function statementCall(statement: ESTree.Node): string | undefined {
	if (statement.type !== 'ExpressionStatement') {
		return undefined
	}

	let { expression } = statement

	while (expression.type === 'AwaitExpression') {
		expression = expression.argument
	}

	return expression.type === 'CallExpression' ? calleeRoot(expression.callee) : undefined
}

function createsDouble(statement: ESTree.Node): boolean {
	if (statement.type !== 'VariableDeclaration') {
		return false
	}

	return statement.declarations.some((declarator) => {
		const root =
			declarator.init?.type === 'CallExpression' ? calleeRoot(declarator.init.callee) : undefined

		return root !== undefined && doubles.has(root)
	})
}

const structure = defineRule({
	meta: {
		type: 'suggestion',
		docs: { description: 'Keep every test and hook of a spec inside its one top-level describe.' },
		messages: {
			extraDescribe: 'A spec has one top-level `describe`; nest this one inside it.',
			looseTest: 'Move this test into the top-level `describe`.',
			looseHook: 'Move this hook into the `describe` whose tests need it.',
			looseSetup: 'Move this setup into a hook inside the `describe` that needs it.',
			preferIt: 'Write `it(...)`: bun:test specs read as behaviour.',
		},
	},
	createOnce(context) {
		return {
			Program(program) {
				let describes = 0

				for (const statement of program.body) {
					const call = statementCall(statement)

					if (call === 'describe') {
						describes += 1

						if (describes > 1) {
							context.report({ node: statement, messageId: 'extraDescribe' })
						}
					} else if (call !== undefined && testCases.has(call)) {
						context.report({ node: statement, messageId: 'looseTest' })
					} else if (call !== undefined && hooks.has(call)) {
						context.report({ node: statement, messageId: 'looseHook' })
					} else if (call !== undefined || createsDouble(statement)) {
						context.report({ node: statement, messageId: 'looseSetup' })
					}
				}
			},
			CallExpression(node) {
				// `test.each(rows)('name', fn)` reports once, on the inner `test.each(rows)`.
				if (node.callee.type !== 'CallExpression' && calleeRoot(node.callee) === 'test') {
					context.report({ node, messageId: 'preferIt' })
				}
			},
		}
	},
})

export default definePlugin({ meta: { name: 'specs' }, rules: { structure } })
