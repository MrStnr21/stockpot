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
		{
			files: ['playwright.config.ts', 'tests/book/**/*.ts'],
			rules: { 'eslint/no-restricted-imports': ['error', { patterns: [appImports] }] },
		},
		{
			files: ['tests/book/**/*.spec.ts'],
			jsPlugins: ['eslint-plugin-playwright'],
			rules: {
				'playwright/missing-playwright-await': 'error',
				'playwright/no-conditional-in-test': 'error',
				'playwright/no-focused-test': 'error',
				'playwright/no-skipped-test': 'error',
				'playwright/no-wait-for-timeout': 'error',
				'playwright/require-hook': 'error',
				'playwright/require-top-level-describe': ['error', { maxTopLevelDescribes: 1 }],
				'playwright/valid-expect': 'error',
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
