#!/usr/bin/env bun
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * Oxlint's type-aware backend: every lint script points OXLINT_TSGOLINT_PATH here. The launcher that
 * ships with tsrs touches `process.stdout` before it starts the native binary; under `bunx --bun` that
 * leaves the inherited pipe non-blocking, and the binary exits 1 without output once a run writes more
 * than the 64 KB pipe buffer. Replacing this process with the binary keeps stdio as oxlint opened it.
 */
import { argv, fileURLToPath } from 'bun'
import { dirname, join } from 'node:path'
import * as v from 'valibot'

const tsrsRoot = dirname(fileURLToPath(import.meta.resolve('tsrs/package.json')))

// The per-platform binary lookup (including the TSRS_BINARY override) is internal to tsrs, not an export.
const lookup = v.parse(
	v.object({ default: v.function() }),
	await import(join(tsrsRoot, 'lib/getExePath.js')),
)

const binary = v.parse(v.string(), lookup.default())

// Bun implements `process.execve`; Node typings mark it optional because Windows lacks it.
if (process.execve === undefined) {
	throw new Error(
		'process.execve is unavailable: run the lint scripts on Bun under macOS or Linux.',
	)
}

process.execve(binary, [binary, '--lint', ...argv.slice(2)])
