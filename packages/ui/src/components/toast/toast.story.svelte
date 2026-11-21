<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { ComponentProps } from 'svelte'

	import SchemePanels from '../../book/scheme-panels.svelte'
	import ToastAction from './toast-action.svelte'
	import Toast from './toast.svelte'

	interface Props {
		group: 'default' | 'pressed' | 'disabled' | 'loading' | 'ready' | 'error'
	}

	const { group }: Props = $props()

	const states: Record<
		Props['group'],
		{ label: string; message: string; action: string; tone?: ComponentProps<typeof Toast>['tone'] }
	> = {
		default: { label: 'Default · saved', message: 'Saved for tonight', action: 'Undo' },
		pressed: { label: 'Pressed · undo', message: 'Saved for tonight', action: 'Undo' },
		disabled: {
			label: 'Disabled · action unavailable',
			message: 'Moved to Base',
			action: 'Undo',
		},
		loading: {
			label: 'Loading · research started',
			message: 'Researching Bun…',
			action: 'Hide',
			tone: 'loading',
		},
		ready: {
			label: 'Ready · a research-now result',
			message: 'Ready: Bun',
			action: 'Open',
			tone: 'ready',
		},
		error: {
			label: 'Error',
			message: "Couldn't save. Check the connection.",
			action: 'Retry',
			tone: 'error',
		},
	}

	const state = $derived(states[group])
</script>

<SchemePanels>
	<div class="flex w-full max-w-90 flex-col gap-2">
		<span class="text-caption text-ink-3">{state.label}</span>
		<Toast tone={state.tone}>
			{state.message}
			{#snippet action()}
				<ToastAction pressed={group === 'pressed'} disabled={group === 'disabled'}>
					{state.action}
				</ToastAction>
			{/snippet}
		</Toast>
	</div>
</SchemePanels>
