/**
 * X bookmarks → Notion sync.
 *
 * Syncs your X (Twitter) bookmarks into a managed Notion database. Each
 * bookmark becomes a page: images inline, self-threads expanded in full
 * (posts separated by dividers), long-form posts at full length, external
 * article links as titled links.
 *
 * Auth is self-managed (see src/token.ts): the built-in `worker.oauth()`
 * can't complete X's token exchange, so a local script mints the refresh
 * token and each cycle refreshes it here, carrying the rotating family in
 * sync state.
 *
 * One sync, `bookmarksSync` (every 30m): probes the newest bookmark first
 * (one ~$0.001 read on quiet checks) and only pages deeper when something
 * new appears. First cycle (or after an X_FULL_RESYNC change) loads the
 * full list — X caps the API at roughly the 800 most recent. Add-only:
 * removing a bookmark on X does not delete its Notion row.
 *
 * Env
 * ───
 *   X_OAUTH_CLIENT_ID        required — X app OAuth 2.0 client ID
 *   X_OAUTH_CLIENT_SECRET    required — X app OAuth 2.0 client secret
 *   X_REFRESH_TOKEN          required — seed from scripts/authorize.ts
 *   X_THREAD_TIMELINE_PAGES  optional — timeline pages (×100 posts) scanned to
 *                            rebuild threads older than 7 days (default 0, off)
 *   X_FULL_LOAD_LIMIT        optional — cap bookmarks fetched in a full-load
 *                            cycle (default 850)
 *   X_FULL_RESYNC            optional — change to any new value to force a
 *                            full re-fetch on the next cycle
 *   X_PAUSED                 optional — "1" pauses the sync entirely (no API
 *                            calls, no token refresh, state preserved)
 */

import { Worker } from "@notionhq/workers";
import * as Builder from "@notionhq/workers/builder";
import * as Schema from "@notionhq/workers/schema";

import { buildPageMarkdown, pageTitle, tweetUrl } from "./content";
import { ensureFreshTokens, TokenState } from "./token";
import {
	fetchSelfThreadReplies,
	getBookmarksPage,
	getMe,
	Lookup,
	snowflakeToIso,
	XTweet,
	XUser,
} from "./x";

const worker = new Worker();
export default worker;

// Timeline scans for threads older than 7 days bill every post returned
// (~$0.005 each, up to 100/page) — the one genuinely expensive operation.
// Default off; bump temporarily (with X_FULL_RESYNC) to backfill old threads.
const THREAD_TIMELINE_PAGES = Number(process.env.X_THREAD_TIMELINE_PAGES ?? 0);

// Cap bookmarks fetched in a full-load cycle. Set low (e.g. 10) for a
// small trial run, then raise/remove and bump X_FULL_RESYNC for the rest.
const FULL_LOAD_LIMIT = Number(process.env.X_FULL_LOAD_LIMIT ?? 850);

const PAGE_SIZE = 25; // bookmarks per execute call; keeps one call's thread fetches bounded
const MAX_PAGES_PER_CYCLE = 8; // ≈200 new bookmarks per normal cycle
const MAX_FULL_LOAD_PAGES = 34; // ≈850 — covers X's ~800-bookmark API cap
const SEEN_CAP = 500;

// User-context X rate limits are per-15-minute windows (bookmarks: 180/15m).
const xApi = worker.pacer("xApi", {
	allowedRequests: 1,
	intervalMs: 1500,
});

const bookmarks = worker.database("bookmarks", {
	type: "managed",
	initialTitle: "Twitter Bookmarks",
	primaryKeyProperty: "Tweet ID",
	schema: {
		properties: {
			Tweet: Schema.title(),
			"Tweet ID": Schema.richText(),
			Author: Schema.richText(),
			URL: Schema.url(),
			Posted: Schema.date(),
			Type: Schema.select([
				{ name: "Tweet", color: "gray" },
				{ name: "Thread", color: "blue" },
				{ name: "Article", color: "orange" },
			]),
		},
	},
});

