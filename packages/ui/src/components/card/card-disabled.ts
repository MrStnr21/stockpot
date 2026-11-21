// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { createContext } from 'svelte'

const [getCardDisabled, setCardDisabled, hasCardDisabled] = createContext<() => boolean>()

export { setCardDisabled }

/* Keep the card text readable while preventing activation of its sources and actions. */
export function useCardDisabled(): () => boolean {
	return hasCardDisabled() ? getCardDisabled() : () => false
}
