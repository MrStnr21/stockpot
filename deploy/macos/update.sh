#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 The stockpot authors

# Usage: update.sh [ref]
#
# Builds a release of stockpot and switches to it: the newest v* tag, or the tag, branch or commit
# you name. The new release is fetched and built in a folder of its own, so a failed build leaves
# the running one alone. The data folder is never touched; the server migrates the database when it
# restarts, after copying it to stockpot.db.pre-migration.

set -eu

here="$(cd "$(dirname "$0")" && pwd -P)"
# shellcheck source=deploy/macos/common.sh
. "$here/common.sh"

[ "$#" -le 1 ] || fail "usage: update.sh [ref]"
ref="${1:-}"

bun="${STOCKPOT_BUN:-$(command -v bun || true)}"
[ -n "$bun" ] || fail "bun is not on your PATH; install it from https://bun.sh"
command -v git >/dev/null || fail "git is not on your PATH; install the Xcode command line tools"
[ -d "$home" ] || fail "$home does not exist; run deploy/macos/install.sh first"

if [ -z "$ref" ]; then
	tags="$(git ls-remote --tags --refs "$STOCKPOT_REPO" 'v*')" ||
		fail "could not list the tags of $STOCKPOT_REPO"
	ref="$(printf '%s\n' "$tags" | sed -n 's|^[0-9a-f]*[[:space:]]*refs/tags/||p' | grep -v '\^{}$' | sort -V | tail -n 1)" || true
	[ -n "$ref" ] ||
		fail "$STOCKPOT_REPO has no release tag yet; name a ref instead, such as: update.sh main"
	say "the newest release is $ref"
fi

# A ref is passed to git as an argument, so allow only what tags, branches and commits are made of.
case "$ref" in
-* | *..* | *[!A-Za-z0-9._/-]*) fail "'$ref' is not a tag, branch or commit name" ;;
*) ;;
esac

# 1. One update at a time. A lock left by a stopped update is removed by hand.
lock="$home/update.lock"
mkdir "$lock" 2>/dev/null ||
	fail "another update is running. If none is, remove the lock: rmdir \"$lock\""
partial=""
cleanup() {
	if [ -n "$partial" ]; then
		rm -rf "$partial"
	fi
	rmdir "$lock"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

mkdir -p "$releases"
# Anything still named .partial was left by a stopped update; the lock says none is running.
rm -rf "$releases"/*.partial "$releases/.fetch.partial"

# 2. Fetch the ref into a fresh folder. Fetching by name works for tags, branches and commits.
partial="$releases/.fetch.partial"
say "fetching $ref from $STOCKPOT_REPO"
git init -q "$partial"
git -C "$partial" fetch -q --depth 1 "$STOCKPOT_REPO" "$ref" ||
	fail "could not fetch $ref from $STOCKPOT_REPO"
git -C "$partial" -c advice.detachedHead=false checkout -q --detach FETCH_HEAD
sha="$(git -C "$partial" rev-parse HEAD)"
name="$(printf '%s' "$ref" | tr '/' '-')-$(printf '%s' "$sha" | cut -c 1-12)"

previous=""
if [ -L "$home/current" ]; then
	previous="$(readlink "$home/current")"
	previous="${previous##*/}"
fi

if [ "$name" = "$previous" ]; then
	say "$name is already the running release"
	exit 0
fi

if [ -d "$releases/$name" ]; then
	say "reusing the release built before: $name"
	rm -rf "$partial"
	partial=""
else
	[ -f "$partial/deploy/macos/run.sh" ] ||
		fail "$ref has no deploy/macos/run.sh, so it cannot run as a service; choose a newer ref"
	mv "$partial" "$releases/$name.partial"
	partial="$releases/$name.partial"

	# 3. Build. On failure the trap removes the folder and `current` stays where it was.
	say "building $name"
	(cd "$partial" && "$bun" install --frozen-lockfile && "$bun" run build) ||
		fail "the build of $ref failed; the running release is unchanged"

	# 4. Only a finished build gets its final name.
	mv "$partial" "$releases/$name"
	partial=""
fi

# A new link renamed over the old one, so `current` always names a release, even mid-switch.
ln -sfh "releases/$name" "$home/current.new"
mv -fh "$home/current.new" "$home/current"
say "current release: $name"

# 5. Restart the server on the new release, if it runs as a service.
if agent_loaded; then
	old_pid="$(agent_pid)"
	say "restarting $label"
	launchctl kickstart -k "$service"
	if ! wait_healthy "$old_pid"; then
		db_dir="$(env_value STOCKPOT_DATA_DIR)"
		{
			printf 'stockpot: %s did not answer 200 within 60 seconds.\n' "$(health_url)"
			printf '  Look at the log: %s\n' "$log_file"
			if [ -n "$previous" ]; then
				printf '  To switch back to %s:\n' "$previous"
				printf '    ln -sfh "releases/%s" "%s/current"\n' "$previous" "$home"
				printf '    launchctl kickstart -k %s\n' "$service"
				printf '  Switch back before you run another update: it keeps only the release it\n'
				printf '  replaces, so it would remove %s.\n' "$previous"
			fi
			printf '  If the new release migrated the database, the copy from before the migration is\n'
			printf '  %s/stockpot.db.pre-migration; put it back as %s explains.\n' "$db_dir" "$restore_guide"
		} >&2
		exit 1
	fi
else
	say "$label is not loaded; the release starts when the service does"
fi

# 6. Keep the running release and the one it replaced, for switching back.
for dir in "$releases"/*; do
	[ -d "$dir" ] || continue
	case "${dir##*/}" in
	"$name" | "$previous" | *.partial) ;;
	*)
		say "removing the old release ${dir##*/}"
		rm -rf "$dir"
		;;
	esac
done
