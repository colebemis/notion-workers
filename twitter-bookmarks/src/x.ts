/**
 * Minimal X API v2 client for the bookmarks sync.
 *
 * Billing (pay-per-use, 2026): bookmarks are "owned reads" (~$0.001/post);
 * search and timeline reads bill at the standard rate (~$0.005/post).
 * Both bill per post *returned*, not per request, so narrow queries are cheap.
 */

export type XUrlEntity = {
	url: string; // the t.co shortlink as it appears in the tweet text
	expanded_url?: string;
	unwound_url?: string;
	display_url?: string;
	title?: string;
	description?: string;
	media_key?: string;
};

export type XEntities = { urls?: XUrlEntity[] };

/** X-native long-form Article. Shape verified against live payloads:
 * `plain_text` carries the full body with \n between paragraphs;
 * `cover_media`/`media_entities` are media keys resolved via the
 * article.* expansions into includes.media (no text-position offsets). */
export type XArticle = {
	title?: string;
	plain_text?: string;
	preview_text?: string;
	entities?: XEntities;
	cover_media?: string;
	media_entities?: string[];
};

export type XTweet = {
	id: string;
	text: string;
	created_at?: string;
	author_id?: string;
	conversation_id?: string;
	in_reply_to_user_id?: string;
	article?: XArticle;
	note_tweet?: { text: string; entities?: XEntities };
	entities?: XEntities;
	attachments?: { media_keys?: string[] };
	referenced_tweets?: { type: "retweeted" | "quoted" | "replied_to"; id: string }[];
};

export type XMedia = {
	media_key: string;
	type: "photo" | "video" | "animated_gif";
	url?: string; // photos
	preview_image_url?: string; // videos and GIFs
	alt_text?: string;
	variants?: { bit_rate?: number; content_type: string; url: string }[];
};

export type XUser = {
	id: string;
	name: string;
	username: string;
	profile_image_url?: string;
};

export type XTweetPage = {
	data?: XTweet[];
	includes?: { media?: XMedia[]; users?: XUser[]; tweets?: XTweet[] };
	meta?: { next_token?: string; result_count?: number };
};

/** Merged media/user/tweet indexes across one or more API responses. */
export class Lookup {
	media = new Map<string, XMedia>();
	users = new Map<string, XUser>();
	tweets = new Map<string, XTweet>();

	add(page: XTweetPage): this {
		for (const m of page.includes?.media ?? []) this.media.set(m.media_key, m);
		for (const u of page.includes?.users ?? []) this.users.set(u.id, u);
		for (const t of page.includes?.tweets ?? []) this.tweets.set(t.id, t);
		for (const t of page.data ?? []) this.tweets.set(t.id, t);
		return this;
	}
}

const API = "https://api.x.com/2";

// Shared by every tweet-payload request so bookmarks, search, and timeline
// responses all carry media, authors, and quoted tweets.
const TWEET_PARAMS = {
	"tweet.fields":
		"id,text,created_at,author_id,conversation_id,in_reply_to_user_id,article,note_tweet,entities,attachments,referenced_tweets",
	expansions:
		"author_id,attachments.media_keys,referenced_tweets.id,referenced_tweets.id.author_id,article.cover_media,article.media_entities",
	"media.fields": "media_key,type,url,preview_image_url,alt_text,variants",
	"user.fields": "id,name,username,profile_image_url",
};

// X intermittently serves 5xx waves (sometimes regional, lasting hours);
// ride out short blips in-run rather than losing the whole 30m cycle.
const RETRYABLE = new Set([500, 502, 503, 504]);
const RETRY_DELAYS_MS = [4000, 8000];

