<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'

	import { Icon, type IconName } from '../icon'

	interface Props {
		icon: IconName
		title: string
		children: Snippet
		action?: Snippet
	}

	const { icon, title, children, action }: Props = $props()
</script>

<div class="flex flex-col items-center gap-3 px-6 py-8 text-center">
	<span class="mb-1 grid size-18 place-items-center rounded-full bg-accent-soft text-accent-ink">
		<Icon name={icon} size={32} />
	</span>
	<h3 class="font-read text-subheading wrap-anywhere text-ink">{title}</h3>
	<p class="max-w-70 font-ui text-body-compact/5.5 wrap-anywhere text-ink-2">
		{@render children()}
	</p>
	{#if action}
		<div class="mt-2">{@render action()}</div>
	{/if}
</div>
