<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button } from '../button'
	import { TextField } from '../text-field'
	import Sheet from './sheet.svelte'

	let open = $state(false)
</script>

<Button onclick={() => (open = true)}>Open sheet</Button>
<Sheet bind:open title="New note" closeLabel="Close" closeHint="esc">
	<TextField
		label="Word, term or idea"
		placeholder="Word, term or idea"
		size="lg"
		hideLabel
		autofocus
		autocapitalize="off"
		enterkeyhint="done"
		spellcheck="false"
	/>
	{#snippet footer()}
		<Button variant="tonal" onclick={() => (open = false)}>Cancel</Button>
		<Button onclick={() => (open = false)}>Save</Button>
	{/snippet}
</Sheet>
