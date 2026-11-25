# Back up and restore the database

stockpot copies its database once a day. This guide says where the copies are and how to put one
back.

## The daily backup

At 03:00 in the digest time zone, a scheduled job copies the database with SQLite's `VACUUM INTO`.
The copy is a consistent snapshot, so notes saved while it runs are either in it or not, and the
file is a complete database that needs no `-wal` or `-shm` file beside it.

- **Where:** `backups/` inside the data directory (`STOCKPOT_DATA_DIR`), one file per day, such as
  `backups/stockpot-2026-11-24.db`.
- **How many:** the newest 14, the one just made among them. Each run removes the older ones after its
  own copy is in place, so a failed run removes nothing. Only files named like
  `stockpot-YYYY-MM-DD.db`, and a half-made copy left by a stopped run, are ever removed.
- **While it runs:** the copy takes the database's only connection, so the server answers nothing
  until it ends: seconds for a large database, at a quiet hour.
- **Who can read it:** the folder is `700` and each file `600`. A backup holds the engine keys as
  plain text, as the database does, so keep it as private as the database and copy it only to places
  you trust.
- **A missed run:** when the server was down at 03:00, the run fires once as soon as it starts, with
  the latest missed day.

The backups sit next to the database, so they do not survive a lost disk. Copy the `backups/` folder
somewhere else too, for example with your usual backup tool.

## Restore a backup

1. Stop stockpot, so that nothing writes to the database while you replace it.
2. Move the damaged database and its side files out of the way, into a folder that is new each
   time. Keep them until the restore works. `stockpot.db-wal` and `stockpot.db-shm` may not exist; a
   `mv` that says so is fine, any other error is not, so stop and look at it:

   ```sh
   cd <data directory>
   damaged="damaged-$(date +%Y%m%d-%H%M%S)"
   mkdir "$damaged"
   mv -n stockpot.db "$damaged"/
   mv -n stockpot.db-wal stockpot.db-shm "$damaged"/
   ```

3. Copy the backup you want in as the database:

   ```sh
   cp backups/stockpot-2026-11-24.db stockpot.db
   chmod 600 stockpot.db
   ```

   Run these as the account that runs stockpot. A file owned by another account, such as root,
   cannot be opened by it.

4. Start stockpot. It opens the file like any database and applies the migrations that are newer
   than the backup, after copying the file to `stockpot.db.pre-migration` first.
5. Open the app and check the notes. When they look right, delete the `damaged-…` folder.

Notes saved after the backup was taken are not in it. Look in the `damaged-…` folder if you need them: open
`stockpot.db` there with `sqlite3`.
