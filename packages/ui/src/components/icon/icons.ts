// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

// The canvas boards share one sprite, with some symbols used only on screen boards.
export const iconNames = [
	'addsq',
	'ai',
	'alert',
	'archive',
	'bell',
	'bolt',
	'book',
	'bookmark',
	'briefcase',
	'check',
	'chevron',
	'clipboard',
	'clock',
	'coin',
	'concept',
	'copy',
	'deeper',
	'english',
	'external',
	'film',
	'flag',
	'flask',
	'globe',
	'grip',
	'heart',
	'idea',
	'laptop',
	'leaf',
	'link',
	'list',
	'lock',
	'mic',
	'minus',
	'more',
	'music',
	'other',
	'pen',
	'phone',
	'pin',
	'plus',
	'pot',
	'quote',
	'retry',
	'search',
	'send',
	'share',
	'sliders',
	'sun',
	'tag',
	'tech',
	'terminal',
	'trash',
	'undo',
	'x',
] as const

export type IconName = (typeof iconNames)[number]

interface IconElement {
	tag: 'path' | 'circle' | 'rect' | 'line' | 'polyline' | 'polygon' | 'ellipse'
	attrs: Record<string, string | number>
}

function path(d: string): IconElement {
	return { tag: 'path', attrs: { d } }
}

