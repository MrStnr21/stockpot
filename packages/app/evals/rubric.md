# Eval rubric

How the eval runner judges an engine's answers to the [eval set](notes.jsonl). The automatic checks
run on every answer they apply to; a person fills in the manual score sheet that each run writes.
How to run it is in the README next to this file.

## Automatic checks

| Check         | Applies to                                             | Passes when                                                                                                              |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `schema`      | every call                                             | the answer matches the call's format; an engine's `invalid` failure counts as a fail                                     |
| `links`       | cards with sources                                     | every source opens (HEAD, or GET when HEAD is refused) within 10 s, and no hop resolves to a loopback or private address |
| `oneSentence` | `technology` and `comparison` cards                    | the `summary` is one sentence by the Unicode sentence rules                                                              |
| `uncertain`   | notes composed to be unknowable (`expected.uncertain`) | the card is marked `uncertain` and cites no sources                                                                      |
| `filler`      | every card                                             | no text in the card uses a phrase from the list below, in any letter case                                                |
| `private`     | private notes                                          | the engine received the term alone: no text as typed, context, link or earlier cards                                     |
| `category`    | every suggestion                                       | the first category is the note's expected one, or one it also fits (`expected.alsoAccept`)                               |
| `senses`      | suggestions for ambiguous terms (two or more `senses`) | the suggestion lists at least two senses                                                                                 |

A call that fails for any other reason (a timeout, a usage limit, a rejected key) is counted as an
error and not checked.

## Filler phrases

Phrases that add words without meaning. A card that uses one fails the `filler` check. The runner
reads the list for the card language (`--language`); a language without a list skips the check.
Keep each list short and add a phrase only after it shows up in a real card.

### English (en)

- it is important to note
- it's worth noting
- it is worth mentioning
- in today's fast-paced world
- in the ever-evolving
- delve into
- a testament to
- plays a crucial role
- game-changer
- unlock the power
- let's dive in
- in conclusion
- i hope this helps

### Russian (ru)

- стоит отметить
- важно отметить
- следует отметить
- важно понимать
- в современном мире
- давайте разберёмся
- в заключение
- надеюсь, это поможет

## Manual score sheet

Each run writes `score-sheet.md` next to its report, with a row per note. Score every card:

- **Accurate**, 1 to 5: 5 when every fact holds, 1 when the main claim is wrong.
- **Clear**, 1 to 5: 5 when the card reads in a minute on a phone and needs nothing else, 1 when it
  has to be read twice.
- **Right sense**, yes or no: the card explains the meaning the note was about, from its context or,
  for an ambiguous term, the `expected.sense` in the eval set.

## Thresholds

An engine story (ENG-3, ENG-4, ENG-5) is accepted when its report on the full set, owner's local
notes included, meets every row. Each number is a starting point: change it in this table, with the
reason, when real reports show it is wrong.

| Measure                           | Threshold | Why                                                                                                                                                                                   |
| --------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema` pass rate                | ≥ 95%     | Every engine validates through structured output, so misses should be rare; an `invalid` answer costs a retry (the job runner allows two), and 95% leaves room for one miss in twenty |
| `private` pass rate               | 100%      | `redactPrivate` enforces the rule in code, so anything less is a bug, not a quality trade-off                                                                                         |
| `uncertain` pass rate             | 100%      | Only two notes test it, and a card that invents facts or sources for an unknown term breaks the link policy outright                                                                  |
| `links` pass rate                 | ≥ 90%     | RES-2 drops dead links before a card is saved, so a few are tolerable; more means the engine cites addresses it did not open                                                          |
| `oneSentence` pass rate           | ≥ 90%     | A two-sentence summary costs readability, not correctness                                                                                                                             |
| `filler` pass rate                | ≥ 95%     | One filler phrase in twenty cards is noticeable but harmless; more shows the prompt is not followed                                                                                   |
| `category` pass rate              | ≥ 80%     | The owner fixes a wrong preselection with one tap; when more than one note in five needs it, picking by hand is faster than the suggestion                                            |
| `senses` pass rate                | ≥ 75%     | Three of the four ambiguous terms; a missed sense only means the owner types the meaning                                                                                              |
| Card pass rate, each format       | ≥ 80%     | A format where more than one card in five fails a check needs prompt work before the engine becomes its default                                                                       |
| `suggestion` latency, p95         | < 1.5 s   | The suggestion budget in the [engineering principles](../../../docs/principles.md#performance-budgets); a later answer is dropped                                                     |
| Card latency, p50 (agent command) | < 60 s    | The agent command budget in the engineering principles                                                                                                                                |
| `report` latency, p95             | < 15 min  | The idea report budget in the engineering principles, also the `research` timeout                                                                                                     |
| Accurate, mean of the score sheet | ≥ 4       | A card is worth reading only when its facts hold; 4 allows small slips, not wrong main claims                                                                                         |
| Right sense, share of yes         | ≥ 90%     | A card about the wrong meaning is wasted; the ambiguous terms make up only four notes                                                                                                 |
