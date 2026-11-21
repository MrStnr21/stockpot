<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import SchemePanels from '../../book/scheme-panels.svelte'
	import { Card, CardTop } from '../card'
	import Skeleton from './skeleton.svelte'

	interface Props {
		group: 'shapes' | 'card-loading'
	}

	const { group }: Props = $props()
</script>

<SchemePanels>
	<div class="grid gap-2">
		<p class="text-caption text-ink-3">{group === 'shapes' ? 'Shapes' : 'Card loading'}</p>
		{#if group === 'shapes'}
			<div class="flex max-w-(--spacing-kit-example) flex-wrap items-center gap-3">
				<Skeleton class="h-3.5 w-30" />
				<Skeleton class="h-6.5 w-40" />
				<Skeleton shape="pill" class="h-6 w-24" />
				<Skeleton shape="tile" class="size-10" />
			</div>
		{:else}
			<div class="max-w-(--spacing-kit-example)">
				<Card aria-busy="true">
					<CardTop>
						<Skeleton shape="pill" class="h-6 w-26" />
						<Skeleton class="h-5.5 w-16" />
					</CardTop>
					<Skeleton class="h-7 w-(--width-skeleton-title)" />
					<Skeleton class="h-3.5 w-full" />
					<Skeleton class="h-3.5 w-(--width-skeleton-body)" />
					<Skeleton class="h-3.5 w-(--width-skeleton-body-short)" />
				</Card>
			</div>
		{/if}
	</div>
</SchemePanels>
