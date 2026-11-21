<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { IconButton } from '../button'
	import { Icon } from '../icon'
	import { Spinner } from '../spinner'

	interface Props {
		label: string
		placeholder: string
		value?: string
		clearLabel?: string
		loading?: boolean
		disabled?: boolean
		focused?: boolean
	}

	let {
		label,
		placeholder,
		value = $bindable(''),
		clearLabel = 'Clear search',
		loading = false,
		disabled = false,
		focused = false,
	}: Props = $props()

	const id = $props.id()

	let input = $state<HTMLInputElement>()

	function clear() {
		value = ''
		input?.focus()
	}
</script>

<div
	aria-busy={loading || undefined}
	data-state={focused && !disabled ? 'focus' : undefined}
	data-disabled={disabled || undefined}
	class={[
		'group/search flex h-11 min-w-0 items-center gap-2 rounded-md border-(length:--border-width-field) border-transparent bg-fill pl-3 text-ink-3 outline-focus',
		'focus-within:border-accent focus-within:bg-surface data-[state=focus]:border-accent data-[state=focus]:bg-surface',
		'has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 data-disabled:text-ink-disabled',
		'transition-colors duration-(--duration-fast) ease-standard motion-reduce:transition-none',
	]}
>
	{#if loading}
		<Spinner class="group-aria-busy/search:text-accent-ink" />
	{:else}
		<Icon name="search" class="size-5" />
	{/if}

	<label for={id} class="sr-only">{label}</label>
	<input
		{id}
		type="search"
		{placeholder}
		{disabled}
		bind:this={input}
		bind:value
		class={[
			'min-h-11 min-w-0 flex-1 appearance-none bg-transparent pr-1 font-ui text-body text-ink outline-none placeholder:text-ink-3',
			'disabled:cursor-not-allowed disabled:text-ink-disabled disabled:placeholder:text-ink-disabled [&::-webkit-search-cancel-button]:hidden',
		]}
	/>

	{#if value !== ''}
		<IconButton
			icon="x"
			iconSize={16}
			label={clearLabel}
			variant="plain"
			{disabled}
			onclick={clear}
			class="enabled:text-ink-3"
		/>
	{/if}
</div>
