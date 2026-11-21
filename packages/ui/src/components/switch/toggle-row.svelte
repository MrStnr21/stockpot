<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Icon, type IconName } from '../icon'
	import Switch from './switch.svelte'

	interface Props {
		icon?: IconName | null
		title: string
		description?: string | null
		checked?: boolean
		disabled?: boolean
		pressed?: boolean
		onchange?: (checked: boolean) => void
	}

	let {
		icon,
		title,
		description,
		checked = $bindable(false),
		disabled,
		pressed,
		onchange,
	}: Props = $props()

	const titleId = $props.id()

	const descriptionId = `${titleId}-description`
</script>

<div class="flex items-center gap-3 font-ui">
	{#if icon}
		<Icon name={icon} class="size-5 text-ink-2" />
	{/if}
	<div class="flex min-w-0 flex-1 flex-col">
		<span id={titleId} class="text-label text-ink">{title}</span>
		{#if description}
			<span id={descriptionId} class="text-detail text-ink-2">{description}</span>
		{/if}
	</div>
	<Switch
		bind:checked
		aria-labelledby={titleId}
		aria-describedby={description ? descriptionId : undefined}
		{disabled}
		{pressed}
		{onchange}
	/>
</div>
