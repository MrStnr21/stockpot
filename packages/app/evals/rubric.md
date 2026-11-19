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

Phrases that add words without meaning. A card that uses one fails the `filler` check. Keep the list
short and add a phrase only after it shows up in a real card.

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
