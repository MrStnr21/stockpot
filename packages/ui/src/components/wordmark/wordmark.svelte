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

<p class="text-broth-900 text-4xl font-semibold tracking-tight">stockpot</p>
{#if tagline}
	<p class="text-broth-900/80 mt-2 text-lg">{tagline}</p>
{/if}
