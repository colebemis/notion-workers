# twitter-bookmarks

Syncs your X (Twitter) bookmarks into a managed Notion database ("Twitter Bookmarks"). Each bookmark becomes a page: images inline, self-threads expanded in full with divider rules between posts, long-form posts at full length, external article links as titled links. Row icon is the author's avatar.

## Capabilities

- `bookmarksSync` — incremental, every 30m. Probes the newest bookmark (one ~$0.001 read when nothing changed); pages deeper only when new bookmarks appear. The first cycle loads the full list (X caps the API at roughly the 800 most recent; `X_FULL_LOAD_LIMIT` caps it lower). Add-only: removing a bookmark on X does not remove its Notion row. To force a full re-fetch, change `X_FULL_RESYNC` to a new value and push.

X 5xx responses retry in-run (4s/8s backoff); a cycle that still fails logs a consecutive-failure count, keeps state intact, and the next successful cycle backfills everything missed. (X occasionally serves regional 5xx waves.)

Type select: `Thread` (root with self-replies), `Article` (X-native long-form Article — title + full body; shape verified against live payloads), `Tweet` (everything else, including long `note_tweet` posts, whose full text renders in the body).

## Auth (self-managed — read this before touching it)

This is a **workaround for a Workers platform bug**, not the recommended pattern. The documented path (`worker.oauth()` + `ntn workers oauth start`) can't complete X's token exchange: X's token endpoint requires client credentials via HTTP Basic auth (`client_secret_basic` — the one method RFC 6749 says servers must support), but the Workers backend sends them another way, so the exchange always fails with `OAuth refresh failed with status 401`. Two smaller platform issues compound it: the CLI registers the OAuth callback on pre-migration `www.notion.so` (where browser sessions no longer live), and callback state validation breaks when the browser is signed into multiple Notion accounts. Reported to the Workers team 2026-07-02 — revisit `worker.oauth()` when fixed.

Until then, this worker manages tokens itself (`src/token.ts`):

- One-time consent: `npx tsx scripts/authorize.ts` → approve in a browser. The script listens on `http://localhost:8787/callback`, exchanges the code the moment X redirects (X auth codes expire in ~30s), and prints the `ntn workers env set X_REFRESH_TOKEN=…` command.
- X rotates refresh tokens on every use; the live family is carried in the sync's persisted state. Consequences: **`ntn workers sync state reset bookmarksSync` kills auth** (the state's rotated token is lost and the env seed is already consumed) — after a reset, re-run the authorize script. The sync's `execute` never throws after a refresh for the same reason.

## Env vars

- `X_OAUTH_CLIENT_ID` / `X_OAUTH_CLIENT_SECRET` — required. From developer.x.com → app → User authentication settings (OAuth 2.0, type "Web App", with `http://localhost:8787/callback` registered as a callback URI for the authorize script).
- `X_REFRESH_TOKEN` — required. From `scripts/authorize.ts`.
- `X_THREAD_TIMELINE_PAGES` — optional, **default 0 (off)**. Timeline pages (100 posts each) scanned to rebuild threads older than 7 days. This is the one expensive operation (~$0.005 × every post returned, for every old conversation-root bookmark) — enable temporarily with a full resync when you want old threads backfilled.
- `X_FULL_RESYNC` — optional. Change to any new value to trigger a full re-fetch.
- `X_FULL_LOAD_LIMIT` — optional, default 850. Caps bookmarks fetched in a full-load cycle; set to 10 for a cheap trial run.
- `X_PAUSED` — optional. `1` stops the sync doing anything (no API calls, no token refresh, state preserved). The kill switch.

## Development workflow

The monorepo's standard verify loop (`exec --local`, `sync trigger --preview`) is **unsafe here**: X refresh tokens are single-use, so any `execute` outside the deployed sync can consume a token whose successor never reaches deployed state.

| Action | Safety |
|---|---|
| `npm run check` | always safe |
| Fixture-testing `src/content.ts` via `npx tsx` | always safe (pure functions, no tokens) |
| `ntn workers deploy` | safe (doesn't touch sync state) |
| `ntn workers sync trigger bookmarksSync` | safe — this is the integration test |
| `sync trigger --preview` | **unsafe** if the deployed access token is stale (>~2h): the preview refreshes, rotates the family, and discards the new tokens |
| `exec bookmarksSync --local` | harmless failure normally (seed already consumed), but **steals a fresh seed** if run right after re-auth, before the deployed worker adopts it |
| `sync state reset bookmarksSync` | **kills auth** — always follow with the re-auth runbook |

Typical loop: edit → `npm run check` → deploy → `ntn workers sync trigger bookmarksSync` → inspect `ntn workers runs list` / `runs logs <id>` (the run log contains the full returned changes JSON, including the rendered `pageContentMarkdown`).

Re-rendering existing pages after a content change: set a new marker (`ntn workers env set X_FULL_RESYNC=v2`) and trigger — every bookmark re-upserts. Re-upserts replace page content (they don't append).

Re-auth runbook (after a state reset or dead token family): `npx tsx scripts/authorize.ts` → approve in browser → run the printed `ntn workers env set X_REFRESH_TOKEN=…` → trigger. No redeploy needed; env is read at execute time.

## Costs (X pay-per-use)

Bookmark reads are owned reads (~$0.001/post); thread reconstruction uses recent search / timeline reads (~$0.005/post returned). Quiet checks ≈ $0.05/day at the 30m schedule. Full load of N bookmarks ≈ N × $0.001 plus thread fetches. Threads older than 7 days are rebuilt from a snowflake-bounded timeline scan of the 72h after the root post; longer-lived threads get a "may be incomplete" note.

## Known limits

- Images/video hotlink to `pbs.twimg.com` — if the post is deleted upstream, media in the archive breaks (text survives).
- No `bookmarked_at` in the X API; `Posted` is the post's creation time and sync order approximates bookmark order.
- Bookmarking a mid-thread post syncs just that post; thread expansion applies when you bookmark the root.
- Add-only (no replace-mode sweep): un-bookmarked posts stay in Notion until removed by hand.
