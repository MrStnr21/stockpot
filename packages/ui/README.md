# @stockpot/ui

Shared UI primitives and theme tokens for stockpot. The package exports its source files without a
build step: the app compiles them.

```ts
import { Wordmark } from '@stockpot/ui/wordmark'
```

```css
@import '@stockpot/ui/theme.css';
@import '@stockpot/ui/fonts.css';
```

`fonts.css` declares `@font-face` for Inter and Literata from the vendored files in `src/fonts/`;
Vite fingerprints them, so nothing is requested from a font host.

## Primitives

- `@stockpot/ui/button` — `Button`, `IconButton`
- `@stockpot/ui/card` — `Card`, `CardTop`, `CardTitle`, `CardSummary`, `CardContext`, `CardBlock`, `CardSources`, `CardSource`, `CardActions`, `CardAction`, `CardLoading`
- `@stockpot/ui/category` — `CategoryChip`, `CategoryTile`
- `@stockpot/ui/chip` — `Chip`
- `@stockpot/ui/empty-state` — `EmptyState`
- `@stockpot/ui/icon` — `Icon`, `iconNames`, `categoryColors`, `IconName`, `CategoryColor`
- `@stockpot/ui/list` — `List`, `ListRow`, `SwipeActions`, `SwipeAction`
- `@stockpot/ui/search-field` — `SearchField`
- `@stockpot/ui/segmented` — `Segmented`, `SegmentedItem`
- `@stockpot/ui/sheet` — `Sheet`
- `@stockpot/ui/skeleton` — `Skeleton`
- `@stockpot/ui/spinner` — `Spinner`
- `@stockpot/ui/status-badge` — `StatusBadge`, `FlagBadge`, `Badge`
- `@stockpot/ui/switch` — `Switch`, `ToggleRow`
- `@stockpot/ui/tab-bar` — `TabBar`, `Tab`
- `@stockpot/ui/text-field` — `TextField`
- `@stockpot/ui/toast` — `Toast`, `ToastAction`
- `@stockpot/ui/wordmark` — `Wordmark`

## Kit book

Run these commands from the repository root.

```sh
bun run -F @stockpot/ui book       # Serve the interactive stories in light and dark
bun run -F @stockpot/ui book:build # Build the static book into packages/ui/dist/
bun run -F @stockpot/ui e2e        # Build the book and run its Playwright suite
```

The suite previews the static build on `127.0.0.1:4410` by default. Set `BOOK_PORT` to use another port.
