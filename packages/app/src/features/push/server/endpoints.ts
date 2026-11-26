// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors

/*
 * The push services the server sends to. A subscription's endpoint comes from a browser, and the server
 * later POSTs to it, so an endpoint anywhere else would let a client point the server at any host, an
 * internal one included. Only the four services that browsers use pass: Google's (Chrome, Edge on
 * Android), Mozilla's, Apple's (Safari, every iPhone browser) and Microsoft's (Edge on Windows).
 */

export const maxEndpointLength = 2048

const exactHosts = new Set(['fcm.googleapis.com', 'updates.push.services.mozilla.com'])

// Dot-anchored, so `evilpush.apple.com` and `push.apple.com.example.org` do not pass.
const hostSuffixes = ['.push.apple.com', '.notify.windows.com']

/* ASCII labels joined by single dots, with no empty label and no trailing dot. `URL` has already
 * lowercased the name and turned an IDN into punycode, and IP literals and `localhost` never match the
 * hosts above. */
const dnsName = /^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z\d](?:[a-z\d-]*[a-z\d])?$/u

/*
 * The text before the path must be exactly `https://` and the host: `URL` would quietly drop a `:443`,
 * read `https:host` or backslashes as `https://host`, so they are refused from the raw value instead.
 */
function hasPlainAuthority(value: string, hostname: string) {
	const origin = `https://${hostname}`
	const rest = value.slice(origin.length)

	return value.slice(0, origin.length).toLowerCase() === origin && /^(?:[/?#]|$)/u.test(rest)
}

/** Whether the server may send to this endpoint: an https URL on a known push service's host. */
export function isAllowedEndpoint(value: string): boolean {
	if (value.length > maxEndpointLength) {
		return false
	}

	const url = URL.parse(value)

	if (url?.protocol !== 'https:' || url.username !== '' || url.password !== '') {
		return false
	}

	if (url.port !== '' || !dnsName.test(url.hostname) || !hasPlainAuthority(value, url.hostname)) {
		return false
	}

	return (
		exactHosts.has(url.hostname) || hostSuffixes.some((suffix) => url.hostname.endsWith(suffix))
	)
}
