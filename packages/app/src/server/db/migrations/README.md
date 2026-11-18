# Migrations

Generated SQL migrations, one folder per migration, applied in name order by the server on start and by
`createTestDb()` in specs. They arrive with the first schema. Never edit a migration that shipped in a
release: add a new one.
