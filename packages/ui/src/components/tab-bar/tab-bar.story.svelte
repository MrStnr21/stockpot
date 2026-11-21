<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import SchemePanels from '../../book/scheme-panels.svelte'
	import TabBar from './tab-bar.svelte'
	import Tab from './tab.svelte'

	interface Props {
		group: 'default' | 'pressed' | 'badge'
	}

	const { group }: Props = $props()

	const badge = $derived(group === 'badge' ? 103 : 7)

	const stateLabels = {
		default: 'Default · Today, 7 cards waiting',
		pressed: 'Pressed · Notes, then Add',
		badge: 'Badge count',
	}
</script>

<SchemePanels>
	<div class="flex w-full max-w-90 flex-col gap-2">
		<p class="text-caption text-ink-3">{stateLabels[group]}</p>
		<TabBar label="Main">
			<Tab href="#today" icon="sun" {badge} badgeLabel={`${badge} cards waiting`} current>
				Today
			</Tab>
			<Tab href="#notes" icon="list" badge={0} pressed={group === 'pressed'}>Notes</Tab>
			<Tab href="#add" icon="plus" add pressed={group === 'pressed'}>Add</Tab>
			<Tab href="#base" icon="bookmark" badge={null}>Base</Tab>
			<Tab href="#settings" icon="sliders">Settings</Tab>
		</TabBar>
	</div>
</SchemePanels>
