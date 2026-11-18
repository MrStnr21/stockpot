# Architecture

How the code is laid out and which parts may depend on which. The
[engineering principles](principles.md) explain why; this page explains where. Paths in the
`packages/app/src/` sections are relative to `packages/app/`.

## The shape of the system

stockpot is one server process with one SQLite file. The phone and the desktop talk to it over
HTTPS, normally through Tailscale.

```
 phone / desktop                     stockpot server (one Bun process)                 engines
 ───────────────                     ─────────────────────────────────                 ───────
 web app (PWA) ── HTTPS ──▶  middleware ─▶ page or API route ─▶ feature ─▶ server/db
 Shortcut, apps ─ token ──▶                                       │
                                                                  ▼ enqueue
                                             job runner ─▶ research ─▶ engine router ─▶ agent command
                                                  │                                     Gemini
 Web Push ◀──────────────────────────────── digest, "ready" pushes                     OpenAI-compatible
```

Saving a note stores a row and returns; research always happens in a job, either right away
("research now") or in the nightly batch. Features reach the models only through the engine router.

## Repository layout

```
stockpot/
├── packages/
│   ├── app/            @stockpot/app: the Astro server, pages and the web app
│   │   ├── src/        see below
│   │   ├── tests/      setup/ (seeded Faker, createTestDb), factories/, e2e/
│   │   └── evals/      the eval set and rubric for card quality (upcoming, ENG-2)
│   ├── ui/             @stockpot/ui: shared primitives and theme tokens, source exports, no build step
│   └── website/        the documentation site (M9)
├── tools/              @stockpot/tools: lint plugins, the license header check, third-party
│                       notices, the docs link check and the migration check; later evals
├── docs/               principles, architecture, guidelines, ADRs; later engines, design canvas,
│                       install and privacy
├── deploy/             launchd service for a Mac, Docker image and compose file (M8, M9)
├── skills/             operator skills for installing and running an instance (M9)
└── .github/            workflows, issue forms, pull request template
```

`packages/app/evals/`, `packages/website`, `deploy/` and `skills/` do not exist yet; they arrive
with the story and milestones named above.

## The app: `packages/app/src/`

```
src/
├── pages/          Thin Astro pages and API routes: parse the request, call a feature, render
├── layouts/        The app shell and tab bar
├── components/     App-wide UI built from @stockpot/ui primitives
├── features/       One folder per product area:
│   ├── capture/        the capture sheet, history matching, category suggestions
│   ├── notes/          the notes list, filters, search, multi-select
│   ├── categories/     categories and the card format each one uses
│   ├── research/       research jobs, card formats, link checks, depth levels
│   ├── digest/         the nightly batch, Today, carry-over, archive, weekly summary
│   ├── push/           Web Push subscriptions and sending
│   ├── settings/       runtime settings stored in the database
│   └── integrations/   optional outside services (after v0.1)
├── server/         Shared server capabilities, no product logic:
│   ├── db/             Drizzle schema, migrations and the SQLite connection
│   ├── jobs/           the job runner and daily schedules
│   ├── auth/           the owner account, sessions and device tokens
│   ├── engines/        the engine contract, concrete engines and the router
│   ├── http.ts         route helpers, JSON errors, body limits
│   ├── config.ts       the validated environment
│   └── metrics.ts      Prometheus metrics, next to health and logs
├── lib/            Isomorphic utilities: term normalization, dates and time zones
├── middleware.ts   Resolves the owner or device for every request
└── sw.ts           The service worker: offline shell and push handling, browser code only
```

Most of these folders are still empty: each arrives with the story that needs it. A feature can be
a single file or a folder of these parts:

- `server/` or `server.ts`: server code, the feature's interface for pages and other entry points;
- `shared/`: isomorphic code and types used on both sides (always a folder);
- `client/` or `client.ts`, and `.svelte` files at the feature root: code that runs in the browser;
- `.astro` files in `client/` or at the feature root: markup rendered on the server;
- any other file at the feature root, such as `index.ts`, is server code: it may import what
  feature server code may, and the feature's client code may not import it.

## Dependency rules

[`packages/app/oxlint.config.ts`](../packages/app/oxlint.config.ts) enforces this table through
`eslint-plugin-boundaries`, and `bun run lint` fails on any import that breaks it. Relative and
`#/` imports are checked alike. The first row that matches a file decides its layer. Paths are
relative to `packages/app/src/`, except `tests/`, which sits next to `src/`.

