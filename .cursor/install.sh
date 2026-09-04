#!/usr/bin/env bash
# Cloud Agent install: prepare every worker in this monorepo for development.
# Idempotent — safe to re-run and safe to bake into an environment build snapshot.
set -euo pipefail

cd "$(dirname "$0")/.."

# The ntn (Notion Workers) CLI drives every worker: type-checking, local exec,
# deploys, and sync management. It installs to ~/.local/bin, which is already on
# PATH in this image's login and non-login shells.
export PATH="$HOME/.local/bin:$PATH"
if ! command -v ntn >/dev/null 2>&1; then
	echo "== installing ntn CLI =="
	curl -fsSL https://ntn.dev | bash
fi
ntn --version

# Each top-level directory with a package.json is a self-contained worker
# (no root package.json, no shared dependencies). Install deps per worker.
for pkg in */package.json; do
	[ -f "$pkg" ] || continue
	dir=${pkg%/package.json}
	echo "== installing dependencies: $dir =="
	if [ -f "$dir/package-lock.json" ]; then
		(cd "$dir" && npm ci)
	else
		(cd "$dir" && npm install)
	fi
done

echo "== install complete =="
