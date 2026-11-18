# Architecture decision records

The [decisions table](../principles.md#decisions) holds the standing decisions the codebase is
written against, one row each. This folder holds the few decisions that need more room than a row.

## A row or an ADR?

A row in the decisions table is enough when the decision fits in one sentence, its reason fits in
a few, and nobody needs to know which alternatives lost.

Write an ADR when at least one of these is true:

- there were real alternatives, and the reasons for rejecting them matter to whoever revisits the
  choice;
- the decision rests on measurements or a spike, and the numbers should stay next to it;
- reversing it later would be expensive: a data format, a storage layout, a public API, a
  dependency that many modules use, or the license;
- it changes or replaces a row in the decisions table.

The decisions table stays the summary: when an ADR is accepted, add or update the row and link the
ADR from it. Spikes write their findings into the docs they own (for example `docs/engines.md`);
an ADR records only the decision taken from them.

## How to write one

1. Copy the template below into `NNNN-short-title.md`, numbered one above the last record.
   Numbers are never reused.
2. Open it in a pull request with the status `Proposed`, linked to the issue it answers.
3. When the pull request merges, the status becomes `Accepted`.
4. An accepted record is not rewritten. To change the decision, write a new record and set the old
   one's status to `Superseded by NNNN`.

## Template

```md
# NNNN. Decision title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD
- Issue: #n

## Context

The problem, the constraints and the forces at play, including the principles and budgets involved.

## Options

Each option considered, with what speaks for and against it. Include measurements where they exist.

## Decision

The option chosen, in one or two sentences.

## Consequences

What becomes easier, what becomes harder, and what follow-up work this creates.
```

## Records

None yet.
