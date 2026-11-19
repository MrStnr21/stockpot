// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { $ } from 'bun'
import type { FullConfig } from '@playwright/test'

/** Removes the data directory that playwright.config.ts made for the shared server of this run. */
export default async function globalTeardown(config: FullConfig): Promise<void> {
	const dataDir = config.webServer?.env?.STOCKPOT_DATA_DIR

	if (dataDir !== undefined) {
		await $`rm -rf ${dataDir}`
	}
}
