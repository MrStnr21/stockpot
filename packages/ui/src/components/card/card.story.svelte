<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import SchemePanels from '../../book/scheme-panels.svelte'
	import { CategoryChip } from '../category'
	import { StatusBadge } from '../status-badge'
	import CardAction from './card-action.svelte'
	import CardActions from './card-actions.svelte'
	import CardBlock from './card-block.svelte'
	import CardContext from './card-context.svelte'
	import CardLoading from './card-loading.svelte'
	import CardSource from './card-source.svelte'
	import CardSources from './card-sources.svelte'
	import CardSummary from './card-summary.svelte'
	import CardTitle from './card-title.svelte'
	import CardTop from './card-top.svelte'
	import Card from './card.svelte'

	interface Props {
		group: 'default' | 'pressed' | 'disabled' | 'loading'
	}

	const { group }: Props = $props()

	const labels = {
		default: 'Default · Technology format',
		pressed: 'Pressed · compact, English',
		disabled: 'Disabled · server out of reach',
		loading: 'Loading · an idea being researched',
	}
</script>

{#snippet actions(accent: boolean)}
	<CardActions>
		<CardAction icon="check" tone={accent ? 'accent' : 'default'}>Got it</CardAction>
		<CardAction icon="deeper">Deeper</CardAction>
		<CardAction icon="bookmark">Keep</CardAction>
		<CardAction icon="trash">Delete</CardAction>
	</CardActions>
{/snippet}

<SchemePanels>
	<div class="grid max-w-kit-example gap-2">
		<p class="text-caption text-ink-3">{labels[group]}</p>
		{#if group === 'default'}
			<Card>
				<CardTop meta="2 min">
					<CategoryChip color="tech" icon="tech" variant="label" size="sm">Technology</CategoryChip>
					<StatusBadge status="ready">Ready</StatusBadge>
				</CardTop>
				<CardTitle>Bun</CardTitle>
				<CardContext>Seen in the stockpot README</CardContext>
				<CardBlock heading="What it is">
					A JavaScript runtime with a package manager, a test runner and a bundler built in.
				</CardBlock>
				<CardBlock heading="In JS terms">
					Like Node.js, npm, Jest and esbuild rolled into one binary.
				</CardBlock>
				<CardBlock heading="Why it matters to you">
					stockpot's server, tests and scripts run on it, so its APIs come before Node's.
				</CardBlock>
				<CardBlock heading="Dig deeper">
					<CardSources>
						<CardSource href="https://bun.sh/docs">bun.sh/docs</CardSource>
						<CardSource href="https://github.com/oven-sh/bun">github.com/oven-sh/bun</CardSource>
					</CardSources>
				</CardBlock>
				{@render actions(true)}
			</Card>
		{:else if group === 'pressed'}
			<Card compact pressed>
				<CardTop meta="1 min">
					<CategoryChip color="english" icon="english" variant="label" size="sm">
						English
					</CategoryChip>
					<StatusBadge status="ready">Ready</StatusBadge>
				</CardTop>
				<CardTitle>serendipity</CardTitle>
				<CardSummary>noun · finding something good by chance</CardSummary>
				{@render actions(true)}
			</Card>
		{:else if group === 'disabled'}
			<Card compact disabled>
				<CardTop>
					<CategoryChip color="concept" icon="concept" variant="label" size="sm">
						Concept
					</CategoryChip>
					<StatusBadge status="read">Read</StatusBadge>
				</CardTop>
				<CardTitle>Idempotency</CardTitle>
				<CardSummary>Doing it twice has the same effect as doing it once.</CardSummary>
				{@render actions(false)}
			</Card>
		{:else}
			<Card compact aria-busy="true">
				<CardTop>
					<CategoryChip color="idea" icon="idea" variant="label" size="sm">Idea</CategoryChip>
					<StatusBadge status="researching">Researching</StatusBadge>
				</CardTop>
				<CardTitle>Voice capture from the Action button</CardTitle>
				<CardLoading>A report takes a few minutes; you'll get a notification</CardLoading>
			</Card>
		{/if}
	</div>
</SchemePanels>
