// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import packageJson from '../../package.json' with { type: 'json' }

/** The app's version, as its package.json states it; the About section shows it. */
export const appVersion: string = packageJson.version
