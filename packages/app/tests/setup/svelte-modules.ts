// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Lets specs import `.svelte.ts` modules, such as the capture sheet's controller: Bun strips the
 * types, then the Svelte compiler turns the runes into its client runtime, as Vite does for the app.
 */
import { file, plugin, Transpiler } from 'bun'

const typescript = new Transpiler({ loader: 'ts' })

plugin({
	name: 'svelte runes modules',
	setup(build) {
		build.onLoad({ filter: /\.svelte\.ts$/u }, async ({ path }) => {
			const { compileModule } = await import('svelte/compiler')
			const source = typescript.transformSync(await file(path).text())
			const { js } = compileModule(source, { filename: path, generate: 'client' })

			return { contents: js.code, loader: 'js' }
		})
	},
})
