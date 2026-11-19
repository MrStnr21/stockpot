# Components

Paths starting with `src/` are relative to `packages/app/`. Follow the [styling](styling.md) rules
and the [design canvas](../design-canvas/README.md).

## Astro or Svelte

- **Astro** renders markup on the server and ships no JavaScript. Use it for pages, layouts and any
  component that does not react to the user after the page loads.
- **Svelte 5** is for interactivity: the capture sheet, filters, one-tap card actions. Write
  components in runes mode: `$props()` for props, `$state` and `$derived` for state, `$effect` only
  to synchronize with something outside Svelte. Do not use Svelte 4 syntax such as `export let`,
  `$:` or `on:click`.
- A component used both on server-rendered pages and inside interactive islands is written once,
  as `.svelte`. Astro renders it without client JavaScript unless a `client:` directive asks for
  it.
- Hydrate as little and as late as works: a `client:` directive only on the island that needs it,
  and `client:visible` or `client:idle` unless the island must respond the moment the page loads.
  Every island counts against the page render and first-screen [budgets](../principles.md#performance-budgets).

## Where components live

- **Primitives** (buttons, fields, sheets, chips) live in `@stockpot/ui`, one folder per primitive
  in `packages/ui/src/components/<name>/` (repository-root path), with an `index.ts` that
  re-exports its public parts. Import them by folder with named imports:

  ```ts
  import { Wordmark } from '@stockpot/ui/wordmark'
  ```

  A primitive's `index.ts` is the only kind of barrel file; do not add others. Primitives know
  nothing about the app: no app imports, no fetching, no runtime built-ins.

- **App-wide components** that combine primitives (the tab bar, an empty state) live in
  `src/components/`.
- **Feature components** live in their feature, in `client/` or at the feature root. Follow the
  [dependency rules](../architecture.md#dependency-rules): a `.svelte` file or client script
  imports only `lib/`, `components/` and its own feature's `shared/` and client code, never
  `server/`, its feature's server or root files, or runtime built-ins. A server-rendered `.astro`
  file may also import server code.

## Composition and props

- Compose with children rather than data props: `<Tabs><Tab /></Tabs>`, not
  `<Tabs items={[…]} />`. Each child takes its own props, such as `variant`.
- Type props with an `interface Props` and read them with `$props()` in Svelte or `Astro.props`
  in Astro.
- Accept `null` wherever the underlying data can be null, so callers do not convert it.
- Name a variant for how it looks (`subtle`, `outline`), not for the feature that uses it. Sizes
  are `sm`, `md` and `lg`.

## Accessibility

Use native elements (`button`, `a`, `input`, `dialog`) before ARIA roles. Every control has an
accessible name, every image that carries meaning has alternative text, and everything works with
a keyboard and a screen reader as well as by touch.
