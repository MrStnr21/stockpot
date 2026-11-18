// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import svelte from '@astrojs/svelte'
import { defineConfig } from 'astro/config'

// The package has no site of its own yet; this config lets `astro check` type-check its components.
export default defineConfig({ integrations: [svelte()] })
