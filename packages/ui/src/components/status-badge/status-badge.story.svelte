<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { ComponentProps } from 'svelte'

	import SchemePanels from '../../book/scheme-panels.svelte'
	import Badge from './badge.svelte'
	import FlagBadge from './flag-badge.svelte'
	import StatusBadge from './status-badge.svelte'

	interface Props {
		group: 'statuses' | 'flags' | 'neutral'
	}

	const { group }: Props = $props()

	const statuses = [
		['new', 'New'],
		['queued', 'Queued'],
		['researching', 'Researching'],
		['ready', 'Ready'],
		['read', 'Read'],
		['archived', 'Archived'],
		['failed', 'Failed'],
	] as const satisfies readonly (readonly [ComponentProps<typeof StatusBadge>['status'], string])[]

	const flags = [
		['draft', 'Draft'],
		['unsure', 'Unsure'],
	] as const satisfies readonly (readonly [ComponentProps<typeof FlagBadge>['flag'], string])[]
</script>

<SchemePanels>
	<ul class="flex flex-wrap items-center gap-2.5">
		{#if group === 'statuses'}
			{#each statuses as [status, label] (status)}
				<li><StatusBadge {status}>{label}</StatusBadge></li>
			{/each}
		{:else if group === 'flags'}
			{#each flags as [flag, label] (flag)}
				<li><FlagBadge {flag}>{label}</FlagBadge></li>
			{/each}
		{:else}
			<li><Badge icon="lock">Private</Badge></li>
			<li><Badge>Easy</Badge></li>
			<li><Badge>Medium</Badge></li>
			<li><Badge>Hard</Badge></li>
		{/if}
	</ul>
</SchemePanels>
