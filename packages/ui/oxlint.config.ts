// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { defineConfig } from 'oxlint'

import { componentConfig, specOverride } from '../../tools/lint/base.ts'

export default defineConfig({
	...componentConfig,
	overrides: [...componentConfig.overrides, specOverride(['src/**/*.spec.ts'])],
	rules: {
		...componentConfig.rules,
		// The UI package is isomorphic and stands alone: no runtime built-ins, no app modules.
		'eslint/no-restricted-imports': [
			'error',
			{
				patterns: [
					{ group: ['node:*', 'bun', 'bun:*'], message: 'UI code runs in the browser too.' },
					{
						group: ['@stockpot/app', '@stockpot/app/*'],
						message: 'The UI package never imports the app.',
					},
				],
			},
		],
	},
})
