<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'

	interface Props {
		/** Names the set of tabs, such as "Depth". */
		label: string
		children: Snippet
		class?: string
	}

	const { label, children, class: className }: Props = $props()
</script>

<div
	role="tablist"
	aria-label={label}
	class={['grid auto-cols-fr grid-flow-col gap-0.5 rounded-md bg-fill p-0.75 font-ui', className]}
>
	{@render children()}
</div>
