<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { Icon, type CategoryColor, type IconName } from '../icon'
	import { categoryColorClasses } from './category-colors'

	interface Props {
		color: CategoryColor
		icon: IconName
		size?: 'sm' | 'md' | 'lg'
	}

	const { color, icon, size = 'md' }: Props = $props()
</script>

<span
	data-color={color}
	data-size={size}
	class={[
		categoryColorClasses,
		'group/category inline-grid size-10 flex-none place-items-center rounded-sm bg-(--c-soft) text-(color:--c) data-[size=lg]:size-14 data-[size=lg]:rounded-md data-[size=sm]:size-7 data-[size=sm]:rounded-xs',
	]}
>
	<Icon
		name={icon}
		class="size-5 group-data-[size=lg]/category:size-7 group-data-[size=sm]/category:size-4"
	/>
</span>