async function xGet<T>(token: string, path: string, params: Record<string, string>): Promise<T> {
	const qs = new URLSearchParams(params).toString();
	let lastError: Error | undefined;
	for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
		if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
		const res = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`, {
			headers: {
				Authorization: `Bearer ${token}`,
				"User-Agent": "x-bookmarks-notion-worker",
			},
		});
		if (res.ok) return (await res.json()) as T;
		const body = (await res.text()).slice(0, 500);
		lastError = new Error(`X API ${res.status} on ${path}: ${body}`);
		if (!RETRYABLE.has(res.status)) break;
	}
	throw lastError;
}

export async function getMe(token: string): Promise<XUser> {
	const res = await xGet<{ data: XUser }>(token, "/users/me", {});
	return res.data;
}

export async function getBookmarksPage(
	token: string,
	userId: string,
	maxResults: number,
	paginationToken?: string,
): Promise<XTweetPage> {
	return xGet<XTweetPage>(token, `/users/${userId}/bookmarks`, {
		...TWEET_PARAMS,
		max_results: String(maxResults),
		...(paginationToken ? { pagination_token: paginationToken } : {}),
	});
}

// Snowflake IDs encode a millisecond timestamp; used to derive tweet times
// and to bound timeline scans to the hours right after a thread's root.
const TWITTER_EPOCH_MS = 1288834974657n;

export function snowflakeToIso(id: string): string {
	return new Date(Number((BigInt(id) >> 22n) + TWITTER_EPOCH_MS)).toISOString();
}

function msToSnowflake(ms: number): string {
	return ((BigInt(Math.floor(ms)) - TWITTER_EPOCH_MS) << 22n).toString();
}

// Recent search only indexes ~7 days; stay safely inside it.
const RECENT_SEARCH_WINDOW_MS = 6 * 24 * 60 * 60 * 1000;
// For older roots, scan the author's timeline in the window where thread
// replies almost always land.
const THREAD_COMPOSE_WINDOW_MS = 72 * 60 * 60 * 1000;

export type ThreadReplies = {
	replies: XTweet[]; // ascending (thread order), root excluded
	pages: XTweetPage[]; // raw responses, for merging includes into a Lookup
	truncated: boolean;
};

/**
 * Fetch the author's own replies in the conversation rooted at `root`.
 * Recent roots use recent search (bills only actual thread posts); older
 * roots fall back to a snowflake-bounded timeline scan.
 */
export async function fetchSelfThreadReplies(
	token: string,
	root: XTweet,
	author: XUser,
	wait: () => Promise<void>,
	maxTimelinePages: number,
): Promise<ThreadReplies> {
	const rootMs = Number((BigInt(root.id) >> 22n) + TWITTER_EPOCH_MS);
	const pages: XTweetPage[] = [];
	let replies: XTweet[] = [];
	let truncated = false;

	if (Date.now() - rootMs < RECENT_SEARCH_WINDOW_MS) {
		await wait();
		const page = await xGet<XTweetPage>(token, "/tweets/search/recent", {
			...TWEET_PARAMS,
			query: `conversation_id:${root.id} from:${author.username} to:${author.username}`,
			max_results: "100",
		});
		pages.push(page);
		replies = page.data ?? [];
		truncated = Boolean(page.meta?.next_token);
	} else {
		let paginationToken: string | undefined;
		for (let i = 0; i < maxTimelinePages; i++) {
			await wait();
			const page = await xGet<XTweetPage>(token, `/users/${author.id}/tweets`, {
				...TWEET_PARAMS,
				since_id: root.id,
				until_id: msToSnowflake(rootMs + THREAD_COMPOSE_WINDOW_MS),
				max_results: "100",
				exclude: "retweets",
				...(paginationToken ? { pagination_token: paginationToken } : {}),
			});
			pages.push(page);
			for (const t of page.data ?? []) {
				if (t.conversation_id === root.id && t.in_reply_to_user_id === author.id) {
					replies.push(t);
				}
			}
			paginationToken = page.meta?.next_token;
			if (!paginationToken) break;
		}
		truncated = Boolean(paginationToken);
	}

	replies = replies.filter((t) => t.id !== root.id);
	replies.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
	return { replies, pages, truncated };
}
