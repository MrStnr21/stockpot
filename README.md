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

[CONTRIBUTING.md](CONTRIBUTING.md) covers setup, the full check list and how branches, commits and
pull requests are written. The rules the code follows are in [docs/](docs/): the
[engineering principles](docs/principles.md), the [architecture](docs/architecture.md) and the
[contributor guidelines](docs/guidelines/README.md). What comes next is in the
[roadmap](ROADMAP.md).

## Configuration

An instance reads a few environment variables when it starts, and stops with a message naming the
variable when one is invalid. Every other setting is changed in the app and stored in the database.

| Variable                 | Default                                | What it sets                                                                                                               |
| ------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `STOCKPOT_DATA_DIR`      | `data`, in the working directory       | The folder that holds the database                                                                                         |
| `PORT`                   | `4321`                                 | The port the server listens on                                                                                             |
| `HOST`                   | `localhost`                            | The address the server listens on; `0.0.0.0` for every interface                                                           |
| `STOCKPOT_PUBLIC_ORIGIN` | `http://localhost:` and the port       | The address you open stockpot at, such as `https://stockpot.example.ts.net`; set it when that is not the default           |
| `STOCKPOT_SOURCE_URL`    | `https://github.com/MrStnr21/stockpot` | Where the source of your instance is published; point it at your fork if you change the code, as the AGPL asks (see below) |
| `STOCKPOT_AGENT_COMMAND` | unset                                  | The command line that runs your agent for the agent command engine; that engine is configured only when this is set        |

The agent command is set only here, never in the app: a shell command that could be edited over
HTTP would turn any stolen session into shell access on your machine, and stockpot is built to
stay safe on the open internet. The app shows only whether it is set.

Until you save a time zone in the app, the digest follows the time zone of the machine stockpot
runs on (its `TZ`), or UTC when that is not a named zone.

Engine keys are stored in the database as plain text and never sent back to a browser, so keep the
data directory readable only by the account that runs stockpot, and treat its backups the same way.

## License

stockpot is free software, licensed under the GNU Affero General Public License, version 3 or any
later version (AGPL-3.0-or-later): see [LICENSE](LICENSE). If you run a modified version for others
over a network, offer them its source. Third-party packages keep their own licences, listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
