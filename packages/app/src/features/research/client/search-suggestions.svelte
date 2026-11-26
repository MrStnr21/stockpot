<!--
	SPDX-License-Identifier: AGPL-3.0-or-later
	SPDX-FileCopyrightText: 2026 The stockpot authors
-->
<script lang="ts">
	import { suggestionsDocument } from './card-screen'

	interface Props {
		/** Google's Search Suggestions HTML, as the engine stored it. */
		html: string
		title: string
	}

	const { html, title }: Props = $props()
</script>

<!--
	Google's terms ask for the suggestions as given, so they render unmodified, but in a frame with no
	scripts and no access to this origin: its links open a new tab and send no referrer.
-->
<iframe
	{title}
	srcdoc={suggestionsDocument(html)}
	sandbox="allow-popups allow-popups-to-escape-sandbox"
	referrerpolicy="no-referrer"
	loading="lazy"
	class="h-suggestions w-full border-0"
></iframe>
