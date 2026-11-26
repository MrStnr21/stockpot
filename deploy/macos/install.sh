#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 The stockpot authors

# Usage: install.sh [ref]
#
# Installs stockpot as a LaunchAgent: it starts when you log in and again whenever it stops. Creates
# the folders and the env file, builds the release (the newest v* tag, or the ref you name), writes
# the agent's plist and starts it. Safe to run again: it rewrites the plist and keeps the env file
# and the data.

set -eu

here="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=deploy/macos/common.sh
. "$here/common.sh"

[ "$#" -le 1 ] || fail "usage: install.sh [ref]"

# Everything created from here on is readable by you alone, whatever your shell's umask.
umask 077

# launchd starts the agent without your PATH, so it needs the absolute path of bun.
bun="${STOCKPOT_BUN:-$(command -v bun || true)}"
case "$bun" in
/*) ;;
*) fail "bun is not on your PATH; install it from https://bun.sh" ;;
esac
for tool in git curl plutil launchctl; do
	command -v "$tool" >/dev/null || fail "$tool is not on your PATH"
done

mkdir -p "$home" "$data_dir" "$STOCKPOT_LOG_DIR" "$HOME/Library/LaunchAgents"
chmod 700 "$home" "$data_dir" "$STOCKPOT_LOG_DIR"

if [ ! -e "$env_file" ]; then
	cat >"$env_file" <<EOF
# stockpot settings, read every time stockpot starts. One KEY='value' per line, in shell syntax.
# The README lists every variable under "Configuration". After a change, restart stockpot:
#   launchctl kickstart -k gui/\$(id -u)/$label
#
# The database lives in $data_dir unless you set STOCKPOT_DATA_DIR.
# This file may hold secrets, so keep it readable by you alone (chmod 600).

# PORT='4321'
# HOST='localhost'
# STOCKPOT_PUBLIC_ORIGIN='https://stockpot.example.ts.net'
# STOCKPOT_SOURCE_URL='https://github.com/MrStnr21/stockpot'
# STOCKPOT_AGENT_COMMAND=''
# STOCKPOT_METRICS_TOKEN=''
EOF
	say "created $env_file"
fi
chmod 600 "$env_file"

# The log holds the setup code until the owner exists, so only you may read it.
touch "$log_file"
chmod 600 "$log_file"

if [ "$#" -eq 1 ]; then
	STOCKPOT_BUN="$bun" sh "$here/update.sh" "$1"
else
	STOCKPOT_BUN="$bun" sh "$here/update.sh"
fi
[ -f "$home/current/deploy/macos/run.sh" ] || fail "$home/current holds no release"

# Write the plist with plutil, which escapes every path, into a new file that replaces the old one.
tmp="$plist.new"
rm -f "$tmp"
plutil -create xml1 "$tmp"
plutil -insert Label -string "$label" "$tmp"
plutil -insert ProgramArguments -array "$tmp"
plutil -insert ProgramArguments -string /bin/sh -append "$tmp"
plutil -insert ProgramArguments -string "$home/current/deploy/macos/run.sh" -append "$tmp"
plutil -insert RunAtLoad -bool true "$tmp"
plutil -insert KeepAlive -bool true "$tmp"
plutil -insert ThrottleInterval -integer 10 "$tmp"
plutil -insert Umask -integer 63 "$tmp"
plutil -insert WorkingDirectory -string "$data_dir" "$tmp"
plutil -insert StandardOutPath -string "$log_file" "$tmp"
plutil -insert StandardErrorPath -string "$log_file" "$tmp"
plutil -insert EnvironmentVariables -dictionary "$tmp"
plutil -insert EnvironmentVariables.STOCKPOT_HOME -string "$home" "$tmp"
plutil -insert EnvironmentVariables.STOCKPOT_BUN -string "$bun" "$tmp"
plutil -insert EnvironmentVariables.PATH -string "${bun%/*}:/usr/bin:/bin:/usr/sbin:/sbin" "$tmp"
plutil -lint -s "$tmp"
chmod 600 "$tmp"
mv -f "$tmp" "$plist"

# Load it, replacing a copy loaded before. launchd may take a moment to let go of the old one.
launchctl bootout "$service" 2>/dev/null || true
tries=1
while ! launchctl bootstrap "$domain" "$plist" 2>/dev/null; do
	if [ "$tries" -ge 10 ]; then
		launchctl bootstrap "$domain" "$plist" || fail "launchctl could not load $plist"
		break
	fi
	tries=$((tries + 1))
	sleep 1
done
say "loaded $label from $plist"

if ! wait_healthy ""; then
	fail "stockpot did not answer $(health_url) within 60 seconds; look at the log: $log_file"
fi

say "the log is $log_file"
say "until you create the owner, it holds the setup code: grep 'setup code' \"$log_file\""
