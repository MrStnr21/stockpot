<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'

	import { Icon } from '../icon'
	import { useCardDisabled } from './card-disabled'

	interface Props {
		children: Snippet
		href: string
	}

	const { children, href }: Props = $props()

	const cardDisabled = useCardDisabled()

	const disabled = $derived(cardDisabled())
</script>

<a
	href={disabled ? undefined : href}
	role={disabled ? 'link' : undefined}
	aria-disabled={disabled || undefined}
	rel="noopener noreferrer"
	target="_blank"
	class="inline-flex min-h-11 max-w-full min-w-11 items-center gap-1.5 rounded-xs font-ui text-body-s font-medium wrap-anywhere text-accent-ink outline-focus focus-visible:outline-2 focus-visible:outline-offset-2 aria-disabled:text-ink-disabled"
>
	<Icon name="external" size={16} />
	<span>{@render children()}</span>
</a>