export const icons: Record<IconName, readonly IconElement[]> = {
	addsq: [
		{ tag: 'rect', attrs: { x: 4, y: 4, width: 16, height: 16, rx: 3 } },
		path('M12 8.5v7M8.5 12h7'),
	],
	ai: [
		path(
			'M10.5 3.5l1.9 5.1 5.1 1.9-5.1 1.9-1.9 5.1-1.9-5.1-5.1-1.9 5.1-1.9zM18 15.25l.8 1.95 1.95.8-1.95.8-.8 1.95-.8-1.95-1.95-.8 1.95-.8z',
		),
	],
	alert: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 8.75 } }, path('M12 7.75v5M12 16.25h.01')],
	archive: [
		{ tag: 'rect', attrs: { x: 3, y: 4, width: 18, height: 4.5, rx: 1 } },
		path('M5 8.5V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8.5M10 12.5h4'),
	],
	bell: [path('M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0')],
	bolt: [path('M13 3L5 13.5h6L10 21l8-10.5h-6z')],
	book: [
		path(
			'M12 6.5C10.5 5 8 4.5 4 4.75v13.5c4-.25 6.5.25 8 1.75 1.5-1.5 4-2 8-1.75V4.75c-4-.25-6.5.25-8 1.75zM12 6.5V20',
		),
	],
	bookmark: [path('M7 3.75h10a1 1 0 0 1 1 1v15.5l-6-4.25-6 4.25V4.75a1 1 0 0 1 1-1z')],
	briefcase: [
		{ tag: 'rect', attrs: { x: 3.5, y: 7, width: 17, height: 12.5, rx: 2 } },
		path('M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3.5 12.5h17'),
	],
	check: [path('M5 12.5l4.5 4.5L19 7.5')],
	chevron: [path('M9.5 6l6 6-6 6')],
	clipboard: [
		{ tag: 'rect', attrs: { x: 8.5, y: 3, width: 7, height: 4, rx: 1 } },
		path(
			'M15.5 5h1.75A1.75 1.75 0 0 1 19 6.75v12.5A1.75 1.75 0 0 1 17.25 21H6.75A1.75 1.75 0 0 1 5 19.25V6.75A1.75 1.75 0 0 1 6.75 5H8.5',
		),
	],
	clock: [{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 8.75 } }, path('M12 7.5V12l3 2')],
	coin: [
		{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 8.75 } },
		path(
			'M14.5 9.25c-.5-.9-1.4-1.25-2.5-1.25-1.5 0-2.5.75-2.5 1.9 0 2.6 5.25 1.4 5.25 4.2 0 1.15-1.1 1.9-2.75 1.9-1.2 0-2.2-.45-2.75-1.35M12 6.5V8M12 16v1.5',
		),
	],
	concept: [
		path('M12 3.25l4 6.5H8z'),
		{ tag: 'circle', attrs: { cx: 7.25, cy: 16.25, r: 3.75 } },
		{ tag: 'rect', attrs: { x: 13.25, y: 12.5, width: 7.25, height: 7.25, rx: 1.25 } },
	],
	copy: [
		{ tag: 'rect', attrs: { x: 8.5, y: 8.5, width: 11, height: 11, rx: 2 } },
		path('M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5'),
	],
	deeper: [
		{ tag: 'circle', attrs: { cx: 11, cy: 11, r: 6.5 } },
		path('M16 16l4 4M11 8.25v5.5M8.25 11h5.5'),
	],
	english: [
		path(
			'M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v9.5a1.5 1.5 0 0 1-1.5 1.5h-7l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 5 4.5zM9.25 13.75L12 7.25l2.75 6.5M10.2 11.6h3.6',
		),
	],
	external: [
		path(
			'M14 4.5h5.5V10M19.5 4.5L11 13M17 13.5v4.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18v-9a1.5 1.5 0 0 1 1.5-1.5H11',
		),
	],
	film: [
		{ tag: 'rect', attrs: { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2 } },
		path('M7.5 4.5v15M16.5 4.5v15M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4'),
	],
	flag: [path('M5.5 21V4M5.5 4.5h11l-2 4 2 4h-11')],
	flask: [
		path(
			'M9.5 3.75h5M10.5 3.75v5.5L5.2 18.1a1.5 1.5 0 0 0 1.3 2.4h11a1.5 1.5 0 0 0 1.3-2.4L13.5 9.25v-5.5M7.5 14.5h9',
		),
	],
	globe: [
		{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 8.75 } },
		path(
			'M3.25 12h17.5M12 3.25c2.4 2.4 3.5 5.4 3.5 8.75s-1.1 6.35-3.5 8.75M12 3.25C9.6 5.65 8.5 8.65 8.5 12s1.1 6.35 3.5 8.75',
		),
	],
	grip: [
		{
			tag: 'path',
			attrs: { d: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01', 'stroke-width': 2.5 },
		},
	],
	heart: [
		path(
			'M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z',
		),
	],
	idea: [
		path(
			'M9.25 18h5.5M10.25 21h3.5M12 3a6 6 0 0 0-3.6 10.8c.7.55 1.1 1.3 1.1 2.1V16h5v-.1c0-.8.4-1.55 1.1-2.1A6 6 0 0 0 12 3z',
		),
	],
	laptop: [
		{ tag: 'rect', attrs: { x: 4.5, y: 5, width: 15, height: 10.5, rx: 1.5 } },
		path('M2.5 19h19'),
	],
	leaf: [path('M5 19c0-8 5-13 14-14 0 9-5 14-13 14zM5 19l7-7')],
	link: [
		path(
			'M10 13.5a4 4 0 0 0 5.66.5l2.83-2.83a4 4 0 0 0-5.66-5.66l-1.06 1.06M14 10.5a4 4 0 0 0-5.66-.5l-2.83 2.83a4 4 0 0 0 5.66 5.66l1.06-1.06',
		),
	],
	list: [path('M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01')],
	lock: [
		{ tag: 'rect', attrs: { x: 5, y: 10.5, width: 14, height: 10, rx: 2 } },
		path('M8 10.5V7.5a4 4 0 0 1 8 0v3'),
	],
	mic: [
		{ tag: 'rect', attrs: { x: 9, y: 3.5, width: 6, height: 11, rx: 3 } },
		path('M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5'),
	],
	minus: [path('M5 12h14')],
	more: [{ tag: 'path', attrs: { d: 'M6 12h.01M12 12h.01M18 12h.01', 'stroke-width': 2.5 } }],
	music: [
		path('M9 17.5V5.5l10-2v12'),
		{ tag: 'circle', attrs: { cx: 6.5, cy: 17.5, r: 2.5 } },
		{ tag: 'circle', attrs: { cx: 16.5, cy: 15.5, r: 2.5 } },
	],
	other: [
		{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 8.75 } },
		path('M8 12h.01M12 12h.01M16 12h.01'),
	],
	pen: [path('M15.5 4.5l4 4L9 19l-5 1 1-5zM13.5 6.5l4 4')],
	phone: [
		{ tag: 'rect', attrs: { x: 7, y: 2.75, width: 10, height: 18.5, rx: 2.25 } },
		path('M11 18h2'),
	],
	pin: [
		path('M12 21s6.5-5.6 6.5-11a6.5 6.5 0 0 0-13 0c0 5.4 6.5 11 6.5 11z'),
		{ tag: 'circle', attrs: { cx: 12, cy: 10, r: 2.25 } },
	],
	plus: [path('M12 5v14M5 12h14')],
	pot: [
		path(
			'M3 10.5h18M5 10.5V15a5 5 0 0 0 5 5h4a5 5 0 0 0 5-5v-4.5M10 7.5c-.8-1 .8-2 0-3M14 7.5c-.8-1 .8-2 0-3',
		),
	],
	quote: [path('M5 18c2.5-1 4-3.2 4-6.5V7H5v5h4M15 18c2.5-1 4-3.2 4-6.5V7h-4v5h4')],
	retry: [path('M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5')],
	search: [{ tag: 'circle', attrs: { cx: 11, cy: 11, r: 6.5 } }, path('M16 16l4 4')],
	send: [path('M20.5 3.5L3.5 10.5l6.5 2.5 2.5 6.5zM10 13l4.5-4.5')],
	share: [
		path(
			'M12 3.75v11M8 7.75l4-4 4 4M7 10.5H6a1.5 1.5 0 0 0-1.5 1.5v6.75A1.5 1.5 0 0 0 6 20.25h12a1.5 1.5 0 0 0 1.5-1.5V12a1.5 1.5 0 0 0-1.5-1.5h-1',
		),
	],
	sliders: [
		path('M4 7h8M16 7h4M4 17h3M11 17h9'),
		{ tag: 'circle', attrs: { cx: 14, cy: 7, r: 2 } },
		{ tag: 'circle', attrs: { cx: 9, cy: 17, r: 2 } },
	],
	sun: [
		{ tag: 'circle', attrs: { cx: 12, cy: 12, r: 4 } },
		path(
			'M12 2.75v2M12 19.25v2M2.75 12h2M19.25 12h2M5.46 5.46l1.41 1.41M17.13 17.13l1.41 1.41M5.46 18.54l1.41-1.41M17.13 6.87l1.41-1.41',
		),
	],
	tag: [
		path('M4 4h7.2l8.8 8.8-7.2 7.2L4 11.2z'),
		{ tag: 'circle', attrs: { cx: 8.25, cy: 8.25, r: 1.25 } },
	],
	tech: [path('M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.5 5l-3 14')],
	terminal: [
		{ tag: 'rect', attrs: { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2 } },
		path('M7.5 9.5l3 2.5-3 2.5M12.5 15h4'),
	],
	trash: [
		path(
			'M4 7h16M10 11v6M14 11v6M6 7l.9 12.1A2 2 0 0 0 8.9 21h6.2a2 2 0 0 0 2-1.9L18 7M9 7V4.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5V7',
		),
	],
	undo: [path('M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11')],
	x: [path('M6 6l12 12M18 6L6 18')],
}

export const categoryColors = ['english', 'ai', 'tech', 'concept', 'idea', 'other'] as const

export type CategoryColor = (typeof categoryColors)[number]
