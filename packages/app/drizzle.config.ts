// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { defineConfig } from 'drizzle-kit'

// `bun run db:generate -- --name <what-changed>` writes the next migration folder into `out`.
export default defineConfig({
	dialect: 'sqlite',
	schema: './src/server/db/schema',
	out: './src/server/db/migrations',
})
