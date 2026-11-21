<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	interface Props {
		// oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- Line, pill and tile specify the geometry.
		shape?: 'line' | 'pill' | 'tile'
		class?: string
	}

	const props: Props = $props()
</script>

<span
	aria-hidden="true"
	data-shape={props.shape ?? 'line'}
	class={[
		'relative block overflow-hidden rounded-xs bg-skeleton data-[shape=pill]:rounded-full data-[shape=tile]:rounded-sm',
		'after:absolute after:inset-0 after:animate-shimmer after:bg-linear-to-r after:from-transparent after:via-skeleton-shine after:to-transparent motion-reduce:after:hidden motion-reduce:after:animate-none',
		props.class,
	]}
></span>
