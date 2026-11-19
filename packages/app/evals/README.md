# Evals

The eval set, the rubric and the runner that measure how well an engine answers. Every engine story
(ENG-3, ENG-4, ENG-5) is accepted on a report from this runner, measured against the thresholds in
the [rubric](rubric.md). The engines themselves are described in [docs/engines.md](../../../docs/engines.md).

| File              | What it holds                                                                       |
| ----------------- | ----------------------------------------------------------------------------------- |
| `notes.jsonl`     | The public notes, one JSON object per line                                          |
| `local/`          | Each owner's private notes and every report; ignored by Git, never committed        |
| `rubric.md`       | The automatic checks, the filler phrases, the manual score sheet and the thresholds |
| `run.ts`          | The command line                                                                    |
| `evaluate.ts`     | One run: the calls and the checks                                                   |
| `checks.ts`       | The automatic checks, as pure functions; `links.ts` holds the one that opens links  |
| `report.ts`       | The summary, the Markdown report and the score sheet                                |
| `engines.ts`      | The engines the eval can run and the variables each reads                           |
| `record-agent.ts` | Records what the agent command receives, then runs it                               |

## Running an eval

From the repository root:

```sh
bun run eval -- --engine <id> [--notes <file>] [--limit <n>] [--language <code>] [--out <dir>]
```

| Option       | Default                                             | Meaning                                                                                               |
| ------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `--engine`   | required                                            | The engine to measure, by its id below                                                                |
| `--notes`    | `packages/app/evals/notes.jsonl`                    | The public notes; the `local/` folder next to the file joins them                                     |
| `--limit`    | every call                                          | Stop after `n` engine calls, for a quick try; notes are taken one format at a time, local notes first |
| `--language` | `en`                                                | The card language, as an ISO 639-1 code                                                               |
| `--out`      | `packages/app/evals/local/reports/<time>-<engine>/` | Where the report goes                                                                                 |

For each note the runner asks the engine for a suggestion among the built-in categories, then for
a first-level card in the note's expected format (a report for an idea), on the tier the routing
table in docs/engines.md gives that format. Calls run one at a time, so each latency is the call's
own. A real run calls a real engine: it takes time and spends the provider's usage.

### Stopping early

A run stops by itself when the engine rejects its key or login (`auth`), or reports a usage limit
that resets more than a minute away; a limit that resets sooner is waited out and the call made
again. Ctrl-C stops the run too, and a second Ctrl-C exits at once. A stopped run still writes its
report, which says why it stopped and covers the calls made before.

### Card language

The default card language is `en`, the product default, so that a run on the public notes
reproduces anywhere. An owner who reads cards in another language passes it, such as
`--language ru`. The `filler` check uses the rubric's list for the card language and is skipped
for a language without one.

## Engines and keys

Keys never live in the repository. The runner reads each engine's settings from the environment,
not from an instance's database, so put them in a file outside the repository and pass it to Bun:

```sh
bun --env-file ~/.config/stockpot/dev.env run eval -- --engine openai-compatible
```

| Engine id           | Variables                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-command`     | `STOCKPOT_AGENT_COMMAND`, the same template the server uses                                                                            |
| `openai-compatible` | `STOCKPOT_EVAL_OPENAI_BASE_URL`, `STOCKPOT_EVAL_OPENAI_MODEL` (every tier), and `STOCKPOT_EVAL_OPENAI_KEY` when the endpoint needs one |

To check what a private note sends, the runner records each payload through a setting the engine
already takes: the OpenAI-compatible base URL points at a proxy on this machine that records each
request body and forwards it, and the agent command runs behind `record-agent.ts`, which records
the arguments, stdin and the files they name, then runs the agent. Gemini arrives with its engine in ENG-4, as one more entry in `engines.ts`. Each run records its
`engine_runs` rows in an in-memory database, so nothing is written to an instance.

## Notes

Each line of `notes.jsonl` is one note:

| Field                 | Meaning                                                                      |
| --------------------- | ---------------------------------------------------------------------------- |
| `id`                  | A kebab-case id, unique across the public and local files                    |
| `text`                | The note as typed, recorded exactly as given, typos included                 |
| `context`, `url`      | Where the owner saw it and a saved link, or `null`                           |
| `private`             | Whether the note is private: the engine must receive its term alone          |
| `language`            | The ISO 639-1 code of the language the note is written in                    |
| `source`              | `owner` for the owner's real notes, `composed` for notes written for the set |
| `expected.format`     | The format of the built-in category the note belongs to                      |
| `expected.alsoAccept` | Other formats that are a fair choice for a note between two categories       |
| `expected.sense`      | For an ambiguous term, the meaning the card should explain                   |
| `expected.senses`     | For an ambiguous term, the meanings a suggestion should list                 |
| `expected.uncertain`  | The note is composed to be unknowable, so its card must be `uncertain`       |
| `tests`               | What the note tests                                                          |

Real notes come from the owner and are recorded as given; they are never invented. A note written
for the set, at the owner's request or to cover what the owner's notes miss, is marked `composed`,
so a report can tell the two apart.

### Local notes

Notes that must not be public, such as a private context or a note that names a product, go in any
`*.jsonl` file in `local/`, next to the public file. Git ignores the folder. A local line is either
a whole note, or an id with `context` or `url` only, which adds those details to the public note
with that id: the term stays public and what the owner wrote about it stays on their machine. The
runner reads `local/` when it exists and runs the public notes alone when it does not.

## Reports

Each run writes four files to its folder:

- `calls.jsonl`: every call and its checks, appended as soon as the call is done, so stopping a
  run loses nothing; the other files are built from it;
- `report.md`: the pass rate and the p50 and p95 latency for suggestions and for each format, the
  pass rate of each check, and every failure;
- `report.json`: the same, with every answer;
- `score-sheet.md`: a row per card to score by hand, as the rubric says.

The `links` check opens every link a card cites, from your machine. It refuses private and loopback
addresses but cannot catch DNS rebinding, as the [rubric](rubric.md#automatic-checks) explains.

Reports hold the engine's answers and the local notes, so they stay in `local/`. Compare a report
with the thresholds in the rubric; an engine story quotes its report's numbers in the pull request.
