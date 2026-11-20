// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $ } from 'bun'
import { dirname, join } from 'node:path'
import node from '@astrojs/node'
import svelte from '@astrojs/svelte'
import tailwindcss from '@tailwindcss/vite'
import type { AstroIntegration } from 'astro'
import { defineConfig } from 'astro/config'

// The Node adapter's server entry: the module the built server starts from.
const adapterEntry = '@astrojs/node/server.js'

/*
 * Imports src/boot.ts from the adapter's server entry, so the built server runs it on start;
 * Astro would otherwise load the code behind a request only when the first one arrives. An absolute
 * path, because a `#/` import resolves against the importer's package, here the adapter's. When the
 * entry is never seen, as after an adapter upgrade that renames it, the server build fails.
 */
function boot(): AstroIntegration {
	const bootModule = join(import.meta.dirname, 'src/boot.ts')
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
											`stockpot:boot found no ${adapterEntry} in the server build, so src/boot.ts would not run at startup. Update adapterEntry in astro.config.ts.`,
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

/*
 * Copies the SQL migrations next to the server chunk that holds src/server/db/instance.ts, which
 * looks for them in its own folder: the source folder in dev and specs, the chunk's folder in the
 * build. When no chunk holds that module, the server build fails instead of a server that cannot
 * migrate its database.
 */
function migrations(): AstroIntegration {
	const instanceModule = join(import.meta.dirname, 'src/server/db/instance.ts')
	const migrationsFolder = join(import.meta.dirname, 'src/server/db/migrations')

	return {
		name: 'stockpot:migrations',
		hooks: {
			'astro:config:setup': ({ command, updateConfig }) => {
				if (command !== 'build') {
					return
				}

				updateConfig({
					vite: {
						plugins: [
							{
								name: 'stockpot:migrations',
								applyToEnvironment: (environment) => environment.name === 'ssr',
								async writeBundle(options, bundle) {
									const folders = Object.values(bundle).flatMap((output) =>
										output.type === 'chunk' && output.moduleIds.includes(instanceModule)
											? [join(options.dir ?? '', dirname(output.fileName), 'migrations')]
											: [],
									)

									if (folders.length === 0) {
										this.error(
											'stockpot:migrations found no server chunk with src/server/db/instance.ts, so the server could not find its migrations.',
										)
									}

									await Promise.all(
										folders.map(
											async (folder) => $`rm -rf ${folder} && cp -R ${migrationsFolder} ${folder}`,
										),
									)
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
	integrations: [svelte(), boot(), migrations()],
	vite: {
		plugins: [tailwindcss()],
		// The UI package ships Svelte and TypeScript source, so the server build compiles it instead of externalizing it.
		ssr: { noExternal: ['@stockpot/ui'] },
	},
})
