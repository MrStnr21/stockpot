<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import SchemePanels from '../../book/scheme-panels.svelte'
	import Wordmark from './wordmark.svelte'

	interface Props {
		tagline?: string
	}

	const { tagline }: Props = $props()
</script>

<SchemePanels>
	<div>
		<p class="mb-2 text-caption text-ink-3">{tagline ? 'With tagline' : 'Default'}</p>
		<Wordmark {tagline} />
	</div>
</SchemePanels>
