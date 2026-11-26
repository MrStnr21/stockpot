<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Toast, ToastAction } from '@stockpot/ui/toast'

	import type { ToastAction as Action, CaptureStrings, CaptureToast } from './capture-toasts.svelte'

	interface Props {
		toast: CaptureToast | null
		strings: CaptureStrings
		onundo: (noteId: number) => void
		onview: () => void
	}

	const { toast, strings, onundo, onview }: Props = $props()

	function act(action: Action) {
		if (action.kind === 'undo') {
			onundo(action.noteId)
		} else {
			onview()
		}
	}
</script>

{#snippet actionButton()}
	{#if toast?.action}
		{@const action = toast.action}
		<ToastAction
			onclick={() => {
				act(action)
			}}
		>
			{action.kind === 'undo' ? strings.undo : strings.view}
		</ToastAction>
	{/if}
{/snippet}

<!-- The region stays in the page, so a toast added to it is announced. -->
<div aria-live="polite">
	{#if toast !== null}
		{#key toast.id}
			<div
				class={[
					'fixed inset-x-4 bottom-[calc(--spacing(20)+env(safe-area-inset-bottom))] z-10 md:inset-x-0 md:bottom-8 md:mx-auto md:w-105',
					'transition-[opacity,translate] duration-(--duration-base) ease-enter motion-reduce:transition-opacity starting:opacity-0 motion-safe:starting:translate-y-2',
				]}
			>
				<Toast tone={toast.tone} action={toast.action === null ? undefined : actionButton}>
					<span class="block font-semibold">{toast.title}</span>
					{#if toast.detail !== null}
						<span class="block text-detail font-normal opacity-80">{toast.detail}</span>
					{/if}
				</Toast>
			</div>
		{/key}
	{/if}
</div>
