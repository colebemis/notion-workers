# Notion Workers monorepo

This repo holds all of my Notion Workers. Each top-level directory (e.g. `book-cover-worker/`) is one deployed worker: a self-contained npm project with its own `package.json`, lockfile, `src/index.ts`, and `workers.json`.

For the full Notion Workers platform guide — capability API (tools, syncs, automations, webhooks, OAuth), sync patterns, testing, and debugging — read [.agents/INSTRUCTIONS.md](.agents/INSTRUCTIONS.md). Skills for sync work live in `.agents/skills/`.

## Conventions

- **All `ntn` and `npm` commands run from inside a worker's directory**, not the repo root. There is no root `package.json` and no shared dependencies.
- **`workers.json` is committed** (it holds the workspace/worker IDs that link a directory to its deployed worker — IDs, not secrets). This deviates from the official scaffold's `.gitignore`. Never gitignore it here, and never delete it for an existing worker: without it, `ntn workers deploy` creates a *new* worker instead of updating.
- **Secrets are never committed.** Local dev reads `.env` (gitignored); deployed workers read env vars set via `ntn workers env set` / `ntn workers env push`. If you add a new secret, push it before deploying code that needs it.
- Each worker has a short `README.md`: what it does, its capabilities, and required env vars. Keep it current when you change capabilities.
- **Tool schemas use the `j` builder** (`import { j } from "@notionhq/workers/schema-builder"`). SDK ≥ 0.4.0 no longer accepts raw JSON Schema objects in `tool()` — note some examples in `.agents/INSTRUCTIONS.md` predate this.
- **No `"type": "module"` in worker `package.json` files.** `ntn workers exec --local` (CLI 0.16.0) fails on ESM workers with `Cannot read properties of undefined (reading 'run')`. CJS mode works locally and deploys identically (requires `typescript` ≥ 5.8 to type-check importing the ESM SDK). `new-worker.sh` strips this from new scaffolds automatically.

## Workflows

**Update an existing worker:**
```shell
cd <worker>
npm install            # first time only
npm run check          # type-check
ntn workers exec <capabilityKey> --local -d '{...}'   # test locally (.env is auto-loaded)
ntn workers deploy     # ship it
ntn workers exec <capabilityKey> -d '{...}'           # verify the deployed version
```

**Add a new worker:**
```shell
./new-worker.sh <name>          # scaffolds <name>/ and strips boilerplate that already lives at the repo root
cd <name>
# implement capabilities in src/index.ts, update README.md
ntn workers deploy --name <name>   # first deploy creates the worker and writes workers.json
```
Commit the new directory including `workers.json`.

**Debug a deployed worker:**
```shell
ntn workers runs list
ntn workers runs logs <runId>
```

## Verification expectations

Before considering a change done: `npm run check` passes, and every added or changed capability has been exercised with `ntn workers exec <key> --local -d '{...}'` (or `--preview` for syncs). After deploying, run the capability once against the deployed worker.
