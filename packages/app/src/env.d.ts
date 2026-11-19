// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Owner } from '#/server/policy'

declare global {
	namespace App {
		interface Locals {
			/**
			 * The signed-in owner and how they signed in (a session or a device token), set by
			 * src/middleware.ts on every request; `null` when nobody is.
			 */
			owner: Owner | null
		}
	}
}
