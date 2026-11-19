# Code

Paths starting with `src/` or `tests/` are relative to `packages/app/`.

## Naming

- **Files** are lowercase kebab-case, components included: `capture-sheet.svelte`,
  `check-links.ts`. Astro routes take their parameter's name in brackets, such as `[id].ts`.
- **Identifiers:** `camelCase` for values and functions, `PascalCase` for types and components.
  Name a function for what it does (`suggestCategories`), a boolean for what it states (`isPrivate`,
  `hasSources`).
- **Use the product's words** so code, issues and the interface agree:

| Term     | Meaning                                                                      |
| -------- | ---------------------------------------------------------------------------- |
| note     | what the owner captures: a word, term, phrase or idea, with optional context |
| category | the kind of note; it decides the card format                                 |
| card     | the explanation an engine writes for a note, in its category's format        |
| term     | the normalized text of a note, used to spot repeats                          |
| engine   | a language model provider behind the engine contract                         |
| job      | a unit of background work in the job runner                                  |
| digest   | the set of cards picked for one morning, shown on the Today tab              |
| Base     | the cards the owner chose to keep                                            |

## Comments

A comment explains why the code is the way it is: a provider quirk, a measured number, a decision
and its date, a constraint that is not visible in the code. Do not restate what the next line
does. A comment that runs past one line uses a `/* … */` block rather than stacked `//` lines.

## License headers

Every source file starts with a two-line SPDX header in its own comment syntax:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The stockpot authors
```

CSS uses one `/* … */` block, Astro frontmatter uses `//` inside the `---` fence, Svelte and HTML
use an `<!-- … -->` block, and YAML, TOML and shell scripts use `#`. A shebang line may come first.
Markdown and JSON files have no header; the [LICENSE](../../LICENSE) covers them.
`bun run check:license` fails on a source file without one, and the pre-commit hook runs it.

The copyright line always names `The stockpot authors`, never a person. Code copied from
elsewhere keeps its original `SPDX-FileCopyrightText` line next to ours, and may be copied only
when its license is compatible with AGPL-3.0-or-later. Code under AGPL-3.0-only is not: write
it fresh instead.

## Imports

- Import app modules through the `#/` alias (`#/server/http`) rather than long relative paths;
  imports inside the same folder may stay relative.
- Import UI primitives by folder: `import { Wordmark } from '@stockpot/ui/wordmark'`.
- Prettier sorts imports: runtime built-ins, packages, then `#/` aliases, then relative paths.
- Respect the [dependency rules](../architecture.md#dependency-rules); `bun run lint` fails on an
  import that crosses them, and on a runtime import cycle.

## Lint

`bun run lint` runs oxlint in every workspace with `--deny-warnings`, so every diagnostic fails
the check. Each workspace's `oxlint.config.ts` spreads the shared settings in
[`tools/lint/base.ts`](../../tools/lint/base.ts), which build on the `@configg/bases` presets;
the app adds its import boundaries. Type-aware rules run on tsrs through
[`tools/lint/tsrs-lint.ts`](../../tools/lint/tsrs-lint.ts), which the lint scripts set as
`OXLINT_TSGOLINT_PATH`, so run oxlint through `bun run lint` rather than directly. Type checking
is separate: `bun run check` runs `astro check` in the app and the UI package and `tsc` in the
tools.

When lint reports something:

1. **Fix the code.** Do not rewrite the same thing in a form the rule cannot see.
2. **Suppress only a real false positive,** or a case oxlint cannot express correctly. Suppress
   one line, name the rule, and give the reason on the same line after `--`:

   ```ts
   // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The schema was validated above.
   ```

3. **Never** add file-wide suppressions, `eslint-disable` comments or config-level `off` entries to
   get a change through.

A suppression must not outlive its violation: `reportUnusedDisableDirectives` is an error, so an
unused one fails lint. `bun run lint:fix` applies the automatic fixes; review its diff before you
keep it.

The configs carry a few permanent exceptions, each with its reason next to it: `no-undef` is off
in `.svelte` files and `no-useless-assignment` in `.astro` files because oxlint cannot see across
their script blocks and templates; `unicorn/filename-case` is off because routes are named after
their parameters; the Testing Library rules are dropped because specs run without a DOM;
`init-declarations` is off in specs, which declare `let` state and assign it in a hook; and
`no-console` is off in `tools/`, whose programs report on the console. These do not license
switching off further rules.

## Formatting

Every workspace formats its own files with Prettier and the `@configg/bases` preset; the root
formats documentation, workflows and manifests. `bun run fmt` formats everything and
`bun run fmt:check` is what CI runs. The pre-commit hook formats staged files, so most changes need
nothing else.

## Input and errors

Validate everything that comes from outside (request bodies, query strings, environment, engine
output) with Valibot at the edge, before it reaches feature code. Invalid input from a client is a
400 with a JSON error, never an exception from deep inside. API routes declare their access with
`route.public`, `route.authorized` or `route.session` (the owner signed in on the web, not with a
device token) from `src/server/http.ts`; there are no bare routes.

## Dependencies

Packages that ship in the server or the browser bundle go in `dependencies`; build, lint and test
tools go in `devDependencies`. Add a dependency only when a story needs it, and check that its
license is compatible with AGPL-3.0-or-later. After changing dependencies, run
`bun run notices -- --check`.

## Secrets and personal data

The repository is public from its first commit ([D9](../principles.md#decisions)). Keys, tokens,
passwords and anything that identifies a person or a machine never go into code, tests, fixtures
or commit messages. They belong in the environment or in settings. Test data comes from factories
and Faker, not from real accounts. Secret scanning runs before every commit and on every pull
request; if it fires, remove the secret and rotate it, even if the commit never left your machine.
