# Engineering principles and decisions

This page is the yardstick for every change: stories are written against it, and pull requests are
reviewed against it. The [architecture](architecture.md) turns it into a module layout, and the
[guidelines](guidelines/README.md) turn it into everyday rules.

## Principles

Four principles, in priority order. When two of them disagree, the higher one wins.

1. **Performance, with measurements.** stockpot is used in short moments from a phone: a note has to
   be stored before the thought is gone, and Today has to appear before the reader gives up. The hot
   paths have [budgets](#performance-budgets), and a story that touches one names the number in its
   acceptance and shows how it was measured. A number comes from a benchmark, a trace or a log, never
   from intuition. In practice: saving a note writes a row and queues the research, it never waits for
   a model; the category suggestion uses the fastest engine without search; list and search queries
   hit indexes, which specs prove with `EXPLAIN QUERY PLAN`; pages render on the server and ship
   JavaScript only for the parts that need it.
2. **Simplicity.** Build the smallest thing that meets the goal. An abstraction, an option or a
   dependency arrives with the story that needs it, not before. One process and one SQLite file
   instead of a database server and a message broker; a jobs table instead of a queue service; one
   owner per instance instead of user management; server-rendered pages before client-side routing.
3. **Modularity.** Every concern has one module that owns it and a small interface in front of it.
   Other code goes through that interface, never around it. Features reach language models only
   through the engine contract and its router, background work only through the job runner, and
   secrets only through config and settings. Features do not import each other. This is also what
   lets several stories move in parallel without editing the same files.
4. **Readability.** New code looks like the code next to it: the same names, idioms and density of
   comments. A comment says why the code is the way it is (a provider quirk, a measured number, a
   finding with its date), not what the next line does.

## Performance budgets

Story acceptance checks these numbers. A story that changes one of these paths measures it before
and after and puts both figures in the pull request.

| Path                                 | Budget                    |
| ------------------------------------ | ------------------------- |
| Saving a note                        | p95 < 50 ms on the server |
| A category suggestion                | p95 < 1.5 s               |
| A server page render                 | < 100 ms                  |
| Today from the phone over Tailscale  | < 1 s to first screen     |
| A card from the agent command engine | p50 < 60 s                |
| An idea report                       | < 15 min                  |
| A nightly queue of 10 notes          | < 15 min                  |
| Server memory                        | < 200 MB RSS              |

The budgets start as targets. When a measurement shows that one is wrong, change it here in the
same pull request as the measurement, and say where the number came from.

## Story format

Every story is a GitHub issue with a title in the form `[ID] Imperative summary`. The ID names the
area and a running number:

| Prefix | Area                         | Prefix | Area                       |
| ------ | ---------------------------- | ------ | -------------------------- |
| `FND`  | Foundation: repository, docs | `WEB`  | Web app (PWA)              |
| `DES`  | Design canvas                | `DIG`  | Morning digest             |
| `ENG`  | Engines and card formats     | `OPS`  | Running an instance        |
| `SRV`  | Server core                  | `PUB`  | Release and public install |
| `CAP`  | Capture                      | `INT`  | Integrations               |
| `RES`  | Research pipeline            | `IOS`  | Native iOS app             |

The issue body states:

- **Size:** `size:S` fits one sitting and one pull request; `size:M` takes a day or two and
  several commits. There are no larger stories: a bigger one is split, or starts with a spike.
- **Depends on:** the stories that must land first.
- **Files:** the files and folders the story owns. Paths are relative to `packages/app/` unless the
  story says otherwise.
- **Design:** the canvas boards a UI story implements, once the canvas exists.
- A task list, and **Acceptance** criteria that someone else can check, including any budget the
  story touches.

Labels: `area:*` for the area, `size:*` for the size, `spike` for a time-boxed investigation whose
outcome is decisions and follow-up stories, and `needs-design` for a story that waits on canvas
boards. Stories are grouped into the milestones `SP · M0 Foundation` to `SP · M11 iOS app`; the
[roadmap](../ROADMAP.md) lists them, the [tracking issue](https://github.com/MrStnr21/stockpot/issues/76)
orders them, and the [project board](https://github.com/users/MrStnr21/projects/2) shows what is in
progress.

### Definition of done

A story is done when:

- its acceptance criteria pass, budgets included, with the measurements in the pull request;
- CI is green and the full check list in [CONTRIBUTING.md](../CONTRIBUTING.md#before-you-open-a-pull-request)
  passes locally;
- every user-facing change was tried in a browser, at phone width as well as desktop width;
- review found nothing that goes against the principles above.

## Parallel-work rules

Several stories are in flight at once: after M0, design, engines and the server core run as
separate lanes. These rules keep them out of each other's way.

1. **One owner per file set.** A story changes the files listed under **Files**. When it needs
   something from a module another open story owns, it uses that module's interface, or asks for the
   change in that story's issue, rather than editing the files itself.
2. **Migrations.** Schema changes add a new migration; a migration that shipped in a release is
   never edited, because running instances have already applied it. When two branches both change
   the schema, the one that merges second rebases and regenerates its migration. CI holds every
   migration on `main` to this: `bun run check:migrations` fails when one changes, or when a new one
   sorts before the last one there.
3. **Stubs over waiting.** If a dependency has not merged yet, code against its interface with a
   stub and delete the stub when the real module lands. Capture, for example, can save notes against
   a `suggest` stub that returns no categories while the engines are still being built.
4. **Access goes through one place.** Pages read the signed-in owner from `Astro.locals`, which the
   middleware sets. API routes declare their access with `route.public` or `route.authorized` from
   `src/server/http.ts`. Device tokens are checked in `src/server/auth/`. No story reads cookies,
   sessions or tokens on its own, so sign-in can change without touching the stories that depend on
   it.

## Decisions

The codebase is written against these decisions. To change one, open an issue and change this table
first; a decision that needs a longer argument gets an [ADR](adr/README.md).

| #   | Decision                                                                                                                                                                              | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Bun + Astro + Svelte 5 + Tailwind 4 + SQLite (`bun:sqlite`) + Drizzle + Valibot.**                                                                                                  | One runtime runs the server, the scripts, the tests and the package manager. Astro renders on the server and ships no JavaScript unless asked, which keeps the phone's first screen fast; Svelte 5 covers the interactive islands. SQLite is a file built into Bun, so there is no database server to run and a backup is a copy. Drizzle gives typed queries and generated migrations, and Valibot validates input and config in a few kilobytes that also work in the browser. |
| D2  | **One process, with jobs in a SQLite table** and a runner inside that process.                                                                                                        | A personal instance handles tens of notes a day. A broker or a second service would add moving parts and buy nothing. Jobs are rows, so they survive a restart, and "research now" overtakes the nightly batch by priority. Anything that assumes a single process stays behind the runner's interface.                                                                                                                                                                          |
| D3  | **Engines behind a contract:** the agent command engine, Gemini and any OpenAI-compatible endpoint.                                                                                   | Models, prices and free tiers change every few months, and every owner has different accounts. The contract lets each owner pick: a command-line agent they already run (they configure the command; no vendor defaults ship), Gemini, or a local or hosted OpenAI-compatible model. Switching providers is a settings change, and model IDs live in settings rather than in code.                                                                                               |
| D4  | **The PWA first, a native iOS app later** in its own repository.                                                                                                                      | One web app covers the phone, the desktop and Android. Web Push reaches an iPhone from the home screen without a developer account, so every self-hosted instance gets notifications, and updates ship with the server. The native app adds the share sheet, Siri, widgets and an offline queue on top of the same API, and keeps its own toolchain and release cycle out of this repository.                                                                                    |
| D5  | **One owner per instance, with device tokens.**                                                                                                                                       | stockpot is a personal tool, so there are no users, roles or sharing to build. The owner signs in on the web; every other client (a Shortcut, an MCP client, the iOS app) gets its own named token that can be revoked alone when a device is lost.                                                                                                                                                                                                                              |
| D6  | **Built for Tailscale, but safe on the open internet.**                                                                                                                               | A tailnet gives the phone a private route and the HTTPS that Web Push needs, with no ports to open. Self-hosters may still expose an instance, so nothing assumes a trusted network: sign-in backoff, CSRF checks, size limits and safe link checking ship with the features they protect.                                                                                                                                                                                       |
| D7  | **English UI with Russian localization, and the card language in settings.**                                                                                                          | An open-source audience reads English, and Russian is the first translation. The card language is separate from the UI language because people often use an interface in one language and want explanations in another.                                                                                                                                                                                                                                                          |
| D8  | **Issues, PRs, commits and docs in English, with `[ID] Summary` titles.**                                                                                                             | Anyone can follow the history. Each title names its story, so every commit and pull request leads back to the issue that explains why it exists, and `git log` reads like the roadmap.                                                                                                                                                                                                                                                                                           |
| D9  | **Public from the first commit,** so no keys or personal data in history, and secret scanning: gitleaks in CI, and in pre-commit gitleaks when it is installed, secretlint otherwise. | A public history cannot be taken back: a key that was pushed once has leaked. Everything specific to an instance lives in its environment and settings, and secret scanning stops a mistake before it leaves the machine and again on every pull request.                                                                                                                                                                                                                        |

## Out of scope for v0.1

v0.1 is milestones M0 to M9: capture, research, the web app, the morning digest, running on a Mac
and the public release. These are not part of it:

- **Integrations** (M10): an MCP server, a Telegram bot, export to Notion and capture from a macOS
  Quick Action.
- **The native iOS app** (M11), which lands in a separate repository.
- **Offline capture.** The web app needs the server to store a note; an offline queue comes with
  the iOS app.
- **More than one person per instance**, and sharing notes between instances.
- **Scaling out:** external databases, queues or more than one server process.
- **A hosted service.** Every instance is run by its owner.
