<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	interface Props {
		size?: 'sm' | 'md'
		class?: string
	}

	const { size = 'md', class: className }: Props = $props()
</script>

<span
	aria-hidden="true"
	data-size={size}
	class={[
		'inline-block size-spinner flex-none animate-spin rounded-full border-2 border-current border-r-transparent [animation-duration:var(--duration-spin)] data-[size=sm]:size-3 data-[size=sm]:border-(length:--border-width-spinner-sm) motion-reduce:[animation-duration:var(--duration-spin-reduced)]',
		className,
	]}
></span>
