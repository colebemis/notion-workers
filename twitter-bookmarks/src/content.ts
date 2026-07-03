/**
 * Turns tweets into Notion page content (markdown) and page titles.
 *
 * Layout per page: tweet text with t.co links expanded, quoted posts as
 * blockquotes, images inline, videos as preview image + mp4 link, external
 * article links as titled links. Thread posts are separated by `---` rules.
 */

import { Lookup, XMedia, XTweet, XUrlEntity } from "./x";

export function tweetUrl(username: string, id: string): string {
	return `https://x.com/${username}/status/${id}`;
}

function allUrlEntities(tweet: XTweet): XUrlEntity[] {
	return [...(tweet.entities?.urls ?? []), ...(tweet.note_tweet?.entities?.urls ?? [])];
}

function expandUrls(text: string, urls: XUrlEntity[]): string {
	// X HTML-escapes &, <, > in all post text. &amp; goes last so a literal
	// "&lt;" in a post doesn't double-unescape.
	let out = text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
	for (const u of urls) {
		const expanded = u.expanded_url;
		if (!expanded) continue;
		const isMediaLink = Boolean(u.media_key) || /\/(photo|video)\/\d+$/.test(expanded);
		out = out.split(u.url).join(isMediaLink ? "" : expanded);
	}
	return out.trim();
}

/** Tweet text with t.co links expanded and attached-media links removed. */
export function displayText(tweet: XTweet): string {
	return expandUrls(tweet.note_tweet?.text ?? tweet.text, allUrlEntities(tweet));
}

/** Full body of an X-native Article. `plain_text` separates paragraphs with
 * single newlines; double them so each becomes its own Notion block. */
function articleBody(tweet: XTweet): string {
	const article = tweet.article;
	const raw = article?.plain_text ?? article?.preview_text ?? "";
	if (!raw) return "";
	const expanded = expandUrls(raw, article?.entities?.urls ?? []);
	return expanded
		.split("\n")
		.map((p) => p.trim())
		.filter((p) => p.length > 0)
		.join("\n\n");
}

/** Page title. Articles use their own title verbatim; everything else gets
 * the first line of the post trimmed to 70 chars, falling back to a linked
 * page's title. No author prefix — that's the icon and the Author property. */
export function pageTitle(tweet: XTweet): string {
	const articleTitle = tweet.article?.title?.trim();
	if (articleTitle) return articleTitle;
	const firstLine =
		displayText(tweet)
			.replace(/https?:\/\/\S+/g, "") // URLs are noise in a page title
			.split("\n")
			.map((l) => l.trim())
			.find((l) => l.length > 0) ?? "";
	const linkTitle = allUrlEntities(tweet).find((u) => u.title && !u.media_key)?.title ?? "";
	const line = firstLine || linkTitle;
	return (line.length > 70 ? `${line.slice(0, 69)}…` : line) || "(media only)";
}

function escapeMdBracket(text: string): string {
	return text.replace(/[[\]\n]+/g, " ").trim();
}

function mediaItemMarkdown(m: XMedia): string[] {
	// Alt text becomes a visible caption in Notion: keep it when the author
	// actually wrote one, never fill with generic labels ("Image", "video").
	const alt = escapeMdBracket(m.alt_text ?? "");
	if (m.type === "photo" && m.url) return [`![${alt}](${m.url})`];
	if (m.preview_image_url) {
		const label = m.type === "animated_gif" ? "GIF" : "video";
		const mp4 = (m.variants ?? [])
			.filter((v) => v.content_type === "video/mp4")
			.sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0))[0];
		const out = [`![${alt}](${m.preview_image_url})`];
		if (mp4) out.push(`[▶︎ Watch ${label}](${mp4.url})`);
		return out;
	}
	return [];
}

function mediaMarkdown(tweet: XTweet, lookup: Lookup): string[] {
	const out: string[] = [];
	for (const key of tweet.attachments?.media_keys ?? []) {
		const m = lookup.media.get(key);
		if (m) out.push(...mediaItemMarkdown(m));
	}
	return out;
}

/** Article images: cover first, then embedded media. The API gives no
 * text-position offsets, so they render after the body rather than inline. */
function articleMediaMarkdown(tweet: XTweet, lookup: Lookup): { cover: string[]; rest: string[] } {
	const article = tweet.article;
	if (!article) return { cover: [], rest: [] };
	const coverKey = article.cover_media;
	const cover = coverKey && lookup.media.get(coverKey);
	const rest: string[] = [];
	for (const key of article.media_entities ?? []) {
		if (key === coverKey) continue;
		const m = lookup.media.get(key);
		if (m) rest.push(...mediaItemMarkdown(m));
	}
	return { cover: cover ? mediaItemMarkdown(cover) : [], rest };
}

function quotedBlock(tweet: XTweet, lookup: Lookup): string | undefined {
	const ref = tweet.referenced_tweets?.find((r) => r.type === "quoted");
	const quoted = ref && lookup.tweets.get(ref.id);
	if (!quoted) return undefined;
	const author = quoted.author_id ? lookup.users.get(quoted.author_id) : undefined;
	// Notion's markdown dialect nests child blocks as 4-space-indented lines
	// under the parent, so a `>` header line with indented paragraphs beneath
	// should become one quote block containing paragraph children. (Plain
	// multi-line `>` quoting shatters into one block per line; <br> breaks
	// quote parsing; U+2028 is stripped \u2014 all verified empirically.)
	const paras = displayText(quoted)
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
	const header = author
		? `**${author.name}** (@${author.username}) \u2014 [view](${tweetUrl(author.username, quoted.id)})`
		: "Quoted post:";
	return [`> ${header}`, ...paras.map((p) => `    ${p}`)].join("\n");
}

function tweetSection(tweet: XTweet, lookup: Lookup): string {
	const parts: string[] = [];
	const text = displayText(tweet);

	// No article-title heading — the page title carries it.
	const articleMedia = articleMediaMarkdown(tweet, lookup);
	parts.push(...articleMedia.cover);
	const body = articleBody(tweet);
	if (body) parts.push(body);
	parts.push(...articleMedia.rest);

	// An Article post's own text is usually just the share link — skip it when
	// URL expansion leaves nothing else behind.
	const textIsOnlyLinks = text.replace(/https?:\/\/\S+/g, "").trim().length === 0;
	if (text && !(tweet.article && textIsOnlyLinks)) parts.push(text);

	const quote = quotedBlock(tweet, lookup);
	if (quote) parts.push(quote);
	parts.push(...mediaMarkdown(tweet, lookup));
	return parts.join("\n\n");
}

export function buildPageMarkdown(
	root: XTweet,
	thread: XTweet[],
	lookup: Lookup,
	threadTruncated: boolean,
): string {
	const sections = [root, ...thread]
		.map((t) => tweetSection(t, lookup))
		.filter((s) => s.length > 0);
	if (threadTruncated) {
		sections.push("*Thread may be incomplete — it was too old or too long to fetch fully.*");
	}
	return sections.join("\n\n---\n\n");
}
