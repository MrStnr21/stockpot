<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'

	import { Icon } from '../icon'
	import { Spinner } from '../spinner'

	interface Props {
		status: 'new' | 'queued' | 'researching' | 'ready' | 'read' | 'archived' | 'failed'
		children: Snippet
		class?: string
	}

	const { status, children, class: className }: Props = $props()

	const icon = { read: 'check', archived: 'archive', failed: 'alert' } as const
</script>

<span
	data-status={status}
	class={[
		'group/badge inline-flex h-5.5 items-center gap-1.5 rounded-xs border border-transparent bg-fill px-2 font-ui text-caption font-semibold tracking-normal whitespace-nowrap text-ink-2 data-[status=archived]:border-line-strong data-[status=archived]:bg-transparent data-[status=archived]:text-ink-3 data-[status=failed]:bg-danger-soft data-[status=failed]:text-danger-ink data-[status=new]:bg-accent-soft data-[status=new]:text-accent-ink data-[status=ready]:bg-accent data-[status=ready]:text-on-accent data-[status=researching]:bg-accent-soft data-[status=researching]:text-accent-ink',
		className,
	]}
>
	{#if status === 'researching'}
		<Spinner size="sm" />
	{:else if status === 'read' || status === 'archived' || status === 'failed'}
		<Icon
			name={icon[status]}
			size={16}
			class="size-3 [stroke-width:var(--stroke-width-status-icon)]"
		/>
	{:else}
		<span
			aria-hidden="true"
			class="size-1.5 shrink-0 rounded-full bg-current group-data-[status=queued]/badge:bg-transparent group-data-[status=queued]/badge:inset-shadow-status-queued"
		></span>
	{/if}
	{@render children()}
</span>
