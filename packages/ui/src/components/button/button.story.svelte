<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import SchemePanels from '../../book/scheme-panels.svelte'
	import Button from './button.svelte'

	interface Props {
		group: 'variants' | 'sizes' | 'loading'
	}

	const { group }: Props = $props()

	const variants = [
		{ variant: 'primary', label: 'Primary', action: 'Save' },
		{ variant: 'tonal', label: 'Tonal', action: 'Save' },
		{ variant: 'outline', label: 'Outline', action: 'Undo' },
		{ variant: 'ghost', label: 'Ghost', action: 'Open' },
		{ variant: 'danger', label: 'Danger', action: 'Delete' },
	] as const

	const states = [
		{ label: 'Default' },
		{ label: 'Pressed', pressed: true },
		{ label: 'Disabled', disabled: true },
		{ label: 'Loading', loading: true },
	] as const

	let activations = $state(0)
</script>

<SchemePanels>
	{#if group === 'variants'}
		{#each variants as { variant, label, action } (variant)}
			<div>
				<p class="mb-2 text-label">{label}</p>
				<div class="flex flex-wrap gap-3">
					{#each states as { label: state, ...props } (state)}
						<div class="flex flex-col items-start gap-1">
							<p class="text-caption text-ink-3">{state}</p>
							<Button {variant} {...props}>{action}</Button>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	{:else if group === 'sizes'}
		<div class="flex flex-wrap items-end gap-3">
			<div class="flex flex-col gap-1">
				<p class="text-caption text-ink-3">Large · 52 px</p>
				<Button size="lg" icon="bolt">Research now</Button>
			</div>
			<div class="flex flex-col gap-1">
				<p class="text-caption text-ink-3">Medium · 44 px</p>
				<Button variant="tonal">Save</Button>
			</div>
			<div class="flex flex-col gap-1">
				<p class="text-caption text-ink-3">Small · 36 px, hit area 44 px</p>
				<Button variant="outline" size="sm" icon="undo">Undo</Button>
			</div>
		</div>
	{:else}
		<div data-activations={activations} class="flex flex-col items-start gap-1">
			<p class="text-caption text-ink-3">Loading</p>
			<Button
				loading
				onclick={() => {
					activations += 1
				}}
			>
				Save
			</Button>
		</div>
	{/if}
</SchemePanels>
