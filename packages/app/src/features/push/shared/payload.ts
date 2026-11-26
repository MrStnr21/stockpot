// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * What a push carries, read by the service worker. It is the declarative Web Push format (WebKit,
 * `web_push: 8030`), so Safari 18.4 and later shows the notification and opens `navigate` even
 * without the worker; other browsers hand it to the worker's `push` handler, which shows the same.
 */
import * as v from 'valibot'

/** The magic number that marks a declarative push message, after RFC 8030. */
export const declarativePush = 8030

const notificationSchema = v.object({
	title: v.pipe(v.string(), v.nonEmpty()),
	body: v.string(),
	navigate: v.pipe(v.string(), v.url()),
	tag: v.string(),
	lang: v.string(),
})

export const pushPayloadSchema = v.object({
	web_push: v.literal(declarativePush),
	notification: notificationSchema,
})

export type PushPayload = v.InferOutput<typeof pushPayloadSchema>

/** The parts of a message the payload shows; `path` is resolved against the instance's origin. */
export interface PayloadMessage {
	readonly title: string
	readonly body: string
	readonly path: string
	readonly tag: string
}

/** The payload for a message in a locale, opening `path` on the instance at `origin`. */
export function pushPayload(
	{ title, body, path, tag }: PayloadMessage,
	{ origin, lang }: { origin: string; lang: string },
): PushPayload {
	return {
		web_push: declarativePush,
		notification: { title, body, navigate: new URL(path, origin).href, tag, lang },
	}
}
