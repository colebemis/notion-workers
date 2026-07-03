# notion-workers

All of my [Notion Workers](https://developers.notion.com/workers/get-started/overview) in one repo. Workers are small TypeScript programs hosted by Notion that add tools to Notion custom agents, sync external data into databases, and receive webhooks.

Each top-level directory is one deployed worker — a self-contained npm project (own `package.json`, lockfile, `workers.json`). There are no shared dependencies and no root `package.json`; every command runs from inside a worker's directory.

## Workers

| Worker | What it does |
| :-- | :-- |
| [`openlibrary`](openlibrary/) | Looks up book cover image URLs by ISBN from OpenLibrary |
| [`firecrawl`](firecrawl/) | Fetches web pages as markdown or screenshots via Firecrawl |
| [`readwise`](readwise/) | Saves links to Readwise Reader to read or watch later |
| [`twitter-bookmarks`](twitter-bookmarks/) | Syncs X (Twitter) bookmarks into a Notion database |

## Setup (once per machine)

```shell
curl -fsSL https://ntn.dev | bash   # install the ntn CLI
ntn login                           # authenticate with your Notion workspace
```

Requires Node ≥ 22.

## Development workflow

Everything happens inside the worker's directory:

```shell
cd openlibrary
npm install                # first time only
npm run check              # type-check
```

Test a capability locally — this runs your code on your machine, auto-loading the worker's `.env`:

```shell
ntn workers exec getBookCover --local -d '{"isbn": "9780140328721", "size": null}'
```

Deploy (builds in the cloud and updates the worker that `workers.json` points at):

```shell
ntn workers deploy
```

Then verify the deployed version by dropping `--local`:

```shell
ntn workers exec getBookCover -d '{"isbn": "9780140328721", "size": null}'
```

Debugging a deployed worker:

```shell
ntn workers runs list            # recent runs
ntn workers runs logs <runId>    # logs for a run
```

## Adding a new worker

```shell
./new-worker.sh my-worker
```

This runs `ntn workers new` and then deletes the boilerplate that already lives at the repo root (agent docs, LICENSE, ignore files), leaving a minimal project. Then:

1. Implement capabilities in `my-worker/src/index.ts` (see [.agents/INSTRUCTIONS.md](.agents/INSTRUCTIONS.md) for the capability API).
2. Write a short `README.md` for the worker.
3. First deploy creates the worker and writes `workers.json`:

   ```shell
   cd my-worker
   ntn workers deploy --name my-worker
   ```

4. Commit everything, **including `workers.json`**.

To use a tool from a Notion custom agent, add it in the agent's tool settings in Notion.

## Secrets

Secrets live in two places, never in git:

- **Locally:** a `.env` file in the worker's directory (gitignored), used by `ntn workers exec --local`.
- **Deployed:** worker env vars, managed with the CLI:

```shell
cd <worker>
ntn workers env set MY_API_KEY=abc123   # set on the deployed worker
ntn workers env push                    # or push the whole local .env
ntn workers env pull                    # write remote vars into local .env
ntn workers env list
```

Push secrets *before* deploying code that needs them.

## Conventions

- **`workers.json` is committed.** The official scaffold gitignores it, but it only contains IDs (workspace + worker), not secrets, and committing it means any clone of this repo deploys updates to the same workers. Deleting it makes the next deploy create a brand-new worker — don't.
- One worker per directory, fully self-contained. Duplication between workers is fine; simplicity beats sharing.
- `.agents/` holds the official platform guide and skills from the `ntn` scaffold, shared once at the repo root; `.examples/` holds the scaffold's reference example for each capability type. Both are refreshed automatically by `new-worker.sh`. `AGENTS.md` (and the `CLAUDE.md` symlink) document the repo conventions for AI agents — this repo is built to be worked on with Claude Code / Codex.

## Using these workers yourself

Feel free to copy any worker into your own setup:

1. Copy the worker's directory.
2. **Delete `workers.json`** (it points at my workspace).
3. `ntn login`, add any required secrets (see the worker's README), then `ntn workers deploy --name <name>`.

## Reference

- [Workers documentation](https://developers.notion.com/workers/get-started/overview)
- [Platform guide + capability API](.agents/INSTRUCTIONS.md) (from the official scaffold)
- `ntn workers --help`
