# Run stockpot on a Mac

This guide installs stockpot as a LaunchAgent: macOS starts it when you log in, and starts it again
whenever it stops. The scripts in `deploy/macos/` build a release from the source, keep your data
apart from it, and update it in place.

## What you need

- macOS, logged in as the account that will run stockpot. Nothing here needs `sudo`.
- `git`, from the Xcode command line tools (`xcode-select --install`).
- [Bun](https://bun.sh), installed for your account. The installer records where `bun` is, because
  launchd starts the agent without your shell's `PATH`.

## Install

Clone the repository anywhere, and run the installer from it:

```sh
git clone https://github.com/MrStnr21/stockpot.git
sh stockpot/deploy/macos/install.sh
```

The installer builds the newest release tag. Until the first release is tagged, name a ref instead:
a tag, a branch or a commit, such as `sh stockpot/deploy/macos/install.sh main`.

It then:

1. creates `~/Library/Application Support/stockpot`, readable by you alone;
2. writes the settings file `stockpot.env` there, from a commented template;
3. fetches and builds the release in `releases/`, and points the link `current` at it;
4. writes `~/Library/LaunchAgents/local.stockpot.plist` and loads it;
5. waits up to a minute for `http://localhost:4321/healthz` to answer 200.

The clone is needed only to run the installer once: later updates use the scripts of the installed
release. Running the installer again is safe. It rewrites the plist and restarts stockpot, and keeps
the settings file and the data.

Everything stockpot keeps is in one folder:

| Path, in `~/Library/Application Support/stockpot` | What it holds                                               |
| ------------------------------------------------- | ----------------------------------------------------------- |
| `data/`                                           | The database and its daily `backups/` (`STOCKPOT_DATA_DIR`) |
| `stockpot.env`                                    | Your settings, read every time stockpot starts              |
| `releases/`                                       | The built releases: the running one and the one before it   |
| `current`                                         | A link to the running release                               |

## Configure

`stockpot.env` holds the variables the [README](../../README.md#configuration) lists, one
`KEY='value'` per line in shell syntax. Uncomment a line and change its value:

```sh
PORT='4321'
HOST='0.0.0.0'
STOCKPOT_PUBLIC_ORIGIN='https://stockpot.example.ts.net'
```

The data folder is `data/` unless you set `STOCKPOT_DATA_DIR`. The file may hold secrets, such as
the agent command and the metrics token, so it is readable by you alone (`600`); keep it that way.
Updates and new installs never overwrite it.

stockpot reads the file only when it starts, so restart it after a change:

```sh
launchctl kickstart -k gui/$(id -u)/local.stockpot
```

A value stockpot rejects stops it with a message in the log naming the variable. launchd then tries
again every 10 seconds, and each try adds the same message, until you fix the file.

## Sign in the first time

Until you create the owner, stockpot writes a one-time setup code to its log every time it starts
([First run and signing in](../../README.md#first-run-and-signing-in)). Find it with:

```sh
grep 'setup code' ~/Library/Logs/stockpot/stockpot.log | tail -n 1
```

Open `/setup`, enter the code and choose a password.

## Logs

stockpot writes everything, its own lines and any error, to `~/Library/Logs/stockpot/stockpot.log`.
The file is readable by you alone, because it holds the setup code until the owner exists.

Nothing rotates the file, so it grows until you empty it. Check its size now and then:

```sh
ls -lh ~/Library/Logs/stockpot/stockpot.log
```

To empty it, truncate it in place. This is safe while stockpot runs, because it keeps writing at the
end of the file:

```sh
: > ~/Library/Logs/stockpot/stockpot.log
```

Do not delete or move the file instead: stockpot would keep writing to the old one until it restarts.

## Update

Run the update script of the installed release. Like the installer, it takes the newest release tag,
or the ref you name:

```sh
sh ~/Library/Application\ Support/stockpot/current/deploy/macos/update.sh
sh ~/Library/Application\ Support/stockpot/current/deploy/macos/update.sh main
```

It builds the new release in a folder of its own, switches `current` to it, restarts stockpot and
waits up to a minute for `/healthz` to answer 200. When the build fails, it removes the new folder
and stockpot keeps running the old release. Only one update runs at a time.

At its start the new release applies its database migrations, after copying the database to
`data/stockpot.db.pre-migration`. The update never touches the data folder itself. It keeps the new
release and the one before it, and removes older ones.

### Switch back

When the new release does not answer, the update says so, names the release before it and the
commands to switch back. They are:

```sh
cd ~/Library/Application\ Support/stockpot
ls releases
ln -sfh releases/<the release before> current
launchctl kickstart -k gui/$(id -u)/local.stockpot
```

Running `update.sh` with the ref of that release does the same: a release that is still in
`releases/` is reused, not built again.

If the new release migrated the database, the old release may not open it. Put back the copy from
before the migration, `stockpot.db.pre-migration`, as [Back up and restore the database](restore.md)
explains for a backup.

## What stockpot survives

- **A crash or `kill -9`.** launchd starts it again within about 10 seconds.
- **A reboot.** It starts again when you log in, not before: a LaunchAgent runs in your login
  session. With FileVault on, the disk stays locked until you log in anyway.
- **An update.** The data folder and the settings file are kept; see [Update](#update).
- **Uninstalling.** The data, the settings and the log are kept; see below.

For backups of the database, see [Back up and restore the database](restore.md).

## Uninstall

```sh
sh ~/Library/Application\ Support/stockpot/current/deploy/macos/uninstall.sh
```

It stops stockpot and removes the plist, so it no longer starts when you log in. It keeps
`~/Library/Application Support/stockpot` and the log, and prints the command that removes them. The
data holds your notes and engine keys, so remove it only when you are sure.

## Overrides

Every script reads these variables, for a second instance, a test install or a fork. Set them for
each script you run, the same way each time:

| Variable           | Default                                    | What it sets                                      |
| ------------------ | ------------------------------------------ | ------------------------------------------------- |
| `STOCKPOT_HOME`    | `~/Library/Application Support/stockpot`   | The folder with the data, settings and releases   |
| `STOCKPOT_LOG_DIR` | `~/Library/Logs/stockpot`                  | The folder of `stockpot.log`                      |
| `STOCKPOT_LABEL`   | `local.stockpot`                           | The agent's label, and the name of its plist      |
| `STOCKPOT_REPO`    | `https://github.com/MrStnr21/stockpot.git` | The repository that releases are fetched from     |
| `STOCKPOT_BUN`     | `bun` on your `PATH`                       | The absolute path of the `bun` that runs stockpot |

For example, a second instance from your fork. It needs a port of its own, so write its settings
file before you install: the installer never overwrites one that exists.

```sh
export STOCKPOT_HOME=/Users/you/stockpot-test STOCKPOT_LABEL=local.stockpot-test
export STOCKPOT_LOG_DIR=/Users/you/stockpot-test/logs
export STOCKPOT_REPO=https://github.com/you/stockpot.git
mkdir -p "$STOCKPOT_HOME"
printf "PORT='4322'\n" > "$STOCKPOT_HOME/stockpot.env"
sh stockpot/deploy/macos/install.sh main
```
