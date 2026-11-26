#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 The stockpot authors

# Shared by install.sh, update.sh and uninstall.sh, which source it: the folders, the agent's label
# and the health wait. The defaults can be overridden in the environment, for a test install or a
# fork (docs/install/macos.md).

STOCKPOT_HOME="${STOCKPOT_HOME:-$HOME/Library/Application Support/stockpot}"
STOCKPOT_LOG_DIR="${STOCKPOT_LOG_DIR:-$HOME/Library/Logs/stockpot}"
STOCKPOT_LABEL="${STOCKPOT_LABEL:-local.stockpot}"
STOCKPOT_REPO="${STOCKPOT_REPO:-https://github.com/MrStnr21/stockpot.git}"

home="$STOCKPOT_HOME"
data_dir="$home/data"
env_file="$home/stockpot.env"
releases="$home/releases"
log_file="$STOCKPOT_LOG_DIR/stockpot.log"
label="$STOCKPOT_LABEL"
plist="$HOME/Library/LaunchAgents/$label.plist"
domain="gui/$(id -u)"
service="$domain/$label"
restore_guide="https://github.com/MrStnr21/stockpot/blob/main/docs/install/restore.md"

fail() {
	printf 'stockpot: %s\n' "$*" >&2
	exit 1
}

say() {
	printf 'stockpot: %s\n' "$*"
}

# Every script removes and replaces folders under STOCKPOT_HOME, so refuse a relative or root path.
case "$home" in
/ | //*) fail "STOCKPOT_HOME must not be the root folder" ;;
/*) ;;
*) fail "STOCKPOT_HOME must be an absolute path, not '$home'" ;;
esac

case "$label" in
'' | *[!A-Za-z0-9._-]*) fail "STOCKPOT_LABEL may hold only letters, digits, dots, dashes and underscores" ;;
*) ;;
esac

# One variable from the env file, as the launcher would see it, or the default. Read in a subshell
# that drops the caller's own value first, so a PORT exported in your shell does not leak in.
env_value() {
	(
		unset PORT HOST STOCKPOT_DATA_DIR
		if [ -f "$env_file" ]; then
			# shellcheck source=/dev/null
			. "$env_file"
		fi
		case "$1" in
		PORT) printf '%s\n' "${PORT:-4321}" ;;
		HOST) printf '%s\n' "${HOST:-localhost}" ;;
		STOCKPOT_DATA_DIR) printf '%s\n' "${STOCKPOT_DATA_DIR:-$data_dir}" ;;
		*) return 1 ;;
		esac
	)
}

# The address the health check calls: the server's own HOST, or localhost when it listens on every
# interface.
health_url() {
	host="$(env_value HOST)"
	port="$(env_value PORT)"
	case "$host" in
	'' | 0.0.0.0 | :: | '[::]') host=localhost ;;
	*:*) host="[$host]" ;;
	*) ;;
	esac
	printf 'http://%s:%s/healthz\n' "$host" "$port"
}

agent_loaded() {
	launchctl print "$service" >/dev/null 2>&1
}

# The PID launchd tracks for the agent, or nothing when it is not running.
agent_pid() {
	launchctl print "$service" 2>/dev/null | sed -n 's/^[[:space:]]*pid = \([0-9][0-9]*\)$/\1/p' | head -n 1
}

# Waits up to 60 seconds for a server process other than $1 (the PID before a restart, or empty)
# to answer the health check with 200. Returns 1 on timeout.
wait_healthy() {
	old_pid="$1"
	url="$(health_url)"
	deadline=$(($(date +%s) + 60))
	while [ "$(date +%s)" -lt "$deadline" ]; do
		pid="$(agent_pid)"
		if [ -n "$pid" ] && [ "$pid" != "$old_pid" ] &&
			curl -fsS -o /dev/null --max-time 2 "$url" 2>/dev/null; then
			say "running as PID $pid, $url answers 200"
			return 0
		fi
		sleep 1
	done
	return 1
}
