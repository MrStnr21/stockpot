<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'

	interface Props {
		label: string
		children: Snippet
	}

	const { label, children }: Props = $props()
</script>

<nav
	aria-label={label}
	class="grid min-h-[calc(--spacing(16)+env(safe-area-inset-bottom))] grid-cols-5 border-t border-line bg-surface/(--opacity-tab-bar) px-1 pt-0.75 pb-[calc(--spacing(0.75)+env(safe-area-inset-bottom))] font-ui backdrop-blur-tab-bar"
>
	{@render children()}
</nav>
