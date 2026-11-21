// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import svelte from '@astrojs/svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'
import astrobook from 'astrobook'

export default defineConfig({
	integrations: [
		svelte(),
		astrobook({ directory: 'src', css: ['./src/book/book.css'], head: './src/book/head.astro' }),
	],
	vite: { plugins: [tailwindcss()] },
})
