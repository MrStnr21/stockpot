# Engines

How stockpot talks to language models: the contract every engine implements, the card formats and
depth levels an engine must answer in, the suggestion schema, how a prompt is put together, which
links a card may carry, what leaves the instance for a private note, which engine runs which task,
and what the agent command, Gemini and the OpenAI-compatible engine do. The [architecture](architecture.md#the-engine-contract-boundary) explains where these pieces
live; this page records what they are. Paths are relative to `packages/app/`.

## The contract

[`src/server/engines/contract.ts`](../packages/app/src/server/engines/contract.ts) defines three
tasks:

| Task       | What it does                                                        | Default timeout |
| ---------- | ------------------------------------------------------------------- | --------------- |
| `suggest`  | Proposes one to three categories, and senses, while a note is typed | 3 s             |
| `explain`  | Writes a card in a category's format, at a depth level              | 3 min           |
| `research` | Writes a long report on an idea, searching widely                   | 15 min          |

The timeouts are starting values: ENG-7 measures them. A suggestion that misses its
[budget](principles.md#performance-budgets) is dropped, and capture falls back to history only.

### Input

Every call carries:

- **`note`**: the term (the normalized text), the note as typed, its context ("where I saw it"),
  a saved link, and the private flag. A private note carries only the term (see
  [Privacy](#privacy));
- **`language`**: the card language from settings, as an ISO 639-1 code;
- **`output`**: the format to answer in: its id, its instructions, the Valibot schema that validates
  the answer and the JSON Schema derived from it (see [Formats](#formats)).

`suggest` adds the owner's categories to choose from (id, name, a hint). `explain` and `research`
add the category (its name and the owner's extra instructions), the depth level and the note's
cards at the lower levels, so a deeper card builds on them instead of repeating them.

The engine router also passes run options: the tier (`fast`, `standard` or `deep`, which settings
map to a model ID for each engine), the timeout and an abort signal.

### Output

An engine returns the validated answer with the id of the engine that wrote it, the model ID the
provider reported, the time the call took and, for a call grounded in Google Search, the Search
Suggestions to show with the answer (see [Search grounding terms](#search-grounding-terms)). It validates the answer with `parseOutput`, which
checks it against the format's Valibot schema: the Valibot schema is the source of truth, whatever
the provider was told. The provider returns JSON text, which each engine parses itself; a parse
failure is `invalid` too.

### Errors

A failure the router acts on is an `EngineError` of one of four kinds:

| Kind           | When                                                                    | What happens                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rate_limited` | The provider's usage limit is reached; carries `resetsAt`               | The router falls back to the next engine. A card from it is marked a draft and queued to be redone by the primary engine after `resetsAt` (ENG-6); a suggestion is never a draft. |
| `auth`         | The key or login is rejected                                            | The router falls back to the next engine, and settings show the engine as failing.                                                                                                |
| `timeout`      | No answer within the timeout; the engine stops the call or process      | The job runner retries on the same engine with backoff; after two retries the note is marked failed and can be restarted by hand.                                                 |
| `invalid`      | The answer is not JSON or does not match the schema; carries the issues | As `timeout`. The issues name each field, such as `summary: Invalid length`, and are logged with the run.                                                                         |

Anything else an engine throws is an ordinary error, which the job runner retries the same way.

## Formats

A format is the shape of a card. A category points to one format, and several categories may share
it; the owner edits a category's name, icon, colour, format and extra instructions, never the format
itself. The format ids live in [`src/lib/format-ids.ts`](../packages/app/src/lib/format-ids.ts), so
the categories feature can check a category's format without importing another feature. The research
feature maps each id to its schemas in
[`src/features/research/shared/formats/`](../packages/app/src/features/research/shared/formats/index.ts),
one module per format, and passes the chosen format's schema with each call, so engines never import
a feature.

| Format       | Task       | For                                                             | Built-in category |
| ------------ | ---------- | --------------------------------------------------------------- | ----------------- |
| `vocabulary` | `explain`  | A word or phrase in a language the owner is learning            | English           |
| `technology` | `explain`  | A technology or technical term                                  | Technology        |
| `comparison` | `explain`  | A product or model in a crowded field, against its alternatives | AI                |
| `concept`    | `explain`  | An idea from any field: a principle, a pattern, a law           | Concept           |
| `report`     | `research` | An idea the owner might build                                   | Idea              |
| `brief`      | `explain`  | Anything else: a short explanation with links                   | Other             |

Format ids are stored with each category, so renaming one needs a migration.

### Defining a format once

Each format is written once, in Valibot, with the field helpers in
[`src/lib/json-schema.ts`](../packages/app/src/lib/json-schema.ts). The same schema validates the
engine's answer, and `deriveJsonSchema` in that file uses
[`@valibot/to-json-schema`](https://valibot.dev/guides/json-schema/) to derive the JSON Schema
(draft-07) that the engine hands its provider through its structured-output option. The two cannot drift
apart, and a field's description travels in the JSON Schema, so it is the field-level prompt.

Every format fits what JSON Schema can express, under these rules:

- every object is strict (`additionalProperties: false`) and lists all its fields as required;
  "nothing" is `null` or an empty list, never a missing field, because strict structured-output
  modes accept only that shape;
- no transformations such as `trim`: they have no JSON Schema form, so text is cleaned up after
  validation;
- patterns carry no regex flags, which JSON Schema cannot hold;
- the derivation runs with `errorMode: 'throw'`, so a schema that JSON Schema cannot express fails
  in the specs rather than reaching an engine half-converted;
- a text field's description ends with its cap ("At most 280 characters."), because providers drop
  length keywords and the model reads descriptions.

The exact JSON Schema of each distinct format and depth level is pinned in
[`index.spec.ts.snap`](../packages/app/src/features/research/shared/formats/__snapshots__/index.spec.ts.snap)
and the suggestion's in
[`suggestion.spec.ts.snap`](../packages/app/src/server/engines/__snapshots__/suggestion.spec.ts.snap);
the specs also check that each format accepts a sample card and rejects broken ones. A change to a
format shows up there in review.

### Provider schemas

No provider accepts every draft-07 keyword, so each engine **must** adapt the derived JSON Schema to
its provider before sending it, and must still validate the answer with the Valibot schema on our
side. Whatever a provider drops or ignores, an answer that breaks the format fails with `invalid`.

- **OpenAI-compatible, strict mode** (ENG-5): strict mode rejects `minLength`, `maxLength`,
  `$schema`, and any `format` outside its allowed list, which excludes the `uri` our sources use. The
  engine strips those keywords everywhere in the schema, recursing into `properties`, `$defs`, `items`, `additionalProperties`, `anyOf`, `allOf` and `oneOf` (`strictSchema` in
  [`openai-strict-schema.ts`](../packages/app/src/server/engines/openai-strict-schema.ts)). The caps
  stay in the descriptions.
- **Gemini** (ENG-4): the schema goes in `responseJsonSchema`. The recorded responses show it taking
  the derived schema without `$schema`, `pattern`, `format: uri`, `anyOf` and nullable types
  included, on gemini-3.1-flash-lite and gemini-2.5-flash. Probes on 2026-11-19, not recorded, saw
  it take `$schema` too, and saw `responseSchema` reject the same schema with
  `400 INVALID_ARGUMENT` (unknown fields `$schema` and `additionalProperties`), so `responseSchema`
  is not used. The engine leaves out only `$schema`, which Gemini does not use (`geminiSchema` in
  [`gemini.ts`](../packages/app/src/server/engines/gemini.ts)). The Interactions API's
  `response_format` was not tried, because the engine uses `generateContent`. Google's
  structured-output guide says `minLength` and `maxLength` are ignored, so the caps stay in the
  descriptions. See [The Gemini engine](#the-gemini-engine).
- **Agent command** (ENG-3): the schema goes to the command unchanged, as its template says (see
  [The agent command](#the-agent-command)); what the agent enforces depends on the agent, so
  validation on our side is the only guarantee.

### Fields every card shares

A first-level card opens with the meaning it explains and closes with its sources and a flag:

| Field       | Type                 | Meaning                                                                                    |
| ----------- | -------------------- | ------------------------------------------------------------------------------------------ |
| `sense`     | text, up to 120      | The meaning explained, such as "YouTube streaming protocol"; recorded for repeats          |
| `aliases`   | 0–5 texts            | Other names, spellings and abbreviations in this meaning; recorded for repeats             |
| `sources`   | 0–5 `{ title, url }` | Pages the engine opened while writing (see [Links](#links)); up to 3 or 10 in some formats |
| `uncertain` | boolean              | The engine could not confirm the main facts                                                |

Deeper levels keep `sources` and `uncertain` and drop `sense` and `aliases`, which belong to the
note. Text fields are capped (the number is the maximum length) so that a card fits a phone.

### Level 1 of each format

| Format       | Fields after `sense` and `aliases`                                                                                                                                                                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vocabulary` | `translation` (into the card language); `partOfSpeech` (noun, verb, adjective, adverb, phrasal verb, idiom, phrase, other); `difficulty` (easy, medium, hard); `examples` (2–3 `{ text, translation }`); `modelSentences` (2–3 sentences to reuse); `mistake` (the typical learner's mistake, or `null`); `sources` (up to 3, usually empty) |
| `technology` | `summary` (one sentence); `analogy` (to something a developer knows; the category's instructions may name the stack); `relevance` (why it matters, judged from the context, or `null`); `sources` (to dig deeper)                                                                                                                            |
| `comparison` | `summary`; `alternatives` (1–4 `{ name, pros, cons }`, a table of the subject against each); `worksWith` (0–8); `sources` (two or three primary sources)                                                                                                                                                                                     |
| `concept`    | `explanation` (two to four sentences); `analogy`; `example`; `seenIn` (1–5 places the owner will meet it); `sources`                                                                                                                                                                                                                         |
| `report`     | `summary` (what and for whom); `existing` (0–8 `{ name, note }`); `approaches` (1–5, each with its trade-off); `risks` (1–5); `firstSteps` (1–5, in order); `sources` (up to 10)                                                                                                                                                             |
| `brief`      | `explanation` (two or three sentences); `sources`                                                                                                                                                                                                                                                                                            |

The pronunciation link of a `vocabulary` card is not asked for: the app builds it from the term,
so it cannot be a made-up address.

### Depth levels

"Deeper" on a card, or a repeat after the card was shown, queues the next level (RES-4). Each level
is a separate card; the engine gets the lower levels with the call and must not repeat them.

| Level | Purpose                             | Fields                                                                                                                        |
| ----- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1     | The first card, read in a minute    | The format's own fields, above                                                                                                |
| 2     | How it works and what it trades off | `howItWorks` (a few short paragraphs); `tradeoffs` (1–6); `sources` (up to 5); `uncertain`                                    |
| 3     | Hands-on, with sources              | `steps` (1–8, a walkthrough under an hour); `example` (code or a worked example, or `null`); `sources` (up to 8); `uncertain` |

Levels 2 and 3 are shared by every format except `vocabulary` and `report`. A word has levels of
its own:

| Level | Purpose  | Fields                                                                                                                     |
| ----- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| 2     | Nuance   | `nuance` (register and connotation); `synonyms` (0–5 `{ word, difference }`); `collocations` (0–8); `sources`; `uncertain` |
| 3     | Practice | `exercises` (3–6 `{ prompt, answer }`, easy to hard); `sources`; `uncertain`                                               |

A `report` is already a long researched answer, so its level 1 asks for a thorough report rather than
a card to read in a minute, and its levels move from the landscape towards building the idea:

| Level | Purpose     | Fields                                                                                                                                                                                                         |
| ----- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2     | Feasibility | `recommendation` (the approach to take and why); `architecture` (how it would be built); `unknowns` (1–6 open questions); `effort` (a rough estimate and what dominates it); `sources` (up to 10); `uncertain` |
| 3     | Build plan  | `prototype` (the smallest version that tests the idea); `milestones` (1–6 `{ name, outcome }`); `tools` (0–8); `sources` (up to 10); `uncertain`                                                               |

## Suggestions

`suggest` answers in the shape that
[`src/server/engines/suggestion.ts`](../packages/app/src/server/engines/suggestion.ts) builds for the
owner's current categories, so a provider with structured output cannot name a category that does not
exist. It sits with the contract rather than with the card formats: it is not a card, and the capture
feature builds it.

| Field        | Type                      | Meaning                                                                                                             |
| ------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `categories` | 1–3 category ids          | The categories that fit, best first; the first is preselected                                                       |
| `senses`     | 0–4 `{ sense, category }` | The distinct common meanings of an ambiguous term, most likely first, each with its category; empty for one meaning |
| `language`   | two lowercase letters     | The ISO 639-1 code of the language the note is written in                                                           |

A suggestion never searches: it uses the fastest engine and answers from what the model knows.
Capture checks the owner's history first and calls the engine only when the term is new (CAP-3).

## Prompts

An engine assembles its prompt from the call, in this order:

1. **Rules**, the same for every call: write for the owner in the card language; be concise and
   concrete; set `uncertain` rather than guess; follow the link policy; answer only with JSON that
   matches the schema.
2. **Task**: suggest, explain or research.
3. **Format**: the format's instructions, then the depth level's.
4. **Category**: the owner's extra instructions for the category, appended as written.
5. **Note**: the term, then the note as typed, its context and its link. A private note gives only
   the term.
6. **Earlier cards**, for level 2 and 3: the note's cards at the lower levels, as JSON.

The JSON Schema goes through the provider's structured-output option (a flag, a response schema or
a response format), not into the prompt text, and the answer is validated with the Valibot schema.
Each card records the engine, the model and a prompt version, so a card can be redone when the
prompt changes.

## Links

- A card links only to pages the engine opened or saw in search results during that call, never to
  an address from memory or one it built.
- Only `http` and `https` addresses; the schema rejects any other scheme.
- Before a card is saved, the server opens every link (RES-2): it refuses loopback, private and
  link-local addresses after resolving DNS, limits time and size, and drops dead links. A card left
  without sources is flagged `uncertain`.
- Links the app can build itself, such as a word's pronunciation page, are not asked of the engine.
- Gemini's search sources are Google redirect URLs (`https://vertexaisearch.cloud.google.com/grounding-api-redirect/…`).
  A card keeps them as given until the owner decides whether the link check may resolve them (see
  [Search grounding terms](#search-grounding-terms)).

## Privacy

A private note reaches an engine as its term alone: no text as typed, context, link or earlier
cards. `redactPrivate` in the contract applies this. The `Engine` methods take only a `Redacted`
input, which nothing but `redactPrivate` can make, so every path to an engine, fallback included,
goes through it. It rebuilds the input from the fields the contract defines, so nothing else a
caller puts on it reaches an engine, whether the note is private or not. The task's own settings
(the format, the category's name and extra instructions, the depth and the card language) are not
note data and are sent as for any note; a category's extra instructions apply to every note in it,
so they should not hold anything the owner would not send with each one.

A deeper card of a private note therefore cannot see the lower levels and may repeat them; that is
the price of the rule.

## Routing

The router (ENG-6) picks an engine and a tier for each task and category. The defaults are keyed by
format, so a category the owner creates inherits its format's row; settings override any row for a
single category, and set the fallback order.

| Task       | Format                                         | Default engine | Tier       | Falls back to     |
| ---------- | ---------------------------------------------- | -------------- | ---------- | ----------------- |
| `suggest`  | any                                            | Gemini         | `fast`     | OpenAI-compatible |
| `explain`  | `vocabulary`                                   | Gemini         | `fast`     | OpenAI-compatible |
| `explain`  | `technology`, `comparison`, `concept`, `brief` | Gemini         | `standard` | OpenAI-compatible |
| `research` | `report`                                       | Gemini         | `deep`     | none              |

- **No vendor defaults for the agent command.** The agent command engine ships unconfigured
  ([D3](principles.md#decisions)): an owner who configures one usually routes `explain` and
  `research` to it (with the same tiers) and keeps Gemini for `suggest`, the fastest engine without
  search. The fallback order then becomes agent command, Gemini, OpenAI-compatible.
- **Tiers, not model IDs.** A row names a tier; settings map each engine's tiers to model IDs, and
  the agent command's template receives the tier. Model IDs change often and live in settings; the
  only ones in code are Gemini's starting models for a new instance (see [The Gemini engine](#the-gemini-engine)).
- **Fallback** happens on `rate_limited` and `auth` only, to the next configured engine in the
  order; an engine that is not configured is skipped. `research` has no default fallback, because
  the OpenAI-compatible engine writes from text only and cannot search; the job waits for the reset.
- **Drafts.** A card from a fallback engine is marked a draft and redone by the primary engine once
  its limit resets. Drafts apply to cards only: a suggestion is not stored, so one from a fallback
  engine is simply shown.

## The Gemini engine

The Gemini engine
([`src/server/engines/gemini.ts`](../packages/app/src/server/engines/gemini.ts), ENG-4) calls
`generateContent` through Google's `@google/genai` SDK, on API version `v1beta`:

- **Settings only.** The key, the model for each tier and the limits are read from settings at
  every call. A new instance starts with `gemini-3.1-flash-lite` for `fast`, `gemini-2.5-flash` for
  `standard` and `gemini-2.5-pro` for `deep`: the models a free key could use for each task on
  2026-11-19 (see [What the real calls showed](#what-the-real-calls-showed)). A call fails with an
  ordinary error, and records its run, when the key or the tier's model is not set.
- **Suggestions** are one request with structured output, minimal thinking and no tools. Minimal
  thinking is the Gemini 3 `thinkingLevel` setting, so the `fast` tier expects a Gemini 3 or later
  model; a Gemini 2.5 model was not tried with it.
- **Cards** (`explain` and `research`) are two requests to the tier's model. The first has Google
  Search and URL context and no schema, and writes down the facts the card needs as plain notes; the
  second writes the card as structured output from those facts, and may cite only the pages the
  first searched or opened. Two requests, because the models a free key could search with refused
  structured output together with search (see [What the real calls showed](#what-the-real-calls-showed)).
- **One request at a time**, with one `engine_runs` row per call (a card's two requests share it):
  the reported model, the input tokens (the prompt and the tool prompts), the output tokens (the
  answer and the thinking) and the searches (the queries the facts step ran). Gemini reports no
  cost, so the cost stays empty.
- **Limits.** Settings give each tier a per-minute and a per-day request limit for its model, `null`
  (no limit) by default. Counters count each model's requests in the last minute and since midnight
  Pacific time, when Google resets daily quotas. A call that would pass a limit is refused before any
  request, as `rate_limited` until the window has room again (the next Pacific midnight for the daily
  limit), and records its run; a card counts as two requests. The counters live in memory, in the one
  server process, behind `UsageCounters` in
  [`gemini-usage.ts`](../packages/app/src/server/engines/gemini-usage.ts): they start from the engine's runs in `engine_runs`
  since the last Pacific midnight and in the last minute (a card counts two requests, and a run
  refused as `rate_limited` none), so a restart keeps the day's count. A run counts against the model
  Gemini reported, so a tier set to an alias such as `gemini-flash-latest` is seeded under the model
  the alias pointed to. Google's own quota still applies.
- **Errors**
  ([`gemini-errors.ts`](../packages/app/src/server/engines/gemini-errors.ts)). 429 is
  `rate_limited` until the later of the `RetryInfo` delay and the next Pacific midnight when a
  `QuotaFailure` names a per-day quota, so a daily quota is not retried every minute, or a minute from
  now when the error names neither. The recorded free-tier 429, from gemini-3-flash-preview asked to
  search, names neither: its only detail is a help link, and it shows no quota of 0, so it cannot be
  told apart from a limit that passes. 401, 403, and 400 with the reason `API_KEY_INVALID` (how Gemini rejects a bad key) are
  `auth`. Any other failing status, such as 503 when a model is overloaded, is an ordinary error. A
  blocked prompt, an answer that stops early (the token limit, safety), an empty answer, and text that
  is not JSON or breaks the format are `invalid`. No answer within the timeout, which covers both
  requests of a card, is `timeout`. The SDK's own retries are off: the job runner retries.

### What the real calls showed

On 2026-11-19, with the owner's key on Google's free tier. What is marked _recorded_ has a fixture
in [`tests/recordings/gemini/`](../packages/app/tests/recordings/gemini/suggest.json), written by
[`tests/recordings/gemini.ts`](../packages/app/tests/recordings/gemini.ts), except
`quota-exceeded.json`, which an earlier probe wrote. Everything else was observed in probes on
2026-11-19, not recorded.

| Question                             | What the calls showed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `responseJsonSchema`                 | _Recorded:_ it took the derived schema without `$schema` on gemini-3.1-flash-lite (the suggestion, with `pattern`; `suggest.json`) and on gemini-2.5-flash (a technology card, with `pattern`, `format: uri`, `anyOf` and nullable types; `explain-card.json`). _Observed in probes, not recorded:_ it took the schema with `$schema` on gemini-3.5-flash-lite, and a card schema on gemini-3.5-flash.                                                                                                      |
| `responseSchema`                     | _Observed in probes, not recorded:_ 400 on gemini-3.5-flash-lite, with unknown fields `$schema` and `additionalProperties`.                                                                                                                                                                                                                                                                                                                                                                                 |
| Enforcing `pattern` and `format`     | Not tested; the Valibot schema checks them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Structured output with Google Search | _Observed in probes, not recorded:_ gemini-2.5-flash refused it with 400 "Tool use with a response mime type: 'application/json' is unsupported".                                                                                                                                                                                                                                                                                                                                                           |
| Structured output with URL context   | _Observed in probes, not recorded:_ it worked on gemini-3.1-flash-lite.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Search on the free tier              | _Recorded:_ gemini-2.5-flash searched with Google Search and URL context and returned its grounding (`explain-facts.json`); gemini-3-flash-preview, asked to search with structured output, answered 429 `RESOURCE_EXHAUSTED` whose only detail is a help link (`quota-exceeded.json`). _Observed in probes, not recorded:_ gemini-3.8-flash, gemini-3.5-flash and gemini-3.1-flash-lite answered the same 429 to a request with Google Search and structured output, and answered without the search tool. |
| API version                          | _Observed, not recorded:_ on `v1`, the SDK's default, Gemini answered a request with the search tool with 400 "Search as tool is not enabled for api version v1", so the engine asks for `v1beta`.                                                                                                                                                                                                                                                                                                          |
| A bad key                            | _Recorded:_ 400 with the reason `API_KEY_INVALID` (`bad-key.json`).                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| An overloaded model                  | _Recorded:_ 503 `UNAVAILABLE` from gemini-3.1-flash-lite (`unavailable.json`).                                                                                                                                                                                                                                                                                                                                                                                                                              |

On this free key, then, Google Search worked only on Gemini 2.5, which refuses it together with
structured output: hence the two-request card. Search without structured output on Gemini 3 or
later was not tried, and neither was a paid key.

### Suggestion latency

Observed on 2026-11-19, not recorded: 20 suggestions on gemini-3.1-flash-lite with minimal
thinking, run one at a time by `tests/recordings/gemini.ts latency` with a 30 s timeout, on the
free tier. 16 answered, 3 timed out and 1 got 503 ("high demand"). Of the 16 answers, p50 was 3.1 s,
p95 19.0 s and the fastest 1.5 s; none came within 1.5 s and 7 within the 3 s suggestion timeout.
The budget (p95 under 1.5 s) is not met on the free tier; when a suggestion misses it, capture
falls back to history only.

### Search grounding terms

Google's [Gemini API terms](https://aistudio.google.com/docs/terms), read on 2026-11-19, set rules
for results grounded with Google Search. Those that affect stockpot:

- **Search Suggestions go with grounded results.** A grounded result may be shown only with its
  Search Suggestions or other links, and only to the end user who sent the prompt. The engine
  returns the suggestions' HTML as `searchSuggestions` on the result, from the facts request's
  `groundingMetadata.searchEntryPoint.renderedContent`. Showing it is the card interface's job, a
  later story; nothing renders it yet.
- **Storing is limited.** Grounded results may not be cached, syndicated, analysed or used for
  training. Their text may be stored for up to two years, and only to evaluate and improve how the
  app displays it, in an end user's chat history so that they can view it, or temporarily to
  resubmit it (next rule); otherwise grounded results and Search Suggestions may be kept only as
  long as the law requires.
- **Resubmitting grounded text.** The terms allow sending a grounded result's text back,
  temporarily and through a function call, in a later prompt for a refined result, on three
  conditions. The two-request card relies on this clause:
  - _The interim result is used for nothing else._ The facts exist only in memory during the call:
    the engine passes them to the card request and returns the card alone. They are not stored,
    logged or written to `engine_runs`.
  - _An interim result the end user never sees is deleted once the final result exists._ The facts
    are never shown, and nothing keeps them after the call ends.
  - _The final result is shown with its Search Suggestions or other links_ (at most five Search
    Suggestions). The engine returns `searchSuggestions` with the card; storing them with the card
    and showing them next to it are left to later stories, the research feature and the card
    interface.
  - The clause names a function call; the engine puts the facts in the text of an ordinary second
    request instead. Whether that counts is part of the open decision below.
- **No modification, interstitials or redirection.** Grounded results and Search Suggestions may
  not be modified or have other content interspersed with them. Nothing may be placed between a
  link or Search Suggestion and its destination page, end users may not be redirected away from the
  destination page or kept from seeing it in full, and clicks on a Search Suggestion may not be
  tracked.
- **No collecting links.** Links and Search Suggestions may not be extracted or collected for
  another purpose, which includes collecting links by automated means, building an index from them
  and using them to pick pages to crawl or scrape.

**Open decision for the owner.** Two questions, and the engine returns `searchSuggestions` whatever
the answers:

- **Cards in Base.** A Gemini card is the final result of a resubmission, kept in Base for as long
  as the owner wants it. Does keeping it fit the purposes the terms allow storage for, must its
  Search Suggestions be stored and shown next to it for as long as it is kept, and does an ordinary
  second request count as the function call the clause names? If it does not fit, the options
  include: Gemini keeps search only for fallback drafts, which another engine redoes later; cards
  from Gemini keep their Search Suggestions next to them for as long as they are kept; or cards that
  need search route to the agent command.
- **Redirect URLs.** A card's search sources are Google's redirect URLs (see
  [Sources](#sources)). Resolving them to their final address before a card is saved, as RES-2's
  link check would, may count as collecting links by automated means. Until the owner decides, a
  card keeps each redirect URL as given.

### Sources

The facts request's sources are the pages URL context opened and Google's redirect URLs for the
search results (`https://vertexaisearch.cloud.google.com/grounding-api-redirect/…`), titled with the
site's domain. The card cites them as given; whether they may be resolved to their final address is
part of the open decision above.

## The OpenAI-compatible engine

The OpenAI-compatible engine
([`src/server/engines/openai-compatible.ts`](../packages/app/src/server/engines/openai-compatible.ts),
ENG-5) posts to `<base URL>/chat/completions` on any endpoint that speaks that API, hosted or local:

- **Settings only.** The base URL, the key and the model for each tier are read from settings at
  every call, so switching provider is a settings change. The key is optional, for a local model; a
  call fails with an ordinary error, and records its run, when the base URL or the tier's model is not set.
- **Text only.** It cannot search or open pages, so the prompt asks it to leave every list of
  sources empty, and it writes from what the call carries, such as the earlier cards.
- **Strict schema.** The format's schema goes in `response_format` as `json_schema` with `strict`,
  adapted as [Provider schemas](#provider-schemas) says.
- **One request at a time**, with one `engine_runs` row each, recording the reported model and the
  prompt and completion tokens.
- **Errors.** 429 is `rate_limited` until the latest of `retry-after` (seconds or an HTTP date),
  `x-ratelimit-reset-requests` and `x-ratelimit-reset-tokens` (durations such as `1m30s`), or a
  minute from now when none is given; 401 and 403 are `auth`; any other failing status is an ordinary
  error. A reply that is not a chat completion, a refusal, an answer cut off at the token limit or content that breaks the format is `invalid`, and no reply within the timeout is `timeout`.

## The agent command

The agent command engine
([`src/server/engines/agent-cli.ts`](../packages/app/src/server/engines/agent-cli.ts), ENG-3) runs a
command-line agent the owner already uses. No agent is named or assumed
([D3](principles.md#decisions)): the owner sets `STOCKPOT_AGENT_COMMAND` to a command template, and
the engine is configured only when it is set. It lives in the environment rather than in settings, so
the command cannot be changed over HTTP.

### The template

The template is split into words as a shell would, with single and double quotes and nothing else:
no variables, escapes, pipes or redirections. Anything more, such as picking a model for a tier or
translating the agent's messages, goes in a script that the template names. Placeholders are filled
in word by word, so a value never splits into more words or reaches a shell:

| Placeholder     | Becomes                                                                            |
| --------------- | ---------------------------------------------------------------------------------- |
| `{schema_file}` | The path of a file holding the call's JSON Schema                                  |
| `{schema}`      | The JSON Schema itself, as one argument                                            |
| `{tier}`        | `fast`, `standard` or `deep`; a script maps it to one of the agent's models        |
| `{prompt_file}` | The path of a file holding the [prompt](#prompts); without it, the prompt is stdin |

The schema is the derived draft-07 schema, as it is: stockpot validates the answer itself.

### Each run

- **A fresh empty working directory**, removed afterwards. The prompt and schema files sit next to
  it, not in it. The environment is the server's, so the agent finds its own login.
- **Search and fetch only.** The template must limit the agent to searching and fetching pages;
  stockpot cannot enforce what tools an agent has, and the empty directory is only a second line of
  defence.
- **One run at a time.** A call waits for the one before it; one aborted while it waits leaves
  without running.
- **Timeout and abort.** The timeout counts from the start of the run, not the wait. On the timeout
  or an abort, the engine sends SIGINT to the run's process group, then SIGTERM after 5 seconds and
  SIGKILL after 5 more, so a wrapper script and the agent it started stop together. Whenever the
  command exits, on its own or after a signal, anything left in its group is killed, so a child that
  holds stdout open cannot delay the answer and nothing outlives the run.
- **One `engine_runs` row** per run, with its outcome, its duration and the model and usage the
  agent reported.

### Output

On success the command exits with status 0 and prints one JSON document on stdout, either the
answer itself or a wrapper around it:

```json
{
  "structured_output": { "categories": ["technology"], "senses": [], "language": "en" },
  "model": "the-model-id",
  "usage": { "input_tokens": 1200, "output_tokens": 300, "searches": 2, "cost_usd": 0.004 }
}
```

`model` and each `usage` field are optional and recorded when present. Nothing else may go to
stdout: logs and progress belong on stderr, of which the engine keeps the last 8 KB. Stdout may hold at
most 1 MiB: past it the run is stopped like a timed-out one and fails with `invalid`, so a runaway
agent cannot fill the server's memory.

### Failures

stockpot does not read the agent's own wording. The command, or a script around it, reports a usage
limit or a login failure with an `error` object on stdout, with any exit status:

| The command                                                         | The engine reports                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| prints `{"error":{"kind":"rate_limited","resets_at":"<ISO 8601>"}}` | `rate_limited` until `resets_at`; an hour from now when it is missing       |
| prints `{"error":{"kind":"auth"}}`                                  | `auth`                                                                      |
| exits with another status and no `error` object                     | an ordinary error with the status and the end of stderr, retried by the job |
| exits with 0 and prints no JSON, or JSON that breaks the format     | `invalid`                                                                   |
| does not exit within the timeout                                    | `timeout`                                                                   |

### Example

A template that passes the tier and the schema file to a script, with the prompt on stdin:

```sh
STOCKPOT_AGENT_COMMAND='/usr/local/bin/stockpot-agent {tier} {schema_file}'
```

The script picks a model for the tier, runs your agent, and turns your agent's limit and login
messages into the `error` object. Replace `your-agent`, its flags, the model names and the two
messages with your agent's own:

```sh
#!/bin/sh
# stockpot-agent TIER SCHEMA_FILE: runs your agent for stockpot; the prompt arrives on stdin.
case "$1" in
  fast) model=your-fast-model ;;
  standard) model=your-standard-model ;;
  *) model=your-deep-model ;;
esac

errors=$(mktemp)
trap 'rm -f "$errors"' EXIT

your-agent --model "$model" --output-schema "$2" --allow-tools search,fetch 2>"$errors"
status=$?

if [ "$status" -ne 0 ]; then
  if grep -q 'usage limit reached' "$errors"; then
    # Say your agent prints "usage limit reached, resets at 2026-11-19T15:00:00Z".
    resets_at=$(grep -o '[0-9-]*T[0-9:]*Z' "$errors" | head -n 1)
    printf '{"error":{"kind":"rate_limited","resets_at":"%s"}}\n' "$resets_at"
  elif grep -q 'not logged in' "$errors"; then
    printf '{"error":{"kind":"auth"}}\n'
  fi
fi

cat "$errors" >&2
exit "$status"
```
