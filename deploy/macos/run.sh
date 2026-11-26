#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 The stockpot authors

# The launcher the LaunchAgent starts (install.sh writes it). It reads the env file and then replaces
# itself with the server, so the PID launchd watches is the server's own: when the server dies,
# launchd starts it again. Anything that goes wrong here lands in the log with a reason.

set -eu

home="${STOCKPOT_HOME:?is not set; run deploy/macos/install.sh again}"
bun="${STOCKPOT_BUN:?is not set; run deploy/macos/install.sh again}"

if [ -f "$home/stockpot.env" ]; then
	set -a
	# shellcheck source=/dev/null
	. "$home/stockpot.env"
	set +a
fi

STOCKPOT_DATA_DIR="${STOCKPOT_DATA_DIR:-$home/data}"
export STOCKPOT_DATA_DIR

# Resolve the link once, so the server keeps its files while an update switches `current`.
release="$(cd "$home/current" && pwd -P)"

printf 'stockpot: starting %s at %s\n' "${release##*/}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2

exec "$bun" "$release/packages/app/dist/server/entry.mjs"
