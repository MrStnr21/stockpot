// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { defineConfig } from 'oxlint'

import { componentConfig, specOverride } from '../../tools/lint/base.ts'

/*
 * Layers from docs/architecture.md ("Dependency rules"). Patterns match whole file paths, and the
 * first layer that matches wins, so the more specific feature layers come before `feature-root`
 * and `entry` takes whatever is left in src/ (pages/, layouts/, middleware.ts).
 */
function layer(category: string, pattern: string | string[], capture?: string[]) {
	return { category, pattern, stopMatching: true, ...(capture && { capture }) }
}

const layerFiles = [
	layer('server', 'src/server/**'),
	layer('lib', 'src/lib/**'),
	layer('component-astro', 'src/components/**/*.astro'),
	layer('component-svelte', 'src/components/**'),
	layer('feature-server', ['src/features/*/server/**', 'src/features/*/server.*'], ['feature']),
	layer('feature-shared', 'src/features/*/shared/**', ['feature']),
	layer(
		'feature-client-astro',
		['src/features/*/client/**/*.astro', 'src/features/*/*.astro'],
		['feature'],
	),
	layer(
		'feature-client',
		['src/features/*/client/**', 'src/features/*/client.*', 'src/features/*/*.svelte'],
		['feature'],
	),
	layer('feature-root', 'src/features/*/**', ['feature']),
	layer('service-worker', 'src/sw.ts'),
	layer('entry', 'src/**'),
	// Setup, factories and end-to-end specs: only specs and other test support may import them.
	layer('test-support', 'tests/**'),
	// The eval set and runner: a tool that drives engines the way the research feature will.
	layer('evals', 'evals/**'),
]

const appLayers = layerFiles.flatMap(({ category }) =>
	category === 'test-support' || category === 'evals' ? [] : [category],
)

function layers(...categories: string[]) {
	return { file: { categories } }
}

/** A layer of the importing file's own feature. */
function own(category: string) {
	return {
		file: { categories: category, captured: { feature: '{{ from.file.captured.feature }}' } },
	}
}

const ownFeature = [own('feature-server'), own('feature-shared'), own('feature-root')]

const policies = [
	// Packages and built-ins are allowed everywhere; the isomorphic rule below narrows that.
	{ allow: { to: { module: { origin: ['external', 'core'] } } } },
	{ from: layers('entry'), allow: { to: layers(...appLayers) } },
	{
		from: layers('feature-server', 'feature-root'),
		allow: { to: [layers('server', 'lib'), ...ownFeature] },
		message: 'feature server code may import only its own feature, server/ and lib/',
	},
	{
		from: layers('feature-client'),
		allow: {
			to: [
				layers('lib', 'component-astro', 'component-svelte'),
				own('feature-shared'),
				own('feature-client'),
				own('feature-client-astro'),
			],
		},
		// Not the feature root: root files are server code, and the browser bundle must not reach it.
		message: 'feature client code may import only its own shared and client, components/ and lib/',
	},
	{
		// Server-rendered .astro ships no JavaScript, so it may also read server/ and its feature's server.
		from: layers('feature-client-astro'),
		allow: {
			to: [
				layers('lib', 'server', 'component-astro', 'component-svelte'),
				...ownFeature,
				own('feature-client'),
				own('feature-client-astro'),
			],
		},
		message: 'feature .astro may import only its own feature, components/, server/ and lib/',
	},
	{
		from: layers('feature-shared'),
		allow: { to: [layers('lib'), own('feature-shared')] },
		message: 'shared/ may import only its own shared/ and lib/',
	},
	{
		// Shared code re-exports server types, type-only.
		from: layers('feature-shared'),
		dependency: { kind: 'type' },
		allow: { to: layers('server') },
	},
	{
		from: layers('component-astro'),
		allow: { to: layers('server', 'lib', 'component-astro', 'component-svelte') },
		message: 'components/*.astro may import only server/, lib/ and components',
	},
	{
		from: layers('component-svelte'),
		allow: { to: layers('lib', 'component-astro', 'component-svelte') },
		message: 'components/*.svelte may import only lib/ and components',
	},
	{
		from: layers('server'),
		allow: { to: layers('server', 'lib') },
		message: 'server/ may import only server/ and lib/',
	},
	{ from: layers('lib'), allow: { to: layers('lib') }, message: 'lib/ may import only lib/' },
	{
		from: layers('service-worker'),
		allow: { to: layers('lib', 'feature-shared') },
		message: 'sw.ts may import only lib/ and feature shared/',
	},
	{
		from: layers('lib', 'feature-shared', 'feature-client', 'component-svelte', 'service-worker'),
		disallow: { to: { module: { source: ['node:*', 'bun:*', 'bun'] } } },
		message: 'isomorphic code must not import runtime built-ins',
	},
	{ from: layers('test-support'), allow: { to: layers(...appLayers, 'test-support') } },
	{
		from: layers('evals'),
		allow: { to: layers('server', 'lib', 'feature-shared', 'evals') },
		message: 'evals/ may import only server/, lib/, feature shared/ and evals/',
	},
	// Specs import `bun:test` and the helpers in tests/, whatever layer they sit in. Later policies win.
	{
		from: layers('test'),
		allow: { to: [{ module: { origin: ['external', 'core'] } }, layers('test-support')] },
	},
]

export default defineConfig({
	...componentConfig,
	settings: {
		// The test category matches first without stopping, so a spec keeps its layer too.
		'boundaries/files': [{ pattern: '**/*.spec.ts', category: 'test' }, ...layerFiles],
		'import/resolver': { typescript: { project: './tsconfig.json' } },
	},
	jsPlugins: [...componentConfig.jsPlugins, 'eslint-plugin-boundaries'],
	overrides: [
		...componentConfig.overrides,
		specOverride([
			'src/**/*.spec.ts',
			'tests/setup/**/*.spec.ts',
			'tests/factories/**/*.spec.ts',
			'evals/**/*.spec.ts',
		]),
		{
			// Playwright has no `it`: e2e specs keep `test`, inside one top-level `test.describe`.
			files: ['tests/e2e/**/*.ts'],
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
		'boundaries/dependencies': ['error', { default: 'disallow', checkAllOrigins: true, policies }],
	},
})
