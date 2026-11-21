<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'

	interface Props {
		children: Snippet
		heading: string
	}

	const { children, heading }: Props = $props()
</script>

<div class="flex flex-col gap-0.5">
	<h4 class="font-ui text-detail font-semibold wrap-anywhere text-ink-2">{heading}</h4>
	<div class="font-read text-read-body wrap-anywhere text-ink">{@render children()}</div>
</div>
