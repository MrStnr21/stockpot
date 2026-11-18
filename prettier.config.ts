// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { combine, config } from '@configg/bases/prettier'

// Root files only (documentation, workflows, manifests); every workspace formats itself.
export default combine(config({ overrides: [{ files: '*.md', options: { useTabs: false } }] }))
