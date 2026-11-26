<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import SchemePanels from '../../book/scheme-panels.svelte'
	import { Button, IconButton } from '../button'
	import { CategoryChip } from '../category'
	import { ToggleRow } from '../switch'
	import { TextField } from '../text-field'
	import ModalPreview from './modal-preview.svelte'
	import Sheet from './sheet.svelte'

	interface Props {
		group: 'capture' | 'states' | 'modal'
	}

	const { group }: Props = $props()
</script>

{#snippet categories(picked = false)}
	<div class="flex flex-col gap-1.5">
		<p class="text-field-label text-ink-2">Category</p>
		<div class="flex flex-wrap gap-x-2 gap-y-1">
			<CategoryChip variant="suggestion" color="tech" icon="tech" {picked}>Technology</CategoryChip>
			<CategoryChip variant="suggestion" color="concept" icon="concept">Concept</CategoryChip>
			<CategoryChip variant="suggestion" color="other" icon="other">Other</CategoryChip>
		</div>
	</div>
{/snippet}

{#snippet actions(state?: 'pressed' | 'disabled' | 'loading')}
	<Button
		variant="tonal"
		size="lg"
		disabled={state === 'disabled' || state === 'loading'}
		class="[&>span]:px-3!"
	>
		Research now
	</Button>
	<Button
		size="lg"
		pressed={state === 'pressed'}
		disabled={state === 'disabled'}
		loading={state === 'loading'}
	>
		Save
	</Button>
{/snippet}

<SchemePanels>
	<div class="w-full max-w-89.5 space-y-4">
		{#if group === 'capture'}
			<p class="text-caption text-ink-3">Default · capture</p>
			<Sheet open inline title="New note" closeLabel="Close" closeHint="esc">
				<TextField label="Word, term or idea" value="SABR" size="lg" hideLabel focused />
				<TextField label="Where you saw it" placeholder="Where you saw it, or a link" hideLabel>
					{#snippet trailing()}
						<IconButton icon="link" label="Paste a link" variant="plain" />
					{/snippet}
				</TextField>
				{@render categories(true)}
				<ToggleRow icon="lock" title="Private" description="The engine gets only the term" />
				{#snippet footer()}
					{@render actions()}
				{/snippet}
			</Sheet>
		{:else if group === 'states'}
			<div class="space-y-2">
				<p class="text-caption text-ink-3">Pressed · Save</p>
				<div
					class="grid grid-cols-2 gap-2.5 rounded-lg bg-surface px-4 pt-4 pb-5 shadow-(--shadow-sheet)"
				>
					{@render actions('pressed')}
				</div>
			</div>
			<div class="space-y-2">
				<p class="text-caption text-ink-3">Disabled · no category picked yet</p>
				<div class="space-y-4 rounded-lg bg-surface px-4 pt-4 pb-5 shadow-(--shadow-sheet)">
					{@render categories()}
					<div class="grid grid-cols-2 gap-2.5">{@render actions('disabled')}</div>
					<p class="text-detail text-ink-2">Pick a category to save.</p>
				</div>
			</div>
			<div class="space-y-2">
				<p class="text-caption text-ink-3">Loading · suggesting, then saving</p>
				<div class="space-y-4 rounded-lg bg-surface px-4 pt-4 pb-5 shadow-(--shadow-sheet)">
					<div class="space-y-1.5" aria-busy="true">
						<p class="text-field-label text-ink-2">Category · suggesting</p>
						<div class="flex gap-2" aria-hidden="true">
							<div class="h-10 min-w-0 basis-31 rounded-full bg-skeleton"></div>
							<div class="h-10 min-w-0 basis-25 rounded-full bg-skeleton"></div>
							<div class="h-10 min-w-0 basis-20.5 rounded-full bg-skeleton"></div>
						</div>
					</div>
					<div class="grid grid-cols-2 gap-2.5">{@render actions('loading')}</div>
				</div>
			</div>
		{:else}
			<ModalPreview />
		{/if}
	</div>
</SchemePanels>
