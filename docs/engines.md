# Engines

How stockpot talks to language models: the contract every engine implements, the card formats and
depth levels an engine must answer in, the suggestion schema, how a prompt is put together, which
links a card may carry, what leaves the instance for a private note, and which engine runs which
task. The [architecture](architecture.md#the-engine-contract-boundary) explains where these pieces
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
provider reported and the time the call took. It validates the answer with `parseOutput`, which
checks it against the format's Valibot schema: the Valibot schema is the source of truth, whatever
the provider was told.

### Errors

A failure the router acts on is an `EngineError` of one of four kinds:

| Kind           | When                                                                    | What happens                                                                                                                                   |
| -------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `rate_limited` | The provider's usage limit is reached; carries `resetsAt`               | The router falls back to the next engine. Its output is marked a draft and queued to be redone by the primary engine after `resetsAt` (ENG-6). |
| `auth`         | The key or login is rejected                                            | The router falls back to the next engine, and settings show the engine as failing.                                                             |
| `timeout`      | No answer within the timeout; the engine stops the call or process      | The job runner retries on the same engine with backoff; after two retries the note is marked failed and can be restarted by hand.              |
| `invalid`      | The answer is not JSON or does not match the schema; carries the issues | As `timeout`. The issues name each field, such as `summary: Invalid length`, and are logged with the run.                                      |

Anything else an engine throws is an ordinary error, which the job runner retries the same way.

## Formats

A format is the shape of a card. A category points to one format, and several categories may share
it; the owner edits a category's name, icon, colour, format and extra instructions, never the format
itself. The research feature owns the formats in
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

Each format is written once, in Valibot. The same schema validates the engine's answer, and
[`@valibot/to-json-schema`](https://valibot.dev/guides/json-schema/) derives the JSON Schema (draft-07)
that the engine hands its provider through its structured-output option. The two cannot drift
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
- an engine may strip keywords its provider does not accept, such as `$schema` or `format`, but it
  always validates with the Valibot schema.

The exact JSON Schema of every format and depth level is pinned in
[`index.spec.ts.snap`](../packages/app/src/features/research/shared/formats/__snapshots__/index.spec.ts.snap)
and the suggestion's in
[`suggestion.spec.ts.snap`](../packages/app/src/features/research/shared/formats/__snapshots__/suggestion.spec.ts.snap);
the specs also check that each format accepts a sample card and rejects broken ones. A change to a
format shows up there in review.

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

Levels 2 and 3 are shared by every format except `vocabulary`, whose levels fit a word:

| Level | Purpose  | Fields                                                                                                                     |
| ----- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| 2     | Nuance   | `nuance` (register and connotation); `synonyms` (0–5 `{ word, difference }`); `collocations` (0–8); `sources`; `uncertain` |
| 3     | Practice | `exercises` (3–6 `{ prompt, answer }`, easy to hard); `sources`; `uncertain`                                               |

## Suggestions

`suggest` answers in this shape, built for the owner's current categories, so a provider with
structured output cannot name a category that does not exist:

| Field        | Type                      | Meaning                                                                                                             |
| ------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `categories` | 1–3 category ids          | The categories that fit, best first; the first is preselected                                                       |
| `senses`     | 0–4 `{ sense, category }` | The distinct common meanings of an ambiguous term, most likely first, each with its category; empty for one meaning |
| `language`   | two letters               | The ISO 639-1 code of the language the note is written in                                                           |

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

## Privacy

A private note reaches an engine as its term alone: no text as typed, context, link or earlier
cards. `redactPrivate` in the contract applies this, and the router calls it on every input before
any engine sees it, fallback engines included, so no caller can forget it. The task's own settings
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
  the agent command's template receives the tier. Model IDs change often and never live in code.
- **Fallback** happens on `rate_limited` and `auth` only, to the next configured engine in the
  order; an engine that is not configured is skipped. `research` has no default fallback, because
  the OpenAI-compatible engine writes from text only and cannot search; the job waits for the reset.
- **Drafts.** Output from a fallback engine is marked a draft and redone by the primary engine once
  its limit resets.
