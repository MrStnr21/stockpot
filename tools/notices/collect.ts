// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { CryptoHasher, file, Glob } from 'bun'
import { dirname, join } from 'node:path'
import * as v from 'valibot'

const licenseObject = v.pipe(
	v.object({ type: v.string() }),
	v.transform(({ type }) => type),
)

const strings = v.array(v.string())

const licenseField = v.union([v.string(), licenseObject])

const licenseList = v.array(licenseObject)

const ranges = v.record(v.string(), v.string())

// The licence becomes one SPDX string here, whichever of the old or new shapes the manifest uses.
const manifest = v.object({
	name: v.string(),
	version: v.string(),
	license: v.optional(licenseField),
	// Old manifests list licences in an array instead.
	licenses: v.optional(licenseList),
	dependencies: v.optional(ranges),
	os: v.optional(strings),
	cpu: v.optional(strings),
})

type Manifest = v.InferOutput<typeof manifest>

export interface Dependency {
	name: string
	version: string
	license: string
	licenseText: string | null
	noticeText: string | null
}

async function readManifest(directory: string): Promise<Manifest> {
	return v.parse(manifest, await file(join(directory, 'package.json')).json())
}

function licenseOf(pkg: Manifest): string {
	return pkg.license ?? pkg.licenses?.join(' OR ') ?? 'UNKNOWN'
}

/** Node's lookup: `node_modules/<name>` in the requiring package's folder, then in each parent up to `root`. */
async function locate(name: string, from: string, root: string): Promise<string> {
	let directory = from

	for (;;) {
		const candidate = join(directory, 'node_modules', name)

		// oxlint-disable-next-line eslint/no-await-in-loop -- Each step depends on the previous one.
		if (await file(join(candidate, 'package.json')).exists()) {
			return candidate
		}

		if (directory === root || directory === dirname(directory)) {
			throw new Error(`Cannot find ${name} from ${from}: run bun install first.`)
		}

		directory = dirname(directory)
	}
}

async function readText(directory: string, pattern: RegExp): Promise<string | null> {
	const entries = await Array.fromAsync(new Glob('*').scan({ cwd: directory, onlyFiles: true }))
	const match = entries.toSorted().find((entry) => pattern.test(entry))

	return match === undefined ? null : file(join(directory, match)).text()
}

function productionDependencies(pkg: Manifest): string[] {
	return Object.entries(pkg.dependencies ?? {})
		.filter(([, range]) => !range.startsWith('workspace:'))
		.map(([name]) => name)
}

/**
 * Every package the workspaces in `workspaceDirectories` need at run time, transitively, deduplicated
 * by name and version. Only `dependencies` count: platform builds come in as optional dependencies and
 * differ between machines, so the generated file would too.
 */
export async function collectDependencies(
	root: string,
	workspaceDirectories: string[],
): Promise<Dependency[]> {
	const seen = new Map<string, Dependency>()
	let queue: { name: string; from: string }[] = []

	for (const directory of workspaceDirectories) {
		// oxlint-disable-next-line eslint/no-await-in-loop -- A handful of workspaces.
		const pkg = await readManifest(directory)

		queue.push(...productionDependencies(pkg).map((name) => ({ name, from: directory })))
	}

	while (queue.length > 0) {
		// oxlint-disable-next-line eslint/no-await-in-loop -- Breadth-first: each level needs the previous one.
		const level = await Promise.all(
			queue.map(async ({ name, from }) => {
				const directory = await locate(name, from, root)

				return { directory, pkg: await readManifest(directory) }
			}),
		)

		queue = []

		for (const { directory, pkg } of level) {
			const key = `${pkg.name}@${pkg.version}`

			if (!seen.has(key) && pkg.os === undefined && pkg.cpu === undefined) {
				seen.set(key, {
					name: pkg.name,
					version: pkg.version,
					license: licenseOf(pkg),
					// oxlint-disable-next-line eslint/no-await-in-loop -- Reads are cheap; order keeps output stable.
					licenseText: await readText(directory, /^(?:licen[cs]e|copying)/iu),
					// oxlint-disable-next-line eslint/no-await-in-loop -- As above.
					noticeText: await readText(directory, /^notice/iu),
				})
				queue.push(...productionDependencies(pkg).map((name) => ({ name, from: directory })))
			}
		}
	}

	return [...seen.values()].toSorted(
		(a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
	)
}

const fontManifest = v.object({
	name: v.string(),
	version: v.string(),
	license: v.string(),
	source: v.string(),
	files: v.record(v.string(), v.string()),
})

export interface Font {
	name: string
	version: string
	license: string
	source: string
	licenseText: string | null
}

async function sha256(path: string): Promise<string> {
	return new CryptoHasher('sha256').update(await file(path).bytes()).digest('hex')
}

/**
 * The fonts vendored under `directory`, one folder each with a `font.json`. A listed file whose SHA-256
 * differs from the recorded one fails, so a modified font cannot ship unnoticed.
 */
export async function collectFonts(directory: string): Promise<Font[]> {
	const manifests = await Array.fromAsync(
		new Glob('*/font.json').scan({ cwd: directory, onlyFiles: true }),
	)

	const fonts = await Promise.all(
		manifests.toSorted().map(async (manifestPath) => {
			const folder = join(directory, dirname(manifestPath))
			const font = v.parse(fontManifest, await file(join(directory, manifestPath)).json())

			const mismatches = await Promise.all(
				Object.entries(font.files).map(async ([name, expected]) => {
					const exists = await file(join(folder, name)).exists()

					return !exists || (await sha256(join(folder, name))) !== expected ? name : null
				}),
			)

			const modified = mismatches.filter((name) => name !== null)

			if (modified.length > 0) {
				throw new Error(
					`${font.name}: ${modified.join(', ')} missing or differs from the SHA-256 in font.json. Fonts ship unmodified.`,
				)
			}

			return {
				name: font.name,
				version: font.version,
				license: font.license,
				source: font.source,
				licenseText: await readText(folder, /^ofl/iu),
			}
		}),
	)

	return fonts.toSorted((a, b) => a.name.localeCompare(b.name))
}
