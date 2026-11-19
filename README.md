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

| Variable                 | Default                                | What it sets                                                                                                                                                                   |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `STOCKPOT_DATA_DIR`      | `data`, in the working directory       | The folder that holds the database                                                                                                                                             |
| `PORT`                   | `4321`                                 | The port the server listens on                                                                                                                                                 |
| `HOST`                   | `localhost`                            | The address the server listens on; `0.0.0.0` for every interface                                                                                                               |
| `STOCKPOT_PUBLIC_ORIGIN` | `http://localhost:` and the port       | The address you open stockpot at, such as `https://stockpot.example.ts.net`; set it when that is not the default                                                               |
| `STOCKPOT_SOURCE_URL`    | `https://github.com/MrStnr21/stockpot` | Where the source of your instance is published; point it at your fork if you change the code, as the AGPL asks (see below)                                                     |
| `STOCKPOT_AGENT_COMMAND` | unset                                  | The command template that runs your agent for the agent command engine ([how to write it](docs/engines.md#the-agent-command)); that engine is configured only when this is set |

The agent command is set only here, never in the app: a shell command that could be edited over
HTTP would turn any stolen session into shell access on your machine, and stockpot is built to
stay safe on the open internet. The app shows only whether it is set.

Until you save a time zone in the app, the digest follows the time zone of the machine stockpot
runs on (its `TZ`), or UTC when that is not a named zone.

Engine keys are stored in the database as plain text and never sent back to a browser, so keep the
data directory readable only by the account that runs stockpot, and treat its backups the same way.

## First run and signing in

An instance belongs to one owner. Until you create that owner, the server prints a one-time setup
code to its log every time it starts:

```text
stockpot has no owner yet. To claim this instance, open https://stockpot.example.ts.net/setup and enter the setup code 7K2M-Q9XD-4PRT-H8WN. ...
```

Open `/setup`, enter the code and choose a password of at least 12 characters. Only someone who can
read the server's log can claim the instance, so it is safe to start stockpot where others can
reach it. The code stops working once the owner exists, and a restart replaces it with a new one.

- **Sessions.** Signing in sets a cookie that is `HttpOnly`, `SameSite=Lax`, and `Secure` with the
  `__Host-` prefix when `STOCKPOT_PUBLIC_ORIGIN` is HTTPS. The database stores only a hash of its
  token. A session lasts 30 days and its token is replaced after a day of use, so a phone you open
  regularly stays signed in, and it survives a server restart. Signing out deletes it. A request that
  changes something counts the cookie only when the browser sends `Origin` or `Sec-Fetch-Site`; other
  clients use device tokens.
- **A copied cookie signs you out everywhere.** A replaced token works for one more minute, for
  requests already on their way. If it shows up after that, two browsers held the same token, so
  someone copied it, and stockpot ends every session: whichever browser got the new token first may
  be the copy. The same happens, rarely, when a response carrying a new token never reaches your
  browser, for example when the connection drops; then you sign in again.
- **Backoff.** Three wrong passwords in a row are free. After that each attempt waits twice as long
  as the one before, from 1 second up to 5 minutes, and an hour without a wrong password resets the
  count. The wait never grows further, so you are never locked out for good, and devices that are
  already signed in are not affected. The count is kept in memory for the whole instance and starts
  again when the server restarts.
- **A forgotten password.** Stop stockpot, delete the owner with
  `sqlite3 <data directory>/stockpot.db "DELETE FROM owner"`, and start it again: it prints a new
  setup code, and creating the owner again ends every old session.

## License

stockpot is free software, licensed under the GNU Affero General Public License, version 3 or any
later version (AGPL-3.0-or-later): see [LICENSE](LICENSE). If you run a modified version for others
over a network, offer them its source. Third-party packages keep their own licences, listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