| Layer                          | Files                                                                | May import                                                                      |
| ------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Server                         | `server/**`                                                          | `server/`, `lib/`                                                               |
| Lib                            | `lib/**`                                                             | `lib/`                                                                          |
| Astro components               | `components/**/*.astro`                                              | `server/`, `lib/`, `components/`                                                |
| Other components               | the rest of `components/**` (`.svelte`, `.ts`)                       | `lib/`, `components/`                                                           |
| Feature server                 | `features/X/server/**`, `features/X/server.*`                        | `server/`, `lib/`; own feature's server, shared and root files                  |
| Feature shared                 | `features/X/shared/**`                                               | `lib/`, own feature's shared; `server/` for types only (`import type`)          |
| Feature server-rendered markup | `features/X/client/**/*.astro`, `features/X/*.astro`                 | `server/`, `lib/`, `components/`; own feature's server, shared, root and client |
| Feature client                 | `features/X/client/**`, `features/X/client.*`, `features/X/*.svelte` | `lib/`, `components/`; own feature's shared and client, not its root            |
| Feature root                   | any other file in `features/X/`                                      | same as feature server                                                          |
| Service worker                 | `sw.ts`                                                              | `lib/`, any feature's shared                                                    |
| Entry                          | everything else in `src/`: `pages/`, `layouts/`, `middleware.ts`     | every layer above, including any feature                                        |
| Test support                   | `tests/**`: setup, factories and end-to-end specs                    | every layer above, and `tests/`                                                 |

Four rules apply across the table:

- **Features never import each other.** Every "own feature" entry means the importing file's own
  folder; only entry files and the service worker reach into other features. When two features need
  the same thing, it moves into `server/`, `lib/` or `components/`, or a page composes the two.
- **Packages and runtime built-ins are allowed everywhere, except in browser code.** Lib, feature
  shared, feature client, the non-Astro components and `sw.ts` must not import `node:*`, `bun` or
  `bun:*`, because they run in the browser.
- **No import cycles.** `import/no-cycle` fails on runtime cycles; type-only cycles are allowed.
- **Only tests import `tests/`.** A `*.spec.ts` file keeps the row of the folder it sits in, and may
  also import packages, runtime built-ins such as `bun:test`, and `tests/`, whatever its layer.
  Apart from specs, only other files in `tests/` may import it: app code never depends on test
  support.

Because `server/` may not import features, the direction of calls is always feature → server. When
a capability in `server/` needs to run feature code (a job handler, for example), the feature
registers it with that capability at startup instead of being imported by it.

### The UI package

`packages/ui` stands alone. Its [oxlint config](../packages/ui/oxlint.config.ts) forbids `node:*`,
`bun` and `bun:*`, because the components run in the browser, and any import of the app at any
depth: `@stockpot/app`, `@stockpot/app/**` or a relative path into `app/src`. UI specs run on Bun
and may import `bun:test`, but still never the app. Inside the package, modules use relative
imports. The app imports a primitive by its folder and the theme by its CSS entry:

```ts
import { Wordmark } from '@stockpot/ui/wordmark'
```

```css
@import '@stockpot/ui/theme.css';
```

## The engine contract boundary

Language models change faster than anything else in the product, so they sit behind one boundary
in `src/server/engines/`:

- **The contract** (`contract.ts`, ENG-1) has three tasks: `suggest` proposes categories for a note
  while it is typed, `explain` writes a card in a category's format, and `research` writes a longer
  report for an idea. A failure is one of four error kinds: `rate_limited` (with the time the limit
  resets), `auth`, `timeout` and `invalid` (output that does not match the schema).
- **Concrete engines** implement the contract: the agent command engine (`agent-cli.ts`), Gemini
  (`gemini.ts`) and any OpenAI-compatible endpoint (`openai-compatible.ts`). Provider SDKs and
  command-line details stay inside these files.
- **The router** (`router.ts`, ENG-6) picks an engine for each task and category from a routing
  table, falls back to the next engine on `rate_limited` or `auth`, marks fallback output as a draft
  and queues it to be redone by the primary engine once the limit resets.

Everything outside `src/server/engines/` calls the router with contract types and never imports a
concrete engine or a provider SDK. The research feature owns the card formats and passes the format's
schema with each call, so engines stay free of feature imports. Lint does not tell one `server/`
module from another, so review checks this boundary. The formats, prompts, privacy rule and
routing table are recorded with the contract in `docs/engines.md` (ENG-1).

## One process and the job runner

`bun run start` runs the built Astro server; that same process runs the job runner. There is no
second service, broker or cache server ([D2](principles.md#decisions)).

The runner in `src/server/jobs/` (SRV-6) keeps jobs as rows in SQLite: kind, payload, priority, the
time to run, attempts, status and the last error. One worker takes jobs in priority order, so a
"now" job overtakes the nightly batch. Failed jobs retry with backoff, and jobs that were running
when the process stopped go back to the queue on the next start. Daily schedules, such as the
nightly batch and the morning digest, fire in the time zone from settings.

Request handlers never call a model or wait for slow work: they enqueue a job and return. Anything
that only works with a single process, such as the worker lock or an engine's usage counters, stays
behind a small interface so it could move to a shared store if that ever became necessary.

## Recording decisions

Standing decisions live in the [decisions table](principles.md#decisions). A decision that needs
more room, such as weighed alternatives, measurements or a costly reversal, gets an
[architecture decision record](adr/README.md).
