<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Icon } from '@stockpot/ui/icon'

	import type { CardMessages } from '#/lib/i18n/card-en'

	import type { Block } from '../shared/blocks'
	import { headingText, type SourceLink } from './card-screen'
	import SearchSuggestions from './search-suggestions.svelte'

	interface Props {
		blocks: readonly Block[] | null
		sources: readonly SourceLink[]
		/** Says "None" when a card has no sources; a word's card leaves the section out. */
		showsNoSources: boolean
		suggestions: string | null
		strings: CardMessages
	}

	const { blocks, sources, showsNoSources, suggestions, strings }: Props = $props()

	const blockClass = 'flex flex-col gap-1.5'

	const headingClass = 'font-ui text-detail font-semibold text-ink-2'

	const readClass = 'font-read text-read-body wrap-anywhere text-ink'
</script>

{#snippet heading(block: Block)}
	<h4 class={headingClass}>{headingText(strings, block.heading)}</h4>
{/snippet}

{#if blocks === null}
	<div class="rounded-md bg-fill px-3.5 py-3 font-ui text-body-s text-ink-2">
		<b class="font-semibold text-ink">{strings.unreadableTitle}.</b>
		{strings.unreadable}
	</div>
{:else}
	{#each blocks as block, index (index)}
		{#if block.kind === 'text'}
			<section class={blockClass}>
				{@render heading(block)}
				{#each block.paragraphs as paragraph, at (at)}
					<p class={readClass}>{paragraph}</p>
				{/each}
			</section>
		{:else if block.kind === 'note'}
			<section class={[blockClass, 'rounded-md bg-fill px-3.5 py-3']}>
				{@render heading(block)}
				<p class={readClass}>{block.text}</p>
			</section>
		{:else if block.kind === 'code'}
			<section class={blockClass}>
				{@render heading(block)}
				<pre
					class="overflow-x-auto rounded-md bg-fill px-3.5 py-3 font-mono text-body-s text-ink">{block.text}</pre>
			</section>
		{:else if block.kind === 'list'}
			<section class={blockClass}>
				{@render heading(block)}
				<ul class="flex flex-col gap-2">
					{#each block.items as item, at (at)}
						<li
							class={[
								readClass,
								'relative ps-4.5 before:absolute before:start-1 before:top-2.75 before:size-1.25 before:rounded-full before:bg-ink-3',
							]}
						>
							{item}
						</li>
					{/each}
				</ul>
			</section>
		{:else if block.kind === 'steps'}
			<section class={blockClass}>
				{@render heading(block)}
				<ol class="flex flex-col gap-2">
					{#each block.items as item, at (at)}
						<li class={[readClass, 'flex gap-2.5']}>
							<span
								aria-hidden="true"
								class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-fill font-ui text-caption font-semibold text-ink-2"
							>
								{at + 1}
							</span>
							<span class="min-w-0">{item}</span>
						</li>
					{/each}
				</ol>
			</section>
		{:else if block.kind === 'tags'}
			<section class={blockClass}>
				{@render heading(block)}
				<ul class="flex flex-wrap gap-1.5">
					{#each block.items as item, at (at)}
						<li
							class="inline-flex h-7 items-center rounded-full bg-fill px-2.5 font-ui text-detail font-medium text-ink"
						>
							{item}
						</li>
					{/each}
				</ul>
			</section>
		{:else if block.kind === 'examples'}
			<section class={blockClass}>
				{@render heading(block)}
				{#each block.items as item, at (at)}
					<div
						class="flex flex-col gap-0.5 border-s-2 border-line-strong ps-3 not-first-of-type:mt-1.5"
					>
						<p class={[readClass, 'italic']}>{item.text}</p>
						<p class="font-read text-read-quote text-ink-2">{item.translation}</p>
					</div>
				{/each}
			</section>
		{:else if block.kind === 'pairs'}
			<section class={blockClass}>
				{@render heading(block)}
				<dl class="flex flex-col gap-2">
					{#each block.items as item, at (at)}
						<div class="flex flex-col gap-0.5">
							<dt class="font-ui text-list-title text-ink">{item.name}</dt>
							<dd class="font-read text-read-summary/6.25 text-ink-2">{item.note}</dd>
						</div>
					{/each}
				</dl>
			</section>
		{:else if block.kind === 'compare'}
			<section class={blockClass}>
				{@render heading(block)}
				{#each block.items as item, at (at)}
					<div
						class="grid gap-1 rounded-md bg-fill px-3.5 py-3 @card-wide:grid-cols-[var(--spacing-compare-name)_minmax(0,1fr)_minmax(0,1fr)] @card-wide:items-start @card-wide:gap-4"
					>
						<p class="font-ui text-list-title text-ink">{item.name}</p>
						<p class="flex gap-2 font-read text-read-quote text-ink">
							<span class="w-3 shrink-0 font-ui font-bold text-ink-3">
								<span aria-hidden="true">+</span><span class="sr-only">{strings.pros}:</span>
							</span>
							<span class="min-w-0">{item.pros}</span>
						</p>
						<p class="flex gap-2 font-read text-read-quote text-ink">
							<span class="w-3 shrink-0 font-ui font-bold text-ink-3">
								<span aria-hidden="true">−</span><span class="sr-only">{strings.cons}:</span>
							</span>
							<span class="min-w-0">{item.cons}</span>
						</p>
					</div>
				{/each}
			</section>
		{:else if block.kind === 'exercises'}
			<section class={blockClass}>
				{@render heading(block)}
				<ol class="flex flex-col gap-2">
					{#each block.items as item, at (at)}
						<li class={readClass}>
							<details class="group/exercise">
								<summary class="cursor-pointer">{item.prompt}</summary>
								<p class="mt-1 font-ui text-body-s text-ink-2">
									<b class="font-semibold">{strings.answer}:</b>
									{item.answer}
								</p>
							</details>
						</li>
					{/each}
				</ol>
			</section>
		{/if}
	{/each}
{/if}

{#if sources.length > 0}
	<section class="flex flex-col gap-2.5">
		<h4 class={headingClass}>{strings.sources}</h4>
		{#each sources as source (source.url)}
			<a
				href={source.url}
				target="_blank"
				rel="noopener noreferrer"
				referrerpolicy="no-referrer"
				class="flex gap-2 rounded-xs text-accent-ink outline-focus focus-visible:outline-2 focus-visible:outline-offset-2"
			>
				<Icon name="link" size={16} class="mt-0.5" />
				<span class="flex min-w-0 flex-col">
					<span class="font-ui text-label wrap-anywhere">{source.title}</span>
					<span class="truncate font-ui text-caption text-ink-3">{source.host}</span>
					<span class="sr-only">{strings.opensNewTab}</span>
				</span>
			</a>
		{/each}
	</section>
{:else if showsNoSources && blocks !== null}
	<section class="flex flex-col gap-1.5">
		<h4 class={headingClass}>{strings.sources}</h4>
		<p class="font-ui text-body-s text-ink-3">{strings.sourcesNone}</p>
	</section>
{/if}

{#if suggestions !== null}
	<SearchSuggestions html={suggestions} title={strings.suggestions} />
{/if}
