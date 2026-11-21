<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { icons, type IconName } from './icons'

	interface Props {
		name: IconName
		size?: 16 | 24 | 32
		label?: string | null
		class?: string
	}

	const { name, size = 24, label, class: className }: Props = $props()
</script>

<svg
	class={['shrink-0', className]}
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={size === 32 ? 1.5 : 1.75}
	stroke-linecap="round"
	stroke-linejoin="round"
	focusable="false"
	role={label ? 'img' : undefined}
	aria-label={label || undefined}
	aria-hidden={label ? undefined : 'true'}
>
	{#each icons[name] as shape (shape)}
		<svelte:element this={shape.tag} {...shape.attrs} />
	{/each}
</svg>
