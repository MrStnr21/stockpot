<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	interface Props {
		checked?: boolean
		disabled?: boolean
		pressed?: boolean
		'aria-describedby'?: string
		onchange?: (checked: boolean) => void
	}

	type AccessibleName =
		{ label: string; 'aria-labelledby'?: string } | { label?: string; 'aria-labelledby': string }

	let {
		checked = $bindable(false),
		label,
		'aria-labelledby': labelledBy,
		'aria-describedby': describedBy,
		disabled = false,
		pressed = false,
		onchange,
	}: Props & AccessibleName = $props()

	function toggle() {
		checked = !checked
		onchange?.(checked)
	}
</script>

<button
	type="button"
	role="switch"
	aria-checked={checked}
	aria-label={label}
	aria-labelledby={labelledBy}
	aria-describedby={describedBy}
	{disabled}
	data-state={pressed && !disabled ? 'pressed' : undefined}
	onclick={toggle}
	class="group/switch inline-grid h-11 w-switch-width shrink-0 cursor-pointer place-items-center rounded-full font-ui [--knob-width:var(--spacing-switch-knob)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus enabled:active:[--knob-width:var(--spacing-switch-knob-pressed)] disabled:cursor-not-allowed disabled:opacity-(--opacity-switch-disabled) data-[state=pressed]:[--knob-width:var(--spacing-switch-knob-pressed)]"
>
	<span
		aria-hidden="true"
		class="relative block h-switch-height w-full rounded-full bg-fill-strong transition-colors duration-(--duration-base) ease-standard group-aria-checked/switch:bg-accent motion-reduce:transition-none"
	>
		<span
			class="absolute start-0.5 top-0.5 h-switch-knob w-(--knob-width) rounded-full bg-switch-knob shadow-switch-knob transition-[inset-inline-start,width] [transition-duration:var(--duration-base),var(--duration-fast)] ease-standard group-aria-checked/switch:start-[calc(100%-var(--knob-width)-var(--spacing)*0.5)] motion-reduce:transition-none"
		></span>
	</span>
</button>
