// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The oxlint settings every workspace shares, on top of the `@configg/bases` presets. Each package's
 * `oxlint.config.ts` spreads one of these and adds only what is its own (import boundaries in the app).
 */
import { antiSlop, configs } from '@configg/bases/oxlint'
import { environments } from 'eslint-plugin-astro'
import { SVELTE_RUNES } from 'eslint-plugin-svelte/lib/shared/runes.js'
import type { OxlintConfig } from 'oxlint'

type Overrides = NonNullable<OxlintConfig['overrides']>

const ignorePatterns = ['dist', '.astro', 'playwright-report', 'test-results']

/*
 * The presets lint `*.spec.ts` as Vitest + Testing Library files. Specs here are `bun:test` without a
 * DOM, so drop the Testing Library plugin and its rules rather than install a plugin nothing uses.
 */
function withoutTestingLibrary(overrides: Overrides): Overrides {
	return overrides.map((override) => ({
		...override,
		jsPlugins:
			override.jsPlugins?.filter((plugin) => plugin !== 'eslint-plugin-testing-library') ?? null,
		rules: {
			...Object.fromEntries(
				Object.entries(override.rules ?? {}).filter(
					([rule]) => !rule.startsWith('testing-library/'),
				),
			),
			// The preset sets the `.spec` pattern at the top level, where the Vitest plugin is off, so it never applies.
			...(override.plugins?.includes('vitest') === true && {
				'vitest/consistent-test-filename': ['error', { pattern: String.raw`.*\.spec\.ts$` }],
			}),
		},
	}))
}

// Enabling the `import` plugin turns on its whole category set; only `no-cycle` is wanted.
const importRules = {
	'import/consistent-type-specifier-style': 'off',
	'import/exports-last': 'off',
	'import/group-exports': 'off',
	'import/max-dependencies': 'off',
	'import/newline-after-import': 'off',
	'import/no-anonymous-default-export': 'off',
	'import/no-default-export': 'off',
	'import/no-duplicates': 'off',
	'import/no-named-export': 'off',
	'import/no-namespace': 'off',
	'import/no-nodejs-modules': 'off',
	'import/no-relative-parent-imports': 'off',
	'import/no-unassigned-import': 'off',
	'import/unambiguous': 'off',
	'import/no-cycle': ['error', { ignoreTypes: true }],
} as const satisfies OxlintConfig['rules']

const sharedRules = {
	...importRules,
	// Bun's APIs come from an import, so isomorphic code can be kept free of them by import rules.
	'eslint/no-restricted-globals': [
		'error',
		{ name: 'Bun', message: "Import the API from 'bun' instead (`import { file } from 'bun'`)." },
	],
} as const satisfies OxlintConfig['rules']

const sharedOptions = {
	// Suppressions must not outlive the violation they cover.
	reportUnusedDisableDirectives: 'error',
} as const satisfies OxlintConfig['options']

// eslint-plugin-astro marks a global `true` when writable; oxlint wants 'readonly' or 'writable'.
const astroGlobals = Object.fromEntries(
	Object.entries(environments.astro.globals).map(
		([name, writable]) => [name, writable ? 'writable' : 'readonly'] as const,
	),
)

const componentOverrides: Overrides = [
	{
		// Oxlint does not know Svelte runes; eslint-plugin-svelte's list is the source of truth.
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		globals: Object.fromEntries([...SVELTE_RUNES].map((rune) => [rune, 'readonly'] as const)),
	},
	{
		// A `.svelte.ts` module is one program, so undefined names are real mistakes there.
		files: ['**/*.svelte.ts', '**/*.svelte.js'],
		rules: { 'eslint/no-undef': 'error' },
	},
	{
		/* Permanent: oxlint lints a component's `<script module>` and `<script>` as separate programs, so a
		 * name declared in one and used in the other reads as undefined. */
		files: ['**/*.svelte'],
		rules: { 'eslint/no-undef': 'off' },
	},
	{
		// Oxlint lints only the frontmatter of `.astro` files; give it the Astro globals so `no-undef` holds.
		// Permanent: reads of frontmatter variables in the template are invisible to it.
		files: ['**/*.astro'],
		globals: astroGlobals,
		rules: { 'eslint/no-undef': 'error', 'eslint/no-useless-assignment': 'off' },
	},
]

// Oxlint's `jest` and `vitest` rules skip files that import from `bun:test`, so a local plugin checks specs.
const specsPlugin = { name: 'specs', specifier: `${import.meta.dirname}/specs.ts` }

/** The spec layout of docs/guidelines/tests.md for the `bun:test` specs matched by `files`. */
export function specOverride(files: string[]): Overrides[number] {
	return {
		files,
		jsPlugins: [specsPlugin],
		rules: {
			'specs/structure': 'error',
			// A spec declares `let` state at the top of a `describe` and assigns it in a hook.
			'eslint/init-declarations': 'off',
		},
	}
}

/** Browser and server code with Astro and Svelte components: the app and the UI package. */
export const componentConfig = {
	...configs.client,
	ignorePatterns,
	options: {
		...configs.client.options,
		// `astro check` type-checks these packages with TypeScript 6; the tsrs pass would only repeat it.
		typeCheck: false,
		...sharedOptions,
	},
	plugins: [...configs.client.plugins, 'import'],
	jsPlugins: [...antiSlop.jsPlugins],
	overrides: [...withoutTestingLibrary(configs.client.overrides), ...componentOverrides],
	rules: {
		...configs.client.rules,
		...antiSlop.rules,
		...sharedRules,
		// Astro routes are named after their params (`[id].ts`), and the rule cannot be disabled per file.
		'unicorn/filename-case': 'off',
	},
} as const satisfies OxlintConfig

// The client preset's relaxations, so the tools read like the rest of the codebase.
const clientRelaxations = {
	'eslint/no-ternary': 'off',
	'eslint/no-undefined': 'off',
	'eslint/no-use-before-define': 'off',
	'oxc/no-optional-chaining': 'off',
	'typescript/explicit-function-return-type': 'off',
	'unicorn/no-null': 'off',
} as const satisfies OxlintConfig['rules']

/** Scripts that run on Bun only: the repository tools. */
export const scriptConfig = {
	...configs.scripts,
	ignorePatterns,
	options: { ...configs.scripts.options, ...sharedOptions },
	plugins: ['eslint', 'oxc', 'typescript', 'unicorn', 'import'],
	jsPlugins: [...antiSlop.jsPlugins],
	rules: { ...configs.scripts.rules, ...antiSlop.rules, ...sharedRules, ...clientRelaxations },
} as const satisfies OxlintConfig
