<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'

	import { Icon } from '../icon'

	interface Props {
		children: Snippet
	}

	const { children }: Props = $props()
</script>

<p class="flex gap-2 font-read text-read-quote wrap-anywhere text-ink-2 italic">
	<Icon name="quote" size={16} class="mt-0.75 text-ink-3" />
	<span>{@render children()}</span>
</p>
