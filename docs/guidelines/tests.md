# Tests

Paths starting with `src/` or `tests/` are relative to `packages/app/`.

## Running tests

```sh
bun run test                               # every workspace, from the repository root
bun test                                   # one workspace, from its folder
bun test ./src/server/jobs/runner.spec.ts  # one file
bun run e2e                                # Playwright, from the repository root
```

Unit tests use `bun:test`. In the app, a preload set in `bunfig.toml` seeds Faker so that test
data is the same on every run.

## Spec files

Every unit test is a spec next to the module it tests: `runner.ts` is tested in `runner.spec.ts`,
and a route `[id].ts` in `[id].spec.ts`. Import the test API from `bun:test`.

- **One top-level `describe`** per file, named for the unit under test: a function, a module, a
  route or a page, such as `describe('normalizeTerm', …)` or `describe('POST /api/notes', …)`.
  Further groups are nested `describe`s. No `it` and no hook sits at module level.
- **Hooks are scoped.** Put `beforeAll`, `beforeEach`, `afterAll` and `afterEach` in the innermost
  `describe` whose tests need them. Set up `spyOn` and `mock` inside such a hook, not at module
  level.
- **`it`, never `test`.** Use `it`, `it.each`, `it.todo` and `it.skip`, and name each one for the
  behavior it checks: `it('returns 400 for an empty note')`.
- Imports, constants, factories and `createTestDb()` may stay at module level.

```ts
import { beforeEach, describe, expect, it } from 'bun:test'

import { normalizeTerm } from './normalize'

describe('normalizeTerm', () => {
  describe('with surrounding punctuation', () => {
    let term: string

    beforeEach(() => {
      term = normalizeTerm('  "Bun!" ')
    })

    it('keeps only the word', () => {
      expect(term).toBe('bun')
    })
  })
})
```

The `specs/structure` lint rule in `tools/lint/specs.ts` (repository-root path) checks this
layout, and `bun run lint` fails on a spec that breaks it.

## Factories

Build test data with [Fishery](https://github.com/thoughtbot/fishery) factories that use Faker
directly. Shared factories live in `tests/factories/`, one file per kind of data, named for what
they build: `noteFactory`, `categoryFactory`.

- Set only the values the test checks or needs for its setup; let the factory fill in the rest.
- Make presets with `.params()`, and lists with `.buildList()` or `.createList()`.
- Let built data infer its type; do not annotate it at the call site.
- Name data for what it stands for (`privateNote`, `englishCategory`), not `data` or `item`.
- Prefer factories to recorded JSON. When a recorded fixture is needed, such as a real engine
  response, import the JSON file.

## The test database

`createTestDb()` from `tests/setup/db.ts` opens an in-memory SQLite database, applies the
migrations and turns on foreign keys. Create one per spec file and pass its `db` to factories and
to the code under test. A spec that guards a query budget can also assert the plan with
`EXPLAIN QUERY PLAN` and fail when an index stops being used.

## Assertions and mocks

- Check an object's shape with one `toMatchObject` (a subset) or `toEqual` (the whole value)
  instead of one assertion per field.
- Prefer `spyOn` to `mock.module`. For frozen values such as config, give the function a defaulted
  parameter so a test can pass its own value without replacing the module.
- Control time with `setSystemTime` and fake timers from `bun:test`; never wait for real time.
- Unit tests never call a real engine or the network. Engines are tested against recorded
  responses; their quality is measured separately by the eval runner (ENG-2).

## End-to-end tests

Playwright specs live in `tests/e2e/` and run against a production build with `bun run e2e`. The
first run needs a browser: `bunx playwright install chromium`. Playwright has no `it`, so these
specs use `test`, wrapped in one top-level `test.describe`, with `test.beforeEach` and the other
hooks scoped inside it. Cover the flows a person actually takes (capture a note, open Today, act on
a card), at phone width as well as desktop width.
