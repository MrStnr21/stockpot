<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	interface Props {
		tagline?: string
	}

	const { tagline }: Props = $props()
</script>

<p class="text-4xl font-semibold tracking-tight text-ink">stockpot</p>
{#if tagline}
	<p class="mt-2 text-lg text-ink-2">{tagline}</p>
{/if}
