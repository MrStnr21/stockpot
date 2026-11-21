<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { ComponentProps } from 'svelte'

	import SchemePanels from '../../book/scheme-panels.svelte'
	import StatusBadge from './status-badge.svelte'

	const statuses = [
		['new', 'New'],
		['queued', 'Queued'],
		['researching', 'Researching'],
		['ready', 'Ready'],
		['read', 'Read'],
		['archived', 'Archived'],
	] as const satisfies readonly (readonly [ComponentProps<typeof StatusBadge>['status'], string])[]
</script>

<SchemePanels>
	<ul class="flex flex-wrap items-center gap-2.5">
		{#each statuses as [status, label] (status)}
			<li><StatusBadge {status}>{label}</StatusBadge></li>
		{/each}
	</ul>
</SchemePanels>
