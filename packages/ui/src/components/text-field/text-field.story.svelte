<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import SchemePanels from '../../book/scheme-panels.svelte'
	import { Button, IconButton } from '../button'
	import TextField from './text-field.svelte'

	interface Props {
		group: 'capture' | 'multiline' | 'trailing'
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
		{:else if group === 'trailing'}
			<div class="flex flex-col gap-2">
				<p class="text-caption text-ink-3">Hidden label · term with Paste</p>
				<TextField
					label="Word, term or idea"
					placeholder="Word, term or idea"
					size="lg"
					hideLabel
					autocapitalize="off"
					enterkeyhint="done"
					spellcheck="false"
				>
					{#snippet trailing()}
						<Button variant="outline" size="sm" icon="clipboard">Paste</Button>
					{/snippet}
				</TextField>
			</div>
			<div class="flex flex-col gap-2">
				<p class="text-caption text-ink-3">Hidden label · context with a link button</p>
				<TextField label={contextLabel} placeholder="Where you saw it, or a link" hideLabel>
					{#snippet trailing()}
						<IconButton icon="link" label="Paste a link" variant="plain" />
					{/snippet}
				</TextField>
			</div>
			<div class="flex flex-col gap-2">
				<p class="text-caption text-ink-3">Focused · trailing, typed</p>
				<TextField
					label={contextLabel}
					value="Podcast on market makers https://example.com/episode-12"
					hideLabel
					focused
				>
					{#snippet trailing()}
						<IconButton icon="link" label="Paste a link" variant="plain" />
					{/snippet}
				</TextField>
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
