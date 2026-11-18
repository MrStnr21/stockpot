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
- After changing dependencies, also run `bun run notices -- --check`.

CI runs the same commands. `checks.yml` runs the fast part on every pull request: `check`, `test`,
`fmt:check` and `lint`, plus secret scanning. `ci.yml` runs the whole list on `main`, plus
`bun run notices -- --check`. `notices.yml` regenerates the third-party notices on pull requests
that change dependencies. Run the full list locally before you ask for review.

For a user-facing change, also try the flow in a browser at phone and desktop widths, and say in
the pull request what you checked.

## Git hooks

`bun install` installs [Lefthook](https://lefthook.dev) and the hooks defined in
[lefthook.yml](lefthook.yml):

- **pre-commit** formats the staged files with each workspace's Prettier config and stages the
  result, runs `bun run check:license` when source files are staged, regenerates and stages
  `THIRD_PARTY_NOTICES.md` when dependencies change, and scans for secrets;
- **pre-push** runs `bun run check` and `bun run lint`.

The hooks are a fast subset of the check list above, not a replacement for it. To run one by
hand: `bunx --no-install lefthook run pre-commit`.

## Branches, commits and pull requests

Every change starts from an issue. Most issues are stories from the roadmap; their format is in
[the principles](docs/principles.md#story-format). If there is no issue for your change yet, open
one with the [issue forms](https://github.com/MrStnr21/stockpot/issues/new/choose) first.

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

- **Pull request titles** are the story's title. The description has the same shape and ends with
  `Closes #n`, so merging closes the story. Fill in the pull request template.
- Keep a pull request to its story. Unrelated fixes get their own issue.
- Pull requests are **squash-merged** once CI is green, so the branch's history can be as granular
  as is useful.

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
