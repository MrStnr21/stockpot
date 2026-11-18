# Tests

Paths starting with `src/` or `tests/` are relative to `packages/app/`.

## Running tests

```sh
bun run test                               # every workspace, from the repository root
bun test                                   # one workspace, from its folder
bun test ./src/server/jobs/runner.spec.ts  # one file
bun run e2e                                # Playwright, from the repository root
```

Unit tests use `bun:test`. In the app, `bunfig.toml` finds specs in `src/` and next to the helpers
in `tests/`, leaves `tests/e2e/` to Playwright, and preloads `tests/setup/faker.ts`, which seeds
Faker once so that generated data, and any failure it causes, repeats exactly. Import the shared
helpers through the `#tests/` alias, such as `#tests/setup/db`.

## Spec files

Every unit test is a spec next to the module it tests: `runner.ts` is tested in `runner.spec.ts`,
and a route `[id].ts` in `[id].spec.ts`. Import the test API from `bun:test`. A spec keeps the
import rules of the folder it sits in, plus `bun:test` and the helpers in `tests/` (see the
[dependency rules](../architecture.md#dependency-rules)).

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
layout in every workspace's specs, and `bun run lint` fails on a spec that breaks it. Oxlint's own
`jest` and `vitest` rules cannot do this: they skip files that import from `bun:test`.

## Factories

Build test data with [Fishery](https://github.com/thoughtbot/fishery) factories that use Faker
directly. Shared factories live in `tests/factories/`, one file per kind of data, named for what
they build: `noteFactory`, `categoryFactory`.

- A factory that persists rows takes the spec's database as a transient parameter
  (`DbTransientParams` from `#tests/factories/db`):
  `await noteRowFactory.transient({ db }).create({ text: 'Bun' })`.
- Set only the values the test checks or needs for its setup; let the factory fill in the rest.
- Make presets with `.params()`, and lists with `.buildList()` or `.createList()`.
- Let built data infer its type; do not annotate it at the call site.
- Name data for what it stands for (`privateNote`, `englishCategory`), not `data` or `item`.
- Prefer factories to recorded JSON. When a recorded fixture is needed, such as a real engine
  response, import the JSON file.

## The test database

`createTestDb()` from `#tests/setup/db` (`tests/setup/db.ts`) opens an in-memory SQLite database,
applies every migration from `src/server/db/migrations/` and turns on foreign keys, the way the
server opens its file. It returns `{ sqlite, db }`: pass `db` to factories and to the code under
test. Each call is a fresh database, so create one per spec file, or per `describe` when tests must
not see each other's rows. A spec that guards a query budget can also assert the plan with
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

Playwright specs live in `tests/e2e/`. `bun run e2e` builds the app and runs them against the
production server (`playwright.config.ts`). The first run needs a browser:
`bunx playwright install chromium`.

Playwright has no `it`, so these specs use `test`, wrapped in one top-level `test.describe`, with
`test.beforeEach` and the other hooks scoped inside it. The Playwright lint rules check this, and
also reject focused or skipped tests, conditionals inside a test, fixed waits and missing `await`s.
Cover the flows a person actually takes: capture a note, open Today, act on a card.
