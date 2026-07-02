import { Worker } from "@notionhq/workers";

const worker = new Worker();
export default worker;

type UrlInput = { url: string };
type MarkdownOutput = { markdown: string; title: string; sourceUrl: string };
type ScreenshotOutput = { screenshot: string; sourceUrl: string };

async function firecrawlScrape(url: string, formats: (string | Record<string, unknown>)[], options?: Record<string, unknown>) {
	const apiKey = process.env.FIRECRAWL_API_KEY;
	if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set");

	const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({ url, formats, ...options }),
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Firecrawl API error (${response.status}): ${text}`);
	}

	const result = await response.json();
	if (!result.success) throw new Error("Firecrawl scrape failed");

	return result.data;
}

const urlSchema = {
	type: "object" as const,
	properties: {
		url: {
			type: "string" as const,
			description: "The URL of the web page.",
		},
	},
	required: ["url"] as const,
	additionalProperties: false as const,
};

worker.tool<UrlInput, MarkdownOutput>("urlToMarkdown", {
	title: "URL to Markdown",
	description: "Fetches a web page and returns its content as clean markdown.",
	schema: urlSchema,
	outputSchema: {
		type: "object",
		properties: {
			markdown: { type: "string" },
			title: { type: "string" },
			sourceUrl: { type: "string" },
		},
		required: ["markdown", "title", "sourceUrl"],
		additionalProperties: false,
	},
	execute: async ({ url }) => {
		const data = await firecrawlScrape(url, ["markdown"], { onlyMainContent: true });
		return {
			markdown: data.markdown ?? "",
			title: Array.isArray(data.metadata?.title)
				? data.metadata.title[0]
				: (data.metadata?.title ?? ""),
			sourceUrl: data.metadata?.url ?? url,
		};
	},
});

worker.tool<UrlInput, ScreenshotOutput>("urlToScreenshot", {
	title: "URL to Screenshot",
	description: "Takes a screenshot of a web page and returns it as a base64-encoded image.",
	schema: urlSchema,
	outputSchema: {
		type: "object",
		properties: {
			screenshot: { type: "string" },
			sourceUrl: { type: "string" },
		},
		required: ["screenshot", "sourceUrl"],
		additionalProperties: false,
	},
	execute: async ({ url }) => {
		const data = await firecrawlScrape(url, [{ type: "screenshot", fullPage: true }]);
		return {
			screenshot: data.screenshot ?? "",
			sourceUrl: data.metadata?.url ?? url,
		};
	},
});
