<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button } from '@stockpot/ui/button'
	import { CategoryChip } from '@stockpot/ui/category'
	import { Icon } from '@stockpot/ui/icon'
	import { StatusBadge } from '@stockpot/ui/status-badge'

	import type { CaptureCategory, NoteStatus, SuggestHistoryMatch } from '../shared/types'
	import { seenLine } from './capture-model'
	import type { CaptureStrings } from './capture-toasts.svelte'

	interface Props {
		kind: 'saved' | 'seen'
		match: SuggestHistoryMatch
		category: CaptureCategory | null
		strings: CaptureStrings
		ondifferent: () => void
	}

	const { kind, match, category, strings, ondifferent }: Props = $props()

	const titleId = $props.id()

	/* A failed note has no badge in the kit; the panel shows it without one. */
	const status = $derived(
		match.note === null || match.note.status === 'failed' ? null : match.note.status,
	)

	const statusLabels = $derived({
		new: strings.statusNew,
		queued: strings.statusQueued,
		researching: strings.statusResearching,
		ready: strings.statusReady,
		read: strings.statusRead,
		archived: strings.statusArchived,
	} satisfies Record<Exclude<NoteStatus, 'failed'>, string>)

	const line = $derived(kind === 'saved' ? strings.savedLine : seenLine(match))
</script>

<section
	aria-labelledby={titleId}
	class="flex flex-col gap-1.5 rounded-md bg-fill px-3.5 pt-3 pb-1"
>
	<div class="flex flex-wrap items-center gap-1.5">
		<span class="mr-0.5 font-ui text-micro text-ink-2 uppercase">
			{kind === 'saved' ? strings.savedKicker : strings.seenKicker}
		</span>
		{#if category !== null}
			<CategoryChip variant="label" size="sm" color={category.color} icon={category.icon}>
				{category.name}
			</CategoryChip>
		{/if}
		{#if status !== null}
			<StatusBadge {status} class="bg-surface">{statusLabels[status]}</StatusBadge>
		{/if}
	</div>
	<p id={titleId} class="mt-0.5 font-read text-title-m wrap-break-word">{match.term}</p>
	{#if line !== null}
		<p class="font-read text-body-compact text-ink-2">{line}</p>
	{/if}
	<div class="-mx-2.5 flex flex-wrap gap-0.5">
		<Button variant="ghost" size="sm" href="/notes" class="[&>span]:px-2.5!">
			<span class="inline-flex items-center gap-1">
				{kind === 'saved' ? strings.openNote : strings.openCard}
				<Icon name="chevron" size={16} />
			</span>
		</Button>
		{#if kind === 'seen'}
			<Button variant="ghost" size="sm" class="[&>span]:px-2.5!" onclick={ondifferent}>
				{strings.differentMeaning}
			</Button>
		{/if}
	</div>
</section>
