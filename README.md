# stockpot

> Toss in the scraps of your day. Wake up to broth.

**Work in progress.** Nothing here runs as a product yet: the repository is being set up, and the
first release is tracked in [#76](https://github.com/MrStnr21/stockpot/issues/76).

stockpot is a self-hosted inbox for the unfamiliar terms, words and ideas you run into during the
day. Drop them in from your phone or your desktop; overnight, a language model of your choice
researches each one, and in the morning you get a short digest of cards to read.

## Development

stockpot is a [Bun](https://bun.sh) workspace: an [Astro](https://astro.build) server with
[Svelte](https://svelte.dev) components and [Tailwind CSS](https://tailwindcss.com), in
`packages/app`, and shared UI primitives in `packages/ui`.

```sh
bun install
bun run dev     # http://localhost:4321
bun run build
```

## License

stockpot is free software, licensed under the GNU Affero General Public License, version 3 or any
later version (AGPL-3.0-or-later): see [LICENSE](LICENSE). If you run a modified version for others
over a network, offer them its source. Third-party packages keep their own licences, listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
