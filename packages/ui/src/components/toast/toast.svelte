<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'

	import { Icon } from '../icon'
	import { Spinner } from '../spinner'

	interface Props {
		tone?: 'default' | 'loading' | 'ready' | 'error'
		children: Snippet
		action?: Snippet
	}

	const { tone = 'default', children, action }: Props = $props()

	const icons = { default: 'check', ready: 'bell', error: 'retry' } as const
</script>

<div
	data-tone={tone}
	class="flex min-h-13 min-w-0 items-center gap-3 rounded-lg bg-inverse py-1 pr-1.5 pl-4 font-ui text-body-compact font-medium text-on-inverse shadow-(--shadow-toast)"
>
	{#if tone === 'loading'}
		<Spinner class="text-inverse-accent" />
	{:else}
		<Icon name={icons[tone]} class="size-5 text-inverse-accent" />
	{/if}
	<span
		role={tone === 'error' ? 'alert' : 'status'}
		aria-busy={tone === 'loading' || undefined}
		class="min-w-0 flex-1 wrap-anywhere"
	>
		{@render children()}
	</span>
	{@render action?.()}
</div>
