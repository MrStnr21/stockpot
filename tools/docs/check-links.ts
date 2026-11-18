// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Checks every relative link and #anchor in the tracked Markdown files, so a moved file or a renamed
 * heading fails CI instead of reaching readers. Targets are matched against the tracked files rather
 * than the disk, so an untracked file or a path in the wrong case fails here as it would on GitHub.
 * Web and mail links are left alone: checking them would make the run slow and dependent on the network.
 */
import { $, file } from 'bun'
import { posix } from 'node:path'

export interface BrokenLink {
	source: string
	line: number
	target: string
	reason: string
}

interface Link {
	line: number
	target: string
}

const fence = /^\s*(?<marker>`{3,}|~{3,})/u

const codeSpan = /(?<!`)(?<ticks>`+)(?!`)[\s\S]*?(?<!`)\k<ticks>(?!`)/gu

const inlineLink = /\[(?:[^[\]]|\[[^\]]*\])*\]\(\s*(?<target><[^>]*>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/gu

const referenceDefinition = /^ {0,3}\[(?!\^)[^\]]+\]:\s*(?<target><[^>]*>|\S+)/gmu

const htmlLink = /<(?:a|img)\s[^>]*?(?:href|src)=(?<quote>["'])(?<target>.*?)\k<quote>/gu

const htmlAnchor = /<a\s[^>]*?(?:id|name)=(?<quote>["'])(?<id>.+?)\k<quote>/gu

const heading = /^ {0,3}#{1,6}\s+(?<title>.*?)(?:\s+#+)?\s*$/u

const ignoredScheme = /^(?:https?|mailto):/iu

/** Blanks fenced code blocks line by line, so line numbers stay true and code is never read as Markdown. */
function withoutFencedCode(markdown: string) {
	const lines = markdown.split('\n')
	let open = ''

	for (const [index, line] of lines.entries()) {
		const marker = fence.exec(line)?.groups?.marker ?? ''

		if (open === '' && marker === '') {
			continue
		}

		if (open === '') {
			open = marker
		} else if (marker.startsWith(open)) {
			open = ''
		}

		lines[index] = ''
	}

	return lines.join('\n')
}

// Spaces keep every offset, so a match index still maps to the right line.
function withoutCodeSpans(markdown: string) {
	return markdown.replaceAll(codeSpan, (span) => span.replaceAll(/[^\n]/gu, ' '))
}

/*
 * GitHub's heading slugs (github-slugger): the rendered text in lower case, with everything except
 * letters, marks, numbers, underscores, hyphens and spaces removed, and each space turned into a
 * hyphen. Repeats get -1, -2 and so on, which anchorsOf adds.
 */
function slug(title: string) {
	const rendered = title
		.replaceAll(/!?\[(?<text>[^\]]*)\]\([^)]*\)/gu, '$<text>')
		.replaceAll(/<[^>]+>/gu, '')
		.replaceAll(
			/(?<![\p{L}\p{N}])_{1,2}(?=\S)(?<text>.+?)(?<=\S)_{1,2}(?![\p{L}\p{N}])/gu,
			'$<text>',
		)

	return rendered
		.toLowerCase()
		.replaceAll(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
		.replaceAll(' ', '-')
}

function anchorsOf(markdown: string) {
	const text = withoutFencedCode(markdown)
	const anchors = new Set<string>()
	const repeats = new Map<string, number>()

	for (const line of text.split('\n')) {
		const title = heading.exec(line)?.groups?.title

		if (title !== undefined) {
			const base = slug(title)
			const count = repeats.get(base) ?? 0

			repeats.set(base, count + 1)
			anchors.add(count === 0 ? base : `${base}-${count}`)
		}
	}

	for (const match of text.matchAll(htmlAnchor)) {
		anchors.add(match.groups?.id ?? '')
	}

	return anchors
}

function linksOf(markdown: string): Link[] {
	const text = withoutCodeSpans(withoutFencedCode(markdown))

	const matches = [
		...text.matchAll(inlineLink),
		...text.matchAll(referenceDefinition),
		...text.matchAll(htmlLink),
	]

	return matches
		.toSorted((first, second) => first.index - second.index)
		.flatMap((match) => {
			const target = (match.groups?.target ?? '').replace(/^<(?<inner>.*)>$/u, '$<inner>')
			const line = text.slice(0, match.index).split('\n').length

			return target === '' || ignoredScheme.test(target) ? [] : [{ line, target }]
		})
}

function decoded(text: string) {
	try {
		return decodeURIComponent(text)
	} catch {
		return text
	}
}

/** The repository path a link points at ('.' for the root), or '' for a heading on the same page. */
function resolvedPath(source: string, target: string) {
	const [path = ''] = target.split(/[#?]/u, 1)

	if (path === '') {
		return ''
	}

	const fromRoot = path.startsWith('/')
	const joined = fromRoot ? `./${path.slice(1)}` : posix.join(posix.dirname(source), path)

	return posix.normalize(decoded(joined)).replace(/(?<=.)\/$/u, '')
}

/** Every folder that holds a tracked file, with '.' for the repository root. */
function foldersOf(files: ReadonlySet<string>) {
	const folders = new Set(['.'])

	for (const path of files) {
		for (let folder = posix.dirname(path); folder !== '.'; folder = posix.dirname(folder)) {
			folders.add(folder)
		}
	}

	return folders
}

/**
 * Finds the links in `documents` (repository path to Markdown text) whose file or heading does not
 * exist. `files` holds every tracked path: a target must be one of them, or a folder that holds one,
 * with the same case. Headings are checked only in the given documents, and an anchor on a link to a
 * folder is looked up in that folder's README.md, which is what GitHub shows there.
 */
export function findBrokenLinks(
	documents: ReadonlyMap<string, string>,
	files: ReadonlySet<string>,
): BrokenLink[] {
	const folders = foldersOf(files)
	const anchors = new Map([...documents].map(([path, markdown]) => [path, anchorsOf(markdown)]))

	function reasonFor(source: string, target: string, path: string) {
		if (path.startsWith('../')) {
			return 'points outside the repository'
		}

		const isFolder = folders.has(path)

		if (path !== '' && !isFolder && !files.has(path)) {
			return 'not a tracked file or folder'
		}

		const [, anchor = ''] = target.split('#', 2)
		const readme = posix.join(path, 'README.md')

		if (anchor !== '' && isFolder && !documents.has(readme)) {
			return `no README.md in ${path} for #${anchor}`
		}

		const linked = isFolder ? readme : path
		const page = path === '' ? source : linked

		if (anchor !== '' && anchors.get(page)?.has(decoded(anchor)) === false) {
			return `no heading or anchor #${anchor} in ${page}`
		}

		return ''
	}

	return [...documents].flatMap(([source, markdown]) =>
		linksOf(markdown).flatMap(({ line, target }) => {
			const reason = reasonFor(source, target, resolvedPath(source, target))

			return reason === '' ? [] : [{ source, line, target, reason }]
		}),
	)
}

async function main() {
	const root = posix.join(import.meta.dir, '../..')
	const tracked = await $`git ls-files -z`.cwd(root).text()
	// A file deleted from the working tree stays listed until the deletion is staged.
	const deleted = await $`git ls-files -z --deleted`.cwd(root).text()
	const gone = new Set(deleted.split('\0'))
	const files = new Set(tracked.split('\0').filter((path) => path !== '' && !gone.has(path)))
	const markdownPaths = [...files].filter((path) => path.endsWith('.md'))

	const texts = await Promise.all(
		markdownPaths.map(async (path) => file(posix.join(root, path)).text()),
	)

	const documents = new Map(markdownPaths.map((path, index) => [path, texts[index] ?? '']))
	const broken = findBrokenLinks(documents, files)

	if (broken.length === 0) {
		console.log(`Links in ${documents.size} Markdown files resolve.`)

		return
	}

	const lines = broken.map(
		({ source, line, target, reason }) => `${source}:${line}: ${target} (${reason})`,
	)

	console.error(`${lines.join('\n')}\n\n${broken.length} broken link(s).`)
	process.exit(1)
}

if (import.meta.main) {
	await main()
}
