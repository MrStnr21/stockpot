<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button } from '@stockpot/ui/button'
	import { Icon } from '@stockpot/ui/icon'
	import { Badge } from '@stockpot/ui/status-badge'

	import type { SettingsMessages } from '#/lib/i18n/settings-en'

	interface Props {
		/** The Shortcut's install link: `null` until it is published (CAP-5). */
		installUrl: string | null
		strings: SettingsMessages['shortcut']
	}

	const { installUrl, strings }: Props = $props()

	const id = $props.id()
</script>

<!-- DES-5 390-08 "Shortcut": what it does, and the install link once there is one. -->
<article
	aria-labelledby={`${id}-name`}
	class="flex flex-col gap-2.5 rounded-lg border border-line bg-surface px-4 py-3.5 font-ui"
>
	<div class="flex items-center gap-2.5">
		<span class="grid size-9 shrink-0 place-items-center rounded-xs bg-fill text-ink-2">
			<Icon name="bolt" class="size-5" />
		</span>
		<h2 id={`${id}-name`} class="min-w-0 flex-1 text-title-s">{strings.name}</h2>
		{#if installUrl === null}
			<Badge>{strings.notAvailable}</Badge>
		{/if}
	</div>
	<p class="text-body-compact text-ink-2">{strings.text}</p>
	{#if installUrl !== null}
		<Button
			size="sm"
			icon="external"
			class="self-start"
			href={installUrl}
			target="_blank"
			rel="noopener noreferrer"
		>
			{strings.install}
		</Button>
	{/if}
</article>