/** Build the upsert for one bookmarked tweet, expanding self-threads. */
async function tweetToUpsert(token: string, tweet: XTweet, lookup: Lookup) {
	const author = tweet.author_id ? lookup.users.get(tweet.author_id) : undefined;

	let thread: XTweet[] = [];
	let threadTruncated = false;
	if (author && tweet.conversation_id === tweet.id) {
		const result = await fetchSelfThreadReplies(
			token,
			tweet,
			author,
			() => xApi.wait(),
			THREAD_TIMELINE_PAGES,
		);
		thread = result.replies;
		threadTruncated = result.truncated;
		for (const page of result.pages) lookup.add(page);
	}

	// "Article" means an X-native Article only; long posts (note_tweet) are
	// still just tweets — their full text is already rendered in the body.
	const type = thread.length > 0 ? "Thread" : tweet.article ? "Article" : "Tweet";
	const posted = tweet.created_at ?? snowflakeToIso(tweet.id);
	const url = author ? tweetUrl(author.username, tweet.id) : `https://x.com/i/status/${tweet.id}`;

	return {
		type: "upsert" as const,
		key: tweet.id,
		properties: {
			Tweet: Builder.title(pageTitle(tweet)),
			"Tweet ID": Builder.richText(tweet.id),
			Author: Builder.richText(author ? `${author.name} (@${author.username})` : "Unknown"),
			URL: Builder.url(url),
			Posted: Builder.dateTime(posted),
			Type: Builder.select(type),
		},
		upstreamUpdatedAt: posted,
		icon: author?.profile_image_url
			? Builder.imageIcon(author.profile_image_url)
			: Builder.emojiIcon("🔖"),
		pageContentMarkdown: buildPageMarkdown(tweet, thread, lookup, threadTruncated),
	};
}

// ── The sync: probe-then-expand ─────────────────────────────────────────────
// Bookmarks come back newest-first with no updated_since filter, so overlap
// with already-seen IDs is the cursor. A quiet check reads one post. The
// first cycle (no seen IDs) or a changed X_FULL_RESYNC value pages the whole
// list instead.

type SyncState = {
	tokens?: TokenState;
	me?: XUser;
	seenIds?: string[];
	resyncMarker?: string;
	cycle?: { paginationToken?: string; found: string[]; pages: number; fullLoad: boolean };
	failedCycles?: number;
};

worker.sync("bookmarksSync", {
	database: bookmarks,
	mode: "incremental",
	schedule: "30m",
	execute: async (state: SyncState | undefined) => {
		// Kill switch — returns before any token refresh or billed API call.
		if (process.env.X_PAUSED === "1") {
			console.log("bookmarksSync: paused via X_PAUSED=1");
			return { changes: [], hasMore: false, nextState: state };
		}

		// Refresh first, outside the try: a thrown refresh leaves state untouched.
		const tokens = await ensureFreshTokens(state?.tokens);
		const keep = (extra: Partial<SyncState>): SyncState => ({ ...state, tokens, ...extra });

		try {
			const token = tokens.accessToken;
			let me = state?.me;
			if (!me) {
				await xApi.wait();
				me = await getMe(token);
			}

			const resyncMarker = process.env.X_FULL_RESYNC ?? "";
			const cycle = state?.cycle;
			const fullLoad = cycle
				? cycle.fullLoad
				: !state?.seenIds?.length || resyncMarker !== (state?.resyncMarker ?? "");
			const seen = new Set(fullLoad ? [] : (state?.seenIds ?? []));

			await xApi.wait();
			const page = await getBookmarksPage(
				token,
				me.id,
				cycle ? PAGE_SIZE : 1, // probe with a single post at cycle start
				cycle?.paginationToken,
			);
			const lookup = new Lookup().add(page);

			const fresh: XTweet[] = [];
			let hitSeen = false;
			for (const t of page.data ?? []) {
				if (seen.has(t.id)) {
					hitSeen = true;
					break;
				}
				fresh.push(t);
			}

			const changes = [];
			for (const t of fresh) changes.push(await tweetToUpsert(token, t, lookup));

			const found = [...(cycle?.found ?? []), ...fresh.map((t) => t.id)];
			const pages = (cycle?.pages ?? 0) + 1;
			const nextToken = page.meta?.next_token;
			const maxPages = fullLoad ? MAX_FULL_LOAD_PAGES : MAX_PAGES_PER_CYCLE;
			const underLimit = !fullLoad || found.length < FULL_LOAD_LIMIT;

			if (!hitSeen && nextToken && pages < maxPages && underLimit) {
				return {
					changes,
					hasMore: true,
					nextState: keep({
						me,
						cycle: { paginationToken: nextToken, found, pages, fullLoad },
						failedCycles: 0,
					}),
				};
			}

			if (!hitSeen && nextToken) {
				console.log(`bookmarksSync: stopped after ${pages} pages with more remaining`);
			}
			const seenIds = [...found, ...(fullLoad ? [] : (state?.seenIds ?? []))].slice(0, SEEN_CAP);
			return {
				changes,
				hasMore: false,
				nextState: keep({ me, seenIds, resyncMarker, cycle: undefined, failedCycles: 0 }),
			};
		} catch (err) {
			// The refresh above may have rotated the token family; losing nextState
			// here would strand the new refresh token and kill auth permanently.
			// Log, persist tokens, retry from a fresh probe next cycle.
			const failedCycles = (state?.failedCycles ?? 0) + 1;
			console.error(
				`bookmarksSync: cycle failed (${failedCycles} consecutive): ${err instanceof Error ? err.message : String(err)}`,
			);
			return { changes: [], hasMore: false, nextState: keep({ cycle: undefined, failedCycles }) };
		}
	},
});
