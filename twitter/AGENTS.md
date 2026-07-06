# twitter — worker-specific rules

Auth here is self-managed with **single-use rotating X refresh tokens carried in sync state** (see README "Auth"). This OVERRIDES the monorepo verification norms:

- NEVER run `ntn workers exec bookmarksSync --local`, `ntn workers sync trigger bookmarksSync --preview`, or `ntn workers sync state reset bookmarksSync` without explicit user sign-off — each can consume or strand the token family and kill the deployed worker's auth.
- Verify changes with: `npm run check` → fixture-test the pure functions in `src/content.ts` via `npx tsx` → deploy → `ntn workers sync trigger bookmarksSync` → inspect `ntn workers runs logs <id>`.
- Re-auth runbook: `npx tsx scripts/authorize.ts` → browser approve → `ntn workers env set X_REFRESH_TOKEN=<printed>`. No redeploy needed.
- `worker.oauth()` was removed deliberately — it cannot complete X's token exchange (see README → Auth). Don't reintroduce it.
- The access token in run logs (`nextUserContext.tokens.accessToken`) is safe for read-only curl probes — only refresh calls rotate the family. Useful for diffing worker-egress vs local behavior when X misbehaves regionally.
