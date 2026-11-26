// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $, build, CryptoHasher, file, Glob, write } from 'bun'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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

/*
 * A file's bytes for the worker's version. The server entry carries a session key that Astro draws
 * anew on every build, which would make identical builds differ, so the key is blanked first.
 */
async function fingerprintBytes(path: string): Promise<Uint8Array> {
	if (!path.endsWith('/server/entry.mjs')) {
		return file(path).bytes()
	}

	const text = await file(path).text()

	return new TextEncoder().encode(text.replace(/"key":"[^"]*"/u, '"key":""'))
}

/*
 * Writes dist/client/sw.js: src/sw.ts bundled for the browser, with PRECACHE (every file of the
 * build, plus the offline page) and VERSION (a hash of the files' names and contents, and of the
 * server's) defined in. A build with changed assets or server output therefore changes sw.js, which
 * is what makes browsers update the worker; the server's output counts because the stored offline
 * page is rendered by it and would go stale on a markup-only change. The icon's SVG source is left
 * out, as nothing loads it. A failed bundle fails the build.
 */
function serviceWorker(): AstroIntegration {
	return {
		name: 'stockpot:service-worker',
		hooks: {
			'astro:build:done': async ({ dir }) => {
				const root = fileURLToPath(dir)
				const unused = new Set(['sw.js', 'icons/icon.svg'])

				const files = await Array.fromAsync(new Glob('**/*').scan({ cwd: root }))
				const paths = files.filter((path) => !unused.has(path)).toSorted()

				const serverRoot = join(root, '../server')
				const serverFiles = await Array.fromAsync(new Glob('**/*').scan({ cwd: serverRoot }))

				const hasher = new CryptoHasher('sha256')

				for (const [base, list] of [
					[root, paths],
					[serverRoot, serverFiles.toSorted()],
				] as const) {
					for (const path of list) {
						// oxlint-disable-next-line eslint/no-await-in-loop -- A few dozen files, hashed in a stable order.
						hasher.update(`${path}\0`).update(await fingerprintBytes(join(base, path)))
					}
				}

				const result = await build({
					entrypoints: [join(import.meta.dirname, 'src/sw.ts')],
					target: 'browser',
					minify: true,
					define: {
						PRECACHE: JSON.stringify([...paths.map((path) => `/${path}`), '/offline']),
						VERSION: JSON.stringify(hasher.digest('hex').slice(0, 16)),
					},
				})

				const output = result.outputs.at(0)

				if (!result.success || output === undefined) {
					const logs = result.logs.map((log) => log.message).join('\n')

					throw new Error(`stockpot:service-worker could not bundle src/sw.ts:\n${logs}`)
				}

				await write(join(root, 'sw.js'), output)
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
	integrations: [svelte(), boot(), migrations(), serviceWorker()],
	vite: {
		plugins: [tailwindcss()],
		// The UI package ships Svelte and TypeScript source, so the server build compiles it instead of externalizing it.
		ssr: { noExternal: ['@stockpot/ui'] },
	},
})
