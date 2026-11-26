<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button } from '@stockpot/ui/button'
	import { CardContext } from '@stockpot/ui/card'
	import { CategoryChip } from '@stockpot/ui/category'
	import { Icon } from '@stockpot/ui/icon'
	import { Segmented, SegmentedItem } from '@stockpot/ui/segmented'
	import { Badge, FlagBadge, StatusBadge } from '@stockpot/ui/status-badge'

	import type { CardView } from '../shared/card-view'
	import CardBlocks from './card-blocks.svelte'
	import type { CardLayout, Depth } from './card-panel'
	import {
		bannerScreen,
		difficultyText,
		levelControls,
		metaScreen,
		readingTime,
		senseLine,
		showsNoSources,
		sourceLinks,
		waitScreen,
		type ScreenContext,
		type WaitControl,
	} from './card-screen'
	import CardWait from './card-wait.svelte'

	interface Props {
		view: CardView
		layout: CardLayout
		context: ScreenContext
		statuses: Readonly<Record<CardView['note']['status'], string>>
		/** The title is the page's heading on its own page, and a section's in the pane. */
		headingLevel: 1 | 2
		/** An action is on its way: the wait panel's buttons wait for it. */
		busy: boolean
		onpick: (depth: Depth) => void
		onbutton: (control: WaitControl) => void
	}

	const { view, layout, context, statuses, headingLevel, busy, onpick, onbutton }: Props = $props()

	const strings = $derived(context.strings)

	const { panel } = $derived(layout)

	const banner = $derived(bannerScreen(layout, context))

	const meta = $derived(metaScreen(view, layout, context))

	const sense = $derived(senseLine(view))

	const minutes = $derived(readingTime(strings, view))

	const difficulty = $derived(difficultyText(strings, view))
</script>

<div class="@container flex flex-col gap-4">
	<div class="flex flex-wrap items-center gap-2">
		{#if view.category !== null}
			<CategoryChip variant="label" size="sm" color={view.category.color} icon={view.category.icon}>
				{view.category.name}
			</CategoryChip>
		{/if}
		<StatusBadge status={view.note.status}>{statuses[view.note.status]}</StatusBadge>
		{#if layout.flag !== null}
			<FlagBadge flag={layout.flag}>{strings[layout.flag]}</FlagBadge>
		{/if}
		{#if view.note.isPrivate}
			<Badge icon="lock">{strings.private}</Badge>
		{/if}
		{#if minutes !== null}
			<span class="ms-auto font-ui text-caption text-ink-3">{minutes}</span>
		{/if}
	</div>

	<svelte:element
		this={`h${headingLevel}`}
		class="-mt-1 font-read text-read-display wrap-anywhere text-ink"
	>
		{view.note.text}
	</svelte:element>

	{#if sense !== null}
		<p class="-mt-2.5 font-read text-read-body text-ink-2">{sense}</p>
	{/if}

	{#if view.note.context !== null}
		<CardContext>{view.note.context}</CardContext>
	{/if}

	{#if view.facts !== null}
		<div class="-mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
			<Badge>{difficulty}</Badge>
			{#if view.facts.youglish !== null}
				<a
					href={view.facts.youglish}
					target="_blank"
					rel="noopener noreferrer"
					referrerpolicy="no-referrer"
					class="-ms-2.5 inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 font-ui text-label text-accent-ink outline-focus hover:bg-fill focus-visible:outline-2 focus-visible:outline-offset-2"
				>
					<Icon name="link" size={16} />
					<span>{strings.youglish}</span>
					<span class="sr-only">{strings.opensNewTab}</span>
				</a>
			{/if}
		</div>
	{/if}

	{#if layout.levels !== null}
		<Segmented label={strings.depth}>
			{#each levelControls(view, layout, strings) as level (level.depth)}
				<SegmentedItem
					selected={level.selected}
					muted={level.muted}
					dot={level.dot}
					dotLabel={level.dotLabel}
					onclick={() => {
						onpick(level.depth)
					}}
				>
					{level.label}
				</SegmentedItem>
			{/each}
		</Segmented>
	{/if}

	{#if banner !== null}
		<p
			class="flex items-start gap-2.5 rounded-md bg-fill px-3.5 py-3 font-ui text-body-s text-ink-2"
		>
			<Icon name="alert" size={16} class="mt-0.5 shrink-0" />
			<span><b class="font-semibold text-ink">{banner.title}</b> {banner.text}</span>
		</p>
	{/if}

	{#if panel.kind === 'wait'}
		<CardWait {panel} screen={waitScreen(view, panel, context)} disabled={busy} {onbutton} />
	{:else}
		<CardBlocks
			blocks={panel.card.blocks}
			sources={sourceLinks(panel.card.sources)}
			showsNoSources={showsNoSources(view)}
			suggestions={panel.card.searchSuggestions}
			{strings}
		/>
		<p class="font-ui text-caption text-ink-3">{meta}</p>
	{/if}
</div>
