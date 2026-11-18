# Contributing to stockpot

Thank you for helping. This guide covers setting up the repository, the checks a change must
pass, and how branches, commits and pull requests are written and reviewed. The rules for the code
itself are in the [engineering principles](docs/principles.md), the
[architecture](docs/architecture.md) and the [guidelines](docs/guidelines/README.md).

## Setup

Use the Bun version pinned in `packageManager` in the root [package.json](package.json). From the
repository root:

```sh
bun install       # every workspace, plus the Git hooks
bun run dev       # the app at http://localhost:4321
bun run build     # a production build
bun run start     # serve the production build
```

The repository is a Bun workspace with one lockfile, `bun.lock`, at the root:

- `packages/app` (`@stockpot/app`): the Astro server with Svelte components and Tailwind;
- `packages/ui` (`@stockpot/ui`): shared UI primitives and theme tokens, exported as source with
  no build step (see its [README](packages/ui/README.md));
- `tools` (`@stockpot/tools`): lint settings and repository checks.

## Before you open a pull request

Run the full check list from the repository root, in this order:

```sh
bun install --frozen-lockfile
bun run check
bun run test
bun run fmt:check
bun run lint
bun run check:license
bun run check:links
bun run check:migrations
bun run build
bun run e2e
```

- `check` type-checks every workspace. Run it before `lint`: `astro check` generates the Astro
  types that the app's `tsconfig.json` includes.
- `test` runs the unit specs of every workspace; `e2e` builds the app and runs the Playwright
  suite. The first `e2e` run needs a browser: `bunx playwright install chromium`.
- `fmt:check` and `lint` fail on any formatting difference or lint diagnostic. `bun run fmt`
  formats everything; `bun run lint:fix` applies automatic lint fixes, so review its diff.
- `check:license` fails on a source file without its SPDX header, and `check:links` on a broken
  relative link or anchor in the Markdown files.
- `check:migrations` fails when your branch changed a database migration that is on `origin/main`,
  or added one that sorts before the last migration there; run `git fetch origin main` first. See the
  [migrations README](packages/app/src/server/db/migrations/README.md).
- After changing dependencies, also run `bun run notices -- --check`.

CI runs the same commands. `ci.yml` runs the whole list on every pull request and every push to
`main`, plus a gitleaks scan of the history; on `main` it also runs `bun run notices -- --check`.
`notices.yml` regenerates the third-party notices on pull requests that change dependencies. A pull
request can be merged only when the `ci.yml` jobs pass. Run the full list locally before you ask for
review: it is faster than waiting for CI to find the same failure.

For a user-facing change, also try the flow in a browser at phone and desktop widths, and say in
the pull request what you checked.

## Git hooks

`bun install` installs [Lefthook](https://lefthook.dev) and the hooks defined in
[lefthook.yml](lefthook.yml):

- **pre-commit** formats the staged files with each workspace's Prettier config and stages the
  result, runs `bun run check:license` when source files are staged, regenerates and stages
  `THIRD_PARTY_NOTICES.md` when dependencies change, and scans the staged changes for secrets
  (with gitleaks when it is installed, otherwise with secretlint);
- **pre-push** runs `bun run check` and `bun run lint`.

The hooks are a fast subset of the check list above, not a replacement for it. To run one by
hand: `bunx --no-install lefthook run pre-commit`.

## Branches, commits and pull requests

Every change starts from an issue. Most issues are stories from the roadmap; their format is in
[the principles](docs/principles.md#story-format). If there is no issue for your change yet, open
one with the [issue forms](https://github.com/MrStnr21/stockpot/issues/new/choose) first.

Every title starts with an ID in brackets. A roadmap story uses its own, such as `[CAP-1]`.
Work outside the roadmap takes `[BUG-<n>]` for a bug fix or `[FEATURE-<n>]` for a new feature,
with running numbers: the first bug fix is `BUG-1`, the next `BUG-2`.

- **One story, one branch, one pull request.** Branch from `main` and name the branch after the
  story in lower case, such as `fnd-6-docs`.
- **Commit titles** follow `[ID] Imperative summary`. The body is one paragraph on why the change
  is needed, then a list of what changed, then a reference to the issue:

  ```text
  [CAP-1] Add the notes API

  Capture needs a single place that stores notes, so every entry point saves them the same way.

  - Add POST /api/notes with Valibot validation
  - Store the note and queue its research job

  Refs: #28
  ```

- **Pull request titles** are the story's title. Fill in the pull request template: **Problem**
  says why the change is needed, **Behaviour** what changes for a user or a contributor, **Issue**
  holds `Closes #n` so that merging closes the story, and **Checks run** ticks the checks you ran.
- Keep a pull request to its story. Unrelated fixes get their own issue.
- Pull requests are **squash-merged** once CI is green, so the branch's history can be as granular
  as is useful. The squashed commit's subject is `[ID] Summary (#<PR>)`, and its body has the
  commit shape above, ending with `Closes #<n>` instead of `Refs`.

## Review

Every change is reviewed against the [engineering principles](docs/principles.md) in their order
(performance, simplicity, modularity, readability) and against the story's acceptance criteria.
Expect questions about measurements for anything on a budgeted path.

Answer every review comment: fix what is valid, and explain what you decline. After each update,
rerun the checks the change affects. A pull request is merged only when CI is green and every
comment has an answer.

## Guidelines

- [Runtime](docs/guidelines/runtime.md): Bun APIs over Node, imported from `bun`.
- [Code](docs/guidelines/code.md): naming, comments, license headers, lint suppressions and
  secrets.
- [Tests](docs/guidelines/tests.md): specs next to the code, factories, the test database and
  end-to-end tests.
- [Styling](docs/guidelines/styling.md): the design canvas first, Tailwind and theme tokens.
- [Components](docs/guidelines/components.md): Astro or Svelte, primitives from `@stockpot/ui`.
- [Architecture decision records](docs/adr/README.md): when a decision needs more than a row in
  the decisions table.

## License of contributions

stockpot is licensed under the GNU Affero General Public License, version 3 or any later version
(AGPL-3.0-or-later); see [LICENSE](LICENSE). By contributing, you agree that your contribution is
licensed the same way.
