<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { HTMLInputAttributes } from 'svelte/elements'

	interface Props extends Pick<
		HTMLInputAttributes,
		| 'autocapitalize'
		| 'autocomplete'
		| 'autofocus'
		| 'disabled'
		| 'enterkeyhint'
		| 'inputmode'
		| 'maxlength'
		| 'minlength'
		| 'name'
		| 'oninput'
		| 'onkeydown'
		| 'required'
		| 'spellcheck'
	> {
		label: string
		value?: string | null
		placeholder?: string | null
		size?: 'md' | 'lg'
		multiline?: boolean
		hint?: string | null
		focused?: boolean
		/** Keeps the label for assistive technology only. */
		hideLabel?: boolean
		/** Controls drawn inside the field box after the text, such as a paste button. */
		trailing?: Snippet
	}

	let {
		label,
		value = $bindable(''),
		placeholder,
		size = 'md',
		multiline = false,
		hint,
		focused = false,
		hideLabel = false,
		trailing,
		...attributes
	}: Props = $props()

	const id = $props.id()

	const hintId = `${id}-hint`

	const state = $derived(focused && !attributes.disabled ? 'focus' : undefined)

	const classes = [
		'min-h-11 w-full min-w-0 flex-1 self-stretch rounded-md bg-transparent px-3.5 py-3 font-ui text-body text-ink outline-none placeholder:text-ink-3',
		'group-data-trailing/field:pr-2 data-[size=lg]:text-subheading',
		'disabled:cursor-not-allowed disabled:text-ink-disabled disabled:placeholder:text-ink-disabled',
	]
</script>

<div class="flex min-w-0 flex-col gap-1.5">
	<label for={id} class={['font-ui text-field-label text-ink-2', hideLabel && 'sr-only']}>
		{label}
	</label>
	<div
		data-state={state}
		data-trailing={trailing ? '' : undefined}
		class={[
			'group/field flex min-w-0 items-center rounded-md border-(length:--border-width-field) border-transparent bg-fill outline-focus',
			'focus-within:border-accent focus-within:bg-surface data-[state=focus]:border-accent data-[state=focus]:bg-surface',
			'has-[[data-field-control]:focus-visible]:outline-2 has-[[data-field-control]:focus-visible]:outline-offset-2',
			'transition-colors duration-(--duration-fast) ease-standard motion-reduce:transition-none',
		]}
	>
		{#if multiline}
			<textarea
				{...attributes}
				{id}
				{placeholder}
				aria-describedby={hint ? hintId : undefined}
				data-field-control
				data-size={size}
				bind:value
				class={[classes, 'resize-y']}></textarea>
		{:else}
			<input
				{...attributes}
				{id}
				type="text"
				{placeholder}
				aria-describedby={hint ? hintId : undefined}
				data-field-control
				data-size={size}
				bind:value
				class={classes}
			/>
		{/if}
		{#if trailing}
			<div class="flex shrink-0 items-center gap-1 pr-1">
				{@render trailing()}
			</div>
		{/if}
	</div>
	{#if hint}
		<p id={hintId} class="font-ui text-detail text-ink-2">{hint}</p>
	{/if}
</div>
