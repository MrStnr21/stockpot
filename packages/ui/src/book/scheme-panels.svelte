<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'

	interface Props {
		children: Snippet
	}

	const { children }: Props = $props()

	const schemes = [
		{ key: 'light', label: 'Light' },
		{ key: 'dark', label: 'Dark' },
	] as const
</script>

<div class="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 md:gap-8 md:p-8">
	{#each schemes as { key, label } (key)}
		<div
			data-scheme={key}
			class="flex min-w-0 flex-col gap-5 rounded-lg border border-line bg-canvas p-4 text-ink md:p-7"
		>
			<p class="text-caption text-ink-3 uppercase">{label}</p>
			{@render children()}
		</div>
	{/each}
</div>
