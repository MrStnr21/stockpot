#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 The stockpot authors

# Usage: uninstall.sh
#
# Stops stockpot and removes its LaunchAgent, so it no longer starts when you log in. Keeps the data,
# the env file, the releases and the log, and says how to remove them.

set -eu

here="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=deploy/macos/common.sh
. "$here/common.sh"

[ "$#" -eq 0 ] || fail "usage: uninstall.sh"

if agent_loaded; then
	launchctl bootout "$service"
	say "stopped $label"
else
	say "$label is not loaded"
fi

if [ -e "$plist" ]; then
	rm -f "$plist"
	say "removed $plist"
fi

say "kept the data, the env file and the releases in $home, and the log in $STOCKPOT_LOG_DIR."
say "the data holds your notes and engine keys. To remove everything for good:"
printf '  rm -rf "%s" "%s"\n' "$home" "$STOCKPOT_LOG_DIR"
