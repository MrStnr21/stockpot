# Runtime

stockpot runs on Bun: the server, the tools, the tests and the package manager. Use Bun's own APIs
before Node's, and import them from `bun`:

```ts
import { $, env, file, write } from 'bun'
```

Do not use the global `Bun` object; lint rejects it (`no-restricted-globals`). An explicit import
shows which modules depend on the runtime, and the import boundaries can then keep it out of code
that also runs in the browser.

## Bun APIs

- **Files:** read with `file(path).text()`, `.json()` or `.bytes()`; check and remove with
  `.exists()`, `.stat()` and `.delete()`; write with `write(path, data)`, and copy with
  `write(destination, file(source))`. Do not import `node:fs` or `node:fs/promises`.
- **Directories and shell work:** list files with `Glob`; create, move and remove directories with
  Bun Shell, such as `` $`mkdir -p ${directory}` ``.
- **Environment and arguments:** import `env` and `argv` from `bun` rather than reading
  `process.env` or `process.argv`. Server code reads the environment only through
  `src/server/config.ts`, which validates it once at startup.
- **Processes:** start them with `spawn` or `$`, not `node:child_process`.
- **Database:** SQLite comes from `bun:sqlite`, used through Drizzle in `src/server/db/`.
- **Passwords and hashing:** hash passwords with Bun's `password` API; hash data with
  `CryptoHasher` or Web Crypto, not `node:crypto`.
- **Bytes:** use `Uint8Array`, `.toBase64()` and `Uint8Array.fromBase64()` rather than `Buffer`.
- **Web standards first:** `fetch`, `Request`, `Response`, `URL` and streams work the same on the
  server and in the browser, so prefer them to any runtime-specific API.

## Code that runs in the browser

`src/lib/`, every feature's `shared/`, the non-Astro files in `src/components/` and the whole of
`packages/ui` also run in the browser. They must not import `bun`, `bun:*` or `node:*`; lint
enforces this (see the [dependency rules](../architecture.md#dependency-rules)).

## Node exceptions

Use a Node API only where Bun has no equivalent:

- `node:path` and `node:os` are allowed everywhere outside browser code;
- `process.exit`, and `process.execve` in `tools/lint/tsrs-lint.ts`, which replaces the process
  with the tsrs binary so oxlint keeps its standard streams;
- configuration files loaded by Node-based tools may read `process.env`.

Any other Node import needs a comment that explains why Bun cannot do it, and a line in this list.
