// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/* The opened card's action bar: each action's label, icon and tone, and whether it takes a press. */
import type { CardMessages } from '#/lib/i18n/card-en'

import type { CardAction } from './card-actions'
import type { ActionKey, ActionView, CardLayout } from './card-panel'

export interface ActionControl {
	readonly key: ActionKey
	readonly label: string
	readonly icon: 'check' | 'deeper' | 'bookmark' | 'plus' | 'trash'
	readonly tone: 'default' | 'accent'
	readonly disabled: boolean
	readonly action: CardAction | null
}

function actionControl(
	{ key, disabled: refused, pressed }: ActionView,
	{ strings, canAct }: { strings: CardMessages; canAct: boolean },
): ActionControl {
	const disabled = refused || !canAct

	switch (key) {
		case 'got': {
			return {
				key,
				label: strings.got,
				icon: 'check',
				tone: 'accent',
				disabled,
				action: { kind: 'got' },
			}
		}

		case 'deeper': {
			return {
				key,
				label: strings.deeper,
				icon: 'deeper',
				tone: 'default',
				disabled,
				action: { kind: 'deeper' },
			}
		}

		case 'keep': {
			const label = pressed ? strings.kept : strings.keep

			return {
				key,
				label,
				icon: 'bookmark',
				tone: pressed ? 'accent' : 'default',
				disabled,
				action: { kind: 'keep' },
			}
		}

		case 'notion': {
			const label = pressed ? strings.inNotion : strings.notion

			return {
				key,
				label,
				icon: pressed ? 'check' : 'plus',
				tone: 'default',
				disabled: true,
				action: null,
			}
		}

		case 'delete': {
			return {
				key,
				label: strings.delete,
				icon: 'trash',
				tone: 'default',
				disabled,
				action: { kind: 'delete' },
			}
		}

		default: {
			throw new Error('The card has no such action.')
		}
	}
}

/** The action bar's buttons; every one waits while an action runs. */
export function actionControls(
	layout: CardLayout,
	strings: CardMessages,
	canAct: boolean,
): ActionControl[] {
	return (layout.actions ?? []).map((view) => actionControl(view, { strings, canAct }))
}
