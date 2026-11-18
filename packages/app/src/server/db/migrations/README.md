# Migrations

SQL migrations, one folder per migration: `<timestamp>_<name>/migration.sql`, with the
`snapshot.json` that drizzle-kit compares the schema against next time. `openDatabase` in
[`../client.ts`](../client.ts) applies the ones a database has not seen yet, in name order, whenever
it opens one: the server on start and `createTestDb()` in specs.

## Adding a migration

1. Change the schema in [`../schema/`](../schema/).
2. Run `bun run db:generate -- --name <what-changed>` from the repository root. It writes the next
   folder here.
3. Commit the folder as drizzle-kit wrote it; Prettier leaves these folders alone.

A migration that has reached `main` is never edited, renamed or deleted, because running instances
have already applied it: add a new one instead. `bun run check:migrations` fails CI when a migration
on `origin/main` changed, or when a new one sorts before the last migration there. In that case,
rebase, delete your folder and generate it again.

## Hand-written SQL

drizzle-kit does not model FTS5 tables, views or triggers, so the full-text search index and one
trigger for terms are hand-written at the end of the first migration, below the generated
statements:

- **`note_search`**, an FTS5 table with one row per note, keyed by the note's id (`rowid`), with three
  columns: `text` and `context` from the note, and `cards`, the text of every card written for the
  note. The `unicode61` tokenizer folds case in every script and drops diacritics from Latin letters
  (`cafe` finds `café`; `ё` and `е` stay distinct). Prefix indexes for two and three characters keep
  search-as-you-type on the index.
- **`note_card_text`**, a view of the string values in each note's card bodies, so the JSON keys that
  every card of a format shares are never indexed.
- **Triggers** keep `note_search` in step: `notes_search_insert`, `notes_search_update` (of `text` or
  `context`) and `notes_search_delete` on `notes`, and `explanations_search_insert`,
  `explanations_search_update` (of `note_id` or `body`) and `explanations_search_delete` on
  `explanations`.
- **`terms_delete_cards`** deletes the cards written for a term alone before the term goes. Its
  foreign key would set their `term_id` to NULL, which the `explanations_subject` check rejects, so
  without the trigger such a term could never be deleted. Cards that also belong to a note keep the
  note and lose only the term.

Search joins the index to the notes by id and orders by relevance:

```sql
SELECT notes.* FROM note_search
JOIN notes ON notes.id = note_search.rowid
WHERE note_search MATCH ?
ORDER BY rank
```

When drizzle-kit cannot change a table in place it rebuilds it: it creates a new table, copies the
rows, drops the old one and renames the new one. Dropping `notes`, `explanations` or `terms` drops
their triggers too, so a migration that rebuilds one of them must create its triggers again at the
end; the specs fail when they are missing. Later hand-written SQL goes in a folder of its own,
made with `bun run db:generate -- --custom --name <what-it-does>`.
