// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

import { describe, expect, it } from 'bun:test'
import { faker } from '@faker-js/faker'

import { isAllowedEndpoint, maxEndpointLength } from './endpoints'

const id = faker.string.alphanumeric(40)

const google = 'https://fcm.googleapis.com/'

describe('isAllowedEndpoint', () => {
	it.each([
		['Google', `https://fcm.googleapis.com/fcm/send/${id}`],
		['Mozilla', `https://updates.push.services.mozilla.com/wpush/v2/${id}`],
		['Apple', `https://web.push.apple.com/${id}`],
		['Apple, another region', `https://api.sandbox.push.apple.com/${id}`],
		['Microsoft', `https://wns2-par02p.notify.windows.com/w/?token=${id}`],
		['an uppercase host', `https://FCM.googleapis.com/fcm/send/${id}`],
		['an uppercase scheme', `HTTPS://web.push.apple.com/${id}`],
		['a host with nothing after it', 'https://web.push.apple.com'],
		['the longest endpoint', google + 'a'.repeat(maxEndpointLength - google.length)],
	])('accepts %s', (_case, endpoint) => {
		expect(isAllowedEndpoint(endpoint)).toBe(true)
	})

	it.each([
		['plain http', `http://fcm.googleapis.com/fcm/send/${id}`],
		['another scheme', `wss://fcm.googleapis.com/fcm/send/${id}`],
		['no slashes after the scheme', `https:fcm.googleapis.com/fcm/send/${id}`],
		['backslashes', String.raw`https:\\fcm.googleapis.com\fcm\send`],
		['a username', `https://user@fcm.googleapis.com/fcm/send/${id}`],
		['a username and password', `https://user:secret@web.push.apple.com/${id}`],
		['an empty username', `https://@fcm.googleapis.com/fcm/send/${id}`],
		['another port', `https://fcm.googleapis.com:8443/fcm/send/${id}`],
		['the default port written out', `https://fcm.googleapis.com:443/fcm/send/${id}`],
		['a trailing dot', `https://fcm.googleapis.com./fcm/send/${id}`],
		['a trailing dot on a suffix host', `https://web.push.apple.com./${id}`],
		['a suffix host without a label', `https://.push.apple.com/${id}`],
		['an empty label', `https://web..push.apple.com/${id}`],
		['the bare suffix', `https://push.apple.com/${id}`],
		['a host that only ends like Apple', `https://evilpush.apple.com/${id}`],
		['a host that only ends like Microsoft', `https://evilnotify.windows.com/${id}`],
		['an allowed host under another domain', `https://push.apple.com.example.org/${id}`],
		['an exact host under another domain', `https://fcm.googleapis.com.example.org/${id}`],
		['a subdomain of an exact host', `https://evil.fcm.googleapis.com/${id}`],
		['an IDN that looks like Google', `https://fcm.googleаpis.com/fcm/send/${id}`],
		['localhost', `https://localhost/${id}`],
		['an IPv4 literal', `https://127.0.0.1/${id}`],
		['an IPv6 literal', `https://[::1]/${id}`],
		['a tailnet host', `https://stockpot.example.ts.net/${id}`],
		['one character too long', google + 'a'.repeat(maxEndpointLength - google.length + 1)],
		['an empty string', ''],
		['not a URL', faker.lorem.word()],
	])('refuses %s', (_case, endpoint) => {
		expect(isAllowedEndpoint(endpoint)).toBe(false)
	})
})
