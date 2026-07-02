#!/usr/bin/env bash
# Scaffold a new worker in this monorepo: runs `ntn workers new`, then strips
# boilerplate that already lives at the repo root (agent docs, ignore files,
# LICENSE) so the worker directory stays minimal.
set -euo pipefail

cd "$(dirname "$0")"

if [[ $# -ne 1 || ! "$1" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
	echo "Usage: ./new-worker.sh <worker-name>   (lowercase letters, digits, dashes)" >&2
	exit 1
fi
name=$1

if [[ -e $name ]]; then
	echo "Error: $name already exists" >&2
	exit 1
fi

ntn workers new "$name" --no-git --no-install --alpha

# Refresh the shared agent docs at the repo root from the latest scaffold
if [[ -d "$name/.agents" ]]; then
	rm -rf .agents
	mv "$name/.agents" .agents
fi

rm -rf "$name/.claude" "$name/.examples" "$name/docs"
rm -f "$name"/{AGENTS.md,CLAUDE.md,.claudeignore,.codexignore,.gitignore,LICENSE.md,README.md}

cat > "$name/README.md" <<EOF
# $name

TODO: what this worker does, its capabilities, and required env vars.
EOF

(cd "$name" && npm install)

echo
echo "Created $name/. Next:"
echo "  1. Implement capabilities in $name/src/index.ts"
echo "  2. cd $name && ntn workers deploy --name $name"
echo "  3. Commit the directory, including workers.json"
