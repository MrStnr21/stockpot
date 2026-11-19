// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { instanceAuth } from '#/server/auth'
import { route } from '#/server/http'

/** The sign-out form posts here; a visitor who is signed out already lands on sign-in all the same. */
export const POST = route.public(async (context) => {
	const auth = await instanceAuth()

	auth.signOut(context)

	return context.redirect('/signin', 303)
})
