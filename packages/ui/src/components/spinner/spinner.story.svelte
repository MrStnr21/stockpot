<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import SchemePanels from '../../book/scheme-panels.svelte'
	import Spinner from './spinner.svelte'

	interface Props {
		size: 'sm' | 'md'
	}

	const { size }: Props = $props()
</script>

<SchemePanels>
	<div>
		<p class="mb-2 text-caption text-ink-3">{size === 'sm' ? 'Small' : 'Medium'}</p>
		<Spinner {size} />
	</div>
</SchemePanels>
