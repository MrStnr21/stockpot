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
</script>

<p class="-mt-1.5 font-read text-read-summary wrap-anywhere text-ink-2">{@render children()}</p>
