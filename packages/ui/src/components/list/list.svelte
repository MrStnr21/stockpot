<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { HTMLAttributes } from 'svelte/elements'

	interface Props extends HTMLAttributes<HTMLUListElement> {
		children: Snippet
	}

	const { children, class: className, ...attributes }: Props = $props()
</script>

<ul
	{...attributes}
	role="list"
	class={['overflow-hidden rounded-lg border border-line bg-surface', className]}
>
	{@render children()}
</ul>
