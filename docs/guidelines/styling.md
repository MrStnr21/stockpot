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

- **Tokens** come from the design canvas kit and ship as `@stockpot/ui/theme.css`. The shared
  tokens and light defaults live under `@theme static`, with scheme overrides in the theme layer.
  See the [UI theme](../../packages/ui/src/theme.css) and the [canvas tokens](../design-canvas/kit.css).
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
colors with `dark:` variants in the markup. The theme follows `prefers-color-scheme` by default.
Set `data-scheme="light"` or `data-scheme="dark"` on the document root or on a container to force
that scheme for its subtree.
