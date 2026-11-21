<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import SchemePanels from '../../book/scheme-panels.svelte'
	import Switch from './switch.svelte'
	import ToggleRow from './toggle-row.svelte'

	interface Props {
		group: 'states' | 'toggle-row'
	}

	const { group }: Props = $props()

	const states = [
		{ label: 'Off', checked: false },
		{ label: 'On', checked: true },
		{ label: 'Pressed', checked: true, pressed: true },
		{ label: 'Disabled', checked: true, disabled: true },
	]
</script>

<SchemePanels>
	{#if group === 'states'}
		<div class="flex flex-wrap gap-x-6 gap-y-3">
			{#each states as { label, checked, pressed, disabled } (label)}
				<div>
					<p class="mb-2 text-caption text-ink-3">{label}</p>
					<Switch label="Private" {checked} {pressed} {disabled} />
				</div>
			{/each}
		</div>
	{:else}
		<div>
			<p class="mb-2 text-caption text-ink-3">Default</p>
			<ToggleRow icon="lock" title="Private" description="The engine gets only the term" />
		</div>
	{/if}
</SchemePanels>
