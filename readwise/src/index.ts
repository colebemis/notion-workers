import { Worker } from "@notionhq/workers";
import { j } from "@notionhq/workers/schema-builder";

const worker = new Worker();
export default worker;

type SaveLinkInput = {
	url: string;
	title?: string | null;
	tags?: string[] | null;
	notes?: string | null;
	location?: string | null;
};

type SaveLinkOutput = {
	id: string;
	readerUrl: string;
	alreadyExisted: boolean;
};

worker.tool<SaveLinkInput, SaveLinkOutput>("saveLink", {
	title: "Save Link to Readwise",
	description:
		"Saves a URL (article, video, PDF, tweet, etc.) to Readwise Reader to read or watch later. Returns the Reader document ID and link.",
	schema: j.object({
		url: j.string().describe("The URL to save."),
		title: j.string().describe("Optional title override; Reader infers one from the page if omitted.").nullable(),
		tags: j.array(j.string()).describe("Optional tags to apply to the saved document.").nullable(),
		notes: j.string().describe("Optional note to attach to the saved document.").nullable(),
		location: j
			.string()
			.describe('Where to file it in Reader: "new", "later", or "archive". Defaults to "new".')
			.nullable(),
	}),
	outputSchema: j.object({
		id: j.string(),
		readerUrl: j.string(),
		alreadyExisted: j.boolean(),
	}),
	execute: async ({ url, title, tags, notes, location }) => {
		const token = process.env.READWISE_TOKEN;
		if (!token) throw new Error("READWISE_TOKEN not set");

		const response = await fetch("https://readwise.io/api/v3/save/", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Token ${token}`,
			},
			body: JSON.stringify({
				url,
				saved_using: "notion-worker",
				...(title ? { title } : {}),
				...(tags?.length ? { tags } : {}),
				...(notes ? { notes } : {}),
				...(location ? { location } : {}),
			}),
		});

		if (!response.ok) {
			const text = await response.text();
			throw new Error(`Readwise API error (${response.status}): ${text}`);
		}

		const result = (await response.json()) as { id: string; url: string };
		return {
			id: result.id,
			readerUrl: result.url,
			alreadyExisted: response.status === 200,
		};
	},
});
