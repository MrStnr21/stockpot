<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'

	interface Props {
		children: Snippet
		meta?: string | null
	}

	const { children, meta }: Props = $props()
</script>

<div class="flex flex-wrap items-center gap-2">
	{@render children()}
	{#if meta}
		<span class="ms-auto font-ui text-caption tracking-normal text-ink-3">{meta}</span>
	{/if}
</div>
