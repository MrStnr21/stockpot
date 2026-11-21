# Styling

## Start from the design canvas

The design canvas is the source of truth for the interface: the kit and every screen at 390, 768
and 1440 px, in light and dark schemes. Its export is in
[`docs/design-canvas/`](../design-canvas/README.md): the board images, the kit tokens in `kit.css`
and the list of boards. Every UI story names the boards it implements in a **Boards** line, and the
code matches them. When the code and a board disagree, the board wins. To change the design, change
the canvas first, export it again, then change the code.

## Tailwind and tokens

Styles are Tailwind CSS 4 utility classes, compiled through the `@tailwindcss/vite` plugin.

- **Tokens** live in [`packages/ui/src/theme.css`](../../packages/ui/src/theme.css) under
  `@theme`, published as `@stockpot/ui/theme.css`. Colors, fonts, shadows, radii and durations
  come from the kit tokens in [`docs/design-canvas/kit.css`](../design-canvas/kit.css).
- **Use a token, not a literal.** Use a class such as `text-ink` whenever a token covers the case.
  If the design needs a value that has no token, add the token to the theme rather than an
  arbitrary value to the markup.
- **Global rules are rare.** Only tokens and truly global rules go into `theme.css`. App-wide rules
  go into [`packages/app/src/main.css`](../../packages/app/src/main.css), which imports Tailwind
  and the theme and tells Tailwind to scan the UI package's sources.
- Prettier sorts class names, so do not order them by hand.

## States

Express state with data and ARIA attributes (`data-state="open"`, `aria-expanded`, `aria-busy`)
and style it with Tailwind's `data-*` and `aria-*` variants. Do not toggle classes to show state.
Give every transition and animation a `motion-reduce:` alternative.

## Runtime values

Pass a value computed at runtime through a CSS variable that a class reads, rather than an inline
style property:

```svelte
<div class="w-(--progress)" style:--progress={`${percent}%`}></div>
```

## Light and dark

Every screen works in both schemes. Use tokens that have both values instead of pairing literal
colors with `dark:` variants in the markup.
