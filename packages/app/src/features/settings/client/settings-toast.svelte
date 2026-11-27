<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Toast } from '@stockpot/ui/toast'

	import type { SettingsToast } from './settings-toasts.svelte'

	interface Props {
		toast: SettingsToast | null
	}

	const { toast }: Props = $props()
</script>

<!-- The region stays in the page, so a toast added to it is announced. It is fixed, so the pane's
	column spacing does not count it. -->
<div
	aria-live="polite"
	class="fixed inset-x-4 bottom-[calc(--spacing(20)+env(safe-area-inset-bottom))] z-10 md:inset-x-0 md:bottom-8 md:mx-auto md:w-105"
>
	{#if toast !== null}
		{#key toast.id}
			<div
				class="transition-[opacity,translate] duration-(--duration-base) ease-enter motion-reduce:transition-opacity starting:opacity-0 motion-safe:starting:translate-y-2"
			>
				<Toast tone={toast.tone}>
					<span class="block font-semibold">{toast.title}</span>
				</Toast>
			</div>
		{/key}
	{/if}
</div>
