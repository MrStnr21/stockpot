<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import SchemePanels from '../../book/scheme-panels.svelte'
	import IconButton from './icon-button.svelte'

	interface Props {
		variant: 'filled' | 'plain'
	}

	const { variant }: Props = $props()
</script>

<SchemePanels>
	<div class="flex flex-wrap gap-3">
		<div class="flex flex-col items-start gap-1">
			<p class="text-caption text-ink-3">Default</p>
			<IconButton {variant} icon="x" label="Close" />
		</div>
		<div class="flex flex-col items-start gap-1">
			<p class="text-caption text-ink-3">Pressed</p>
			<IconButton {variant} icon="x" label="Close" pressed />
		</div>
		<div class="flex flex-col items-start gap-1">
			<p class="text-caption text-ink-3">Disabled</p>
			<IconButton {variant} icon="x" label="Close" disabled />
		</div>
	</div>
</SchemePanels>
