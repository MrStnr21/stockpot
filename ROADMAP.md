# Roadmap

Where stockpot is headed, in three horizons. Each item links to its milestone, where the stories
live; the [tracking issue](https://github.com/MrStnr21/stockpot/issues/76) puts them in order and
the [project board](https://github.com/users/MrStnr21/projects/2) shows what is in progress. There
are no target dates.

## Now

[M0 Foundation](https://github.com/MrStnr21/stockpot/milestone/1) is done, so three lanes run side
by side:

- **[M1 Design](https://github.com/MrStnr21/stockpot/milestone/2):** the design canvas, the
  source of truth for the interface: the kit and every screen at phone, tablet and desktop sizes,
  in light and dark.
- **[M2 Engines & formats](https://github.com/MrStnr21/stockpot/milestone/3):** proof that each
  engine writes good cards in every format, fast enough, before the product is built around them.
- **[M3 Server core](https://github.com/MrStnr21/stockpot/milestone/4):** one process with the
  database, migrations, config, jobs, sign-in, HTTP conventions and health checks.

## Next

- **[M4 Capture](https://github.com/MrStnr21/stockpot/milestone/5):** a note gets into stockpot
  within three seconds from any entry point, with a suggested category.
- **[M5 Research](https://github.com/MrStnr21/stockpot/milestone/6):** every note becomes a checked
  card in its category's format, overnight or on demand.
- **[M6 Web app](https://github.com/MrStnr21/stockpot/milestone/7):** the PWA is the whole product
  on the phone and the desktop: capture, notes, cards, Base, settings and push notifications.
- **[M7 Digest](https://github.com/MrStnr21/stockpot/milestone/8):** the morning habit: the nightly
  queue, the morning push, Today with one-tap actions, carry-over and the archive.

## Later

- **[M8 Run on the Mac](https://github.com/MrStnr21/stockpot/milestone/9):** a background service
  with updates, HTTPS over Tailscale and daily backups, proven by two weeks of daily use. The service
  and HTTPS stories come first, during M6, because push notifications need HTTPS.
- **[M9 Release](https://github.com/MrStnr21/stockpot/milestone/10):** anyone can install and run
  stockpot: a Docker image, the documentation site, an internet-safe instance and the v0.1.0
  release.
- **[M10 Integrations](https://github.com/MrStnr21/stockpot/milestone/11):** after v0.1, an MCP
  server, a Telegram bot, export to Notion and capture on the Mac.
- **[M11 iOS app](https://github.com/MrStnr21/stockpot/milestone/12):** a native capture client
  with the share sheet, Siri, widgets and an offline queue, in its own repository.

Ideas and requests are welcome as issues; see [SUPPORT.md](SUPPORT.md).
