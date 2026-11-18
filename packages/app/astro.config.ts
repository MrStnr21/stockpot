// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import node from '@astrojs/node'
import svelte from '@astrojs/svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

export default defineConfig({
	output: 'server',
	adapter: node({ mode: 'standalone' }),
	server: { port: 4321 },
	integrations: [svelte()],
	vite: {
		plugins: [tailwindcss()],
		// The UI package ships Svelte and TypeScript source, so the server build compiles it instead of externalizing it.
		ssr: { noExternal: ['@stockpot/ui'] },
	},
})
