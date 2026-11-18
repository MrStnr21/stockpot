// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { defineConfig } from 'oxlint'

import { scriptConfig, specOverride } from './lint/base.ts'

export default defineConfig({ ...scriptConfig, overrides: [specOverride(['**/*.spec.ts'])] })
