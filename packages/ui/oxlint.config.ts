// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { defineConfig } from 'oxlint'

import { componentConfig, specOverride } from '../../tools/lint/base.ts'

const appImports = {
	group: ['@stockpot/app', '@stockpot/app/**', '**/app/src/**'],
	message: 'The UI package never imports the app.',
}

export default defineConfig({
	...componentConfig,
	overrides: [
		...componentConfig.overrides,
		{
			...specOverride(['src/**/*.spec.ts']),
			rules: {
				...specOverride([]).rules,
				// Specs run on Bun (`bun:test`), but still never reach into the app.
				'eslint/no-restricted-imports': ['error', { patterns: [appImports] }],
			},
		},
	],
	rules: {
		...componentConfig.rules,
		// The UI package is isomorphic and stands alone: no runtime built-ins, no app modules.
		'eslint/no-restricted-imports': [
			'error',
			{
				patterns: [
					{ group: ['node:*', 'bun', 'bun:*'], message: 'UI code runs in the browser too.' },
					appImports,
				],
			},
		],
	},
})
