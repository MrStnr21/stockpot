<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import SchemePanels from '../../book/scheme-panels.svelte'
	import TextField from './text-field.svelte'

	interface Props {
		group: 'capture' | 'multiline'
	}

	const { group }: Props = $props()

	const contextLabel = 'Where you saw it'

	const contextPlaceholder = 'Context or a link, optional'
</script>

<SchemePanels>
	<div class="flex w-full max-w-90 flex-col gap-4">
		{#if group === 'capture'}
			<div class="flex flex-col gap-2">
				<p class="text-caption text-ink-3">Focused · term</p>
				<TextField label="Word, term or idea" value="SABR" size="lg" focused />
			</div>
			<div class="flex flex-col gap-2">
				<p class="text-caption text-ink-3">Default · context</p>
				<TextField label={contextLabel} placeholder={contextPlaceholder} />
			</div>
		{:else}
			<div class="flex flex-col gap-2">
				<p class="text-caption text-ink-3">Multiline · with hint</p>
				<TextField
					label={contextLabel}
					placeholder={contextPlaceholder}
					hint="Add a detail that will help you remember why you saved it."
					multiline
				/>
			</div>
		{/if}
	</div>
</SchemePanels>
