// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { astro, combine, config, sortImports, svelte, tailwind } from '@configg/bases/prettier'

export default combine(
	config,
	sortImports,
	astro,
	svelte,
	tailwind({ tailwindStylesheet: './src/main.css' }),
)
