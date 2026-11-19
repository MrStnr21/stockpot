// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { join } from 'node:path'
import node from '@astrojs/node'
import svelte from '@astrojs/svelte'
import tailwindcss from '@tailwindcss/vite'
import type { AstroIntegration } from 'astro'
import { defineConfig } from 'astro/config'

// The Node adapter's server entry: the module the built server starts from.
const adapterEntry = '@astrojs/node/server.js'

/*
 * Imports src/server/boot.ts from the adapter's server entry, so the built server runs it on start;
 * Astro would otherwise load the code behind a request only when the first one arrives. An absolute
 * path, because a `#/` import resolves against the importer's package, here the adapter's. When the
 * entry is never seen, as after an adapter upgrade that renames it, the server build fails.
 */
function boot(): AstroIntegration {
	const bootModule = join(import.meta.dirname, 'src/server/boot.ts')
	let entryId: string | null = null
	let isInjected = false

	return {
		name: 'stockpot:boot',
		hooks: {
			'astro:config:setup': ({ command, updateConfig }) => {
				if (command !== 'build') {
					return
				}

				updateConfig({
					vite: {
						plugins: [
							{
								name: 'stockpot:boot',
								applyToEnvironment: (environment) => environment.name === 'ssr',
								async buildStart() {
									// A missing export reaches buildEnd as "never seen", with the message below.
									entryId = await this.resolve(adapterEntry).then(
										(resolved) => resolved?.id ?? null,
										() => null,
									)
								},
								transform(code, id) {
									if (id !== entryId) {
										return null
									}

									isInjected = true

									return { code: `import ${JSON.stringify(bootModule)};\n${code}`, map: null }
								},
								buildEnd(error) {
									if (error === undefined && !isInjected) {
										this.error(
											`stockpot:boot found no ${adapterEntry} in the server build, so src/server/boot.ts would not run at startup. Update adapterEntry in astro.config.ts.`,
										)
									}
								},
							},
						],
					},
				})
			},
		},
	}
}

export default defineConfig({
	output: 'server',
	// The backstop for every body; API routes read theirs through readJson with a tighter limit.
	adapter: node({ mode: 'standalone', bodySizeLimit: 1024 * 1024 }),
	server: { port: 4321 },
	security: {
		/* Cross-site requests are refused in src/middleware.ts instead. Without `allowedDomains`, fixed
		 * at build time, Astro compares Origin with a URL whose host is always localhost, so on plain
		 * HTTP to a LAN or tailnet name, where browsers send no Sec-Fetch-Site, it refuses the owner's
		 * own form posts. The middleware compares with STOCKPOT_PUBLIC_ORIGIN, read at runtime. */
		checkOrigin: false,
	},
	integrations: [svelte(), boot()],
	vite: {
		plugins: [tailwindcss()],
		// The UI package ships Svelte and TypeScript source, so the server build compiles it instead of externalizing it.
		ssr: { noExternal: ['@stockpot/ui'] },
	},
})
