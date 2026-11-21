// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import type { Messages } from './en'

export const ru: Messages = {
	nav: {
		label: 'Главное меню',
		today: 'Сегодня',
		notes: 'Заметки',
		add: 'Добавить',
		base: 'База',
		settings: 'Настройки',
	},
	newNote: 'Новая заметка',
	sourceCode: 'Исходный код',
	signOut: 'Выйти',
	offline: {
		title: 'Сервер недоступен.',
		body: 'Читать можно, а действия подождут, пока он не вернётся.',
	},
	offlinePage: {
		emptyTitle: 'Для чтения без сети пока ничего нет',
		empty:
			'Откройте «Сегодня», пока сервер доступен, и его последняя копия сохранится на этом устройстве.',
	},
	today: {
		emptyTitle: 'Сегодня читать нечего',
		empty:
			'Новых карточек этим утром нет. Сохраните слово, термин или идею сегодня, и завтра в 08:30 они будут здесь.',
		addNote: 'Добавить заметку',
	},
	notes: {
		emptyTitle: 'Заметок пока нет',
		empty: 'Здесь будут сохранённые вами заметки.',
	},
	base: {
		emptyTitle: 'База пуста',
		empty: 'Здесь будут карточки, которые вы оставили.',
	},
	settings: {
		emptyTitle: 'Настройки скоро появятся',
		empty: 'Менять здесь пока нечего.',
	},
	add: {
		emptyTitle: 'Добавить заметку',
		empty: 'Скоро здесь можно будет сохранять заметки.',
	},
}
