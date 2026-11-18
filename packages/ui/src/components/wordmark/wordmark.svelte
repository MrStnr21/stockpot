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

<p class="text-4xl font-semibold tracking-tight text-broth-900">stockpot</p>
{#if tagline}
	<p class="mt-2 text-lg text-broth-900/80">{tagline}</p>
{/if}
