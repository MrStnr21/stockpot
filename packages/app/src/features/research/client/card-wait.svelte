<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button } from '@stockpot/ui/button'
	import { Icon } from '@stockpot/ui/icon'
	import { Skeleton } from '@stockpot/ui/skeleton'
	import { Spinner } from '@stockpot/ui/spinner'

	import type { CardPanel } from './card-panel'
	import type { WaitControl, WaitScreen } from './card-screen'

	interface Props {
		panel: Extract<CardPanel, { kind: 'wait' }>
		screen: WaitScreen
		disabled: boolean
		onbutton: (control: WaitControl) => void
	}

	const { panel, screen, disabled, onbutton }: Props = $props()
</script>

<div
	data-tone={panel.tone}
	class="group/wait flex flex-col items-center gap-2.5 rounded-lg bg-fill px-5 pt-7 pb-6 text-center"
>
	<span
		class="mb-0.5 grid size-14 place-items-center rounded-full bg-accent-soft text-accent-ink group-data-[tone=danger]/wait:bg-danger-soft group-data-[tone=danger]/wait:text-danger-ink"
	>
		{#if panel.icon === 'spinner'}
			<Spinner />
		{:else}
			<Icon name={panel.icon} />
		{/if}
	</span>
	<h3 class="font-read text-title-m wrap-anywhere text-ink">{screen.title}</h3>
	{#if screen.text !== null}
		<p class="max-w-75 font-ui text-body-compact/5.5 text-ink-2">{screen.text}</p>
	{/if}
	{#if screen.steps !== null}
		<ol class="my-1 flex flex-col gap-2.5 self-stretch text-start">
			{#each screen.steps as step (step.text)}
				<li
					data-state={step.state}
					class="flex items-center gap-2.5 font-ui text-body-compact font-medium text-ink data-[state=todo]:text-ink-3"
				>
					<span
						aria-hidden="true"
						class="grid size-6 shrink-0 place-items-center rounded-full bg-surface text-accent-ink"
					>
						{#if step.state === 'done'}
							<Icon name="check" size={16} class="size-3.5" />
						{:else if step.state === 'active'}
							<Spinner size="sm" />
						{/if}
					</span>
					{step.text}
				</li>
			{/each}
		</ol>
	{/if}
	{#if screen.buttons.length > 0}
		<div class="mt-1.5 flex flex-wrap justify-center gap-2">
			{#each screen.buttons as control (control.key)}
				<Button
					variant={control.variant}
					{disabled}
					onclick={() => {
						onbutton(control)
					}}
				>
					{control.label}
				</Button>
			{/each}
		</div>
	{/if}
	{#if screen.meta !== null}
		<p class="font-ui text-caption text-ink-3">{screen.meta}</p>
	{/if}
</div>
{#if panel.skeleton}
	<div aria-hidden="true" class="flex flex-col gap-2.5">
		<Skeleton class="h-3 w-(--width-skeleton-title)" />
		<Skeleton class="h-4 w-full" />
		<Skeleton class="h-4 w-(--width-skeleton-body)" />
		<Skeleton class="mt-2.5 h-3 w-(--width-skeleton-body-short)" />
		<Skeleton class="h-4 w-(--width-skeleton-body)" />
	</div>
{/if}
