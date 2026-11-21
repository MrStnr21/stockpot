<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements'

	interface Props extends Pick<
		HTMLInputAttributes,
		'autocomplete' | 'disabled' | 'maxlength' | 'minlength' | 'name' | 'required'
	> {
		label: string
		value?: string | null
		placeholder?: string | null
		size?: 'md' | 'lg'
		multiline?: boolean
		hint?: string | null
		focused?: boolean
	}

	let {
		label,
		value = $bindable(''),
		placeholder,
		size = 'md',
		multiline = false,
		hint,
		focused = false,
		...attributes
	}: Props = $props()

	const id = $props.id()

	const hintId = `${id}-hint`

	const state = $derived(focused && !attributes.disabled ? 'focus' : undefined)

	const classes = [
		'w-full min-w-0 min-h-11 rounded-md border-(length:--border-width-field) border-transparent bg-fill px-3.5 py-3 font-ui text-body text-ink outline-focus placeholder:text-ink-3',
		'focus:border-accent focus:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 data-[state=focus]:border-accent data-[state=focus]:bg-surface',
		'transition-colors duration-(--duration-fast) ease-standard motion-reduce:transition-none data-[size=lg]:text-subheading',
		'disabled:cursor-not-allowed disabled:text-ink-disabled disabled:placeholder:text-ink-disabled',
	]
</script>

<div class="flex min-w-0 flex-col gap-1.5">
	<label for={id} class="font-ui text-field-label text-ink-2">{label}</label>
	{#if multiline}
		<textarea
			{...attributes}
			{id}
			{placeholder}
			aria-describedby={hint ? hintId : undefined}
			data-size={size}
			data-state={state}
			bind:value
			class={[classes, 'resize-y']}></textarea>
	{:else}
		<input
			{...attributes}
			{id}
			type="text"
			{placeholder}
			aria-describedby={hint ? hintId : undefined}
			data-size={size}
			data-state={state}
			bind:value
			class={classes}
		/>
	{/if}
	{#if hint}
		<p id={hintId} class="font-ui text-detail text-ink-2">{hint}</p>
	{/if}
</div>
