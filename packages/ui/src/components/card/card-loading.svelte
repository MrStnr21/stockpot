<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'

	import { Skeleton } from '../skeleton'
	import { Spinner } from '../spinner'

	interface Props {
		children: Snippet
	}

	const { children }: Props = $props()
</script>

<p class="flex items-center gap-2 font-ui text-detail font-medium wrap-anywhere text-accent-ink">
	<Spinner size="sm" />
	<span>{@render children()}</span>
</p>
<Skeleton class="h-3.5 w-full" />
<Skeleton class="h-3.5 w-(--width-card-loading-line)" />
