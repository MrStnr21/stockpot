<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Button } from '@stockpot/ui/button'
	import { onMount } from 'svelte'

	import type { Messages } from '#/lib/i18n/en'

	import { PushController, pushView } from './push-controller.svelte'

	interface Props {
		/** The instance's VAPID public key, base64url. */
		publicKey: string
		strings: Messages['push']
	}

	const { publicKey, strings }: Props = $props()

	// The key is fixed for the page's life; the controller owns every change after it.
	const controller = new PushController({ publicKey })

	const view = $derived(pushView(controller.state, controller.settled, strings))

	onMount(async () => controller.mount())
</script>

<section
	aria-labelledby="push-toggle-title"
	class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface px-3.5 py-3"
>
	<div class="flex min-w-0 flex-1 basis-56 flex-col gap-px font-ui">
		<h2 id="push-toggle-title" class="text-body/5.5 text-ink">{strings.settingsTitle}</h2>
		<p class="text-detail text-ink-2" aria-live="polite">{view.message}</p>
	</div>
	{#if view.action !== null}
		<Button
			size="sm"
			variant={view.action.kind === 'enable' ? 'primary' : 'outline'}
			loading={view.busy}
			onclick={async () =>
				// Called straight from the tap: Safari on iOS asks for the permission only inside it.
				view.action?.kind === 'turn-off' ? controller.turnOff() : controller.enable()}
		>
			{view.action.label}
		</Button>
	{/if}
</section>
