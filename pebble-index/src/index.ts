import { Worker } from "@notionhq/workers";
import type { Client } from "@notionhq/client";

const worker = new Worker();
export default worker;

const TITLE_MAX_LENGTH = 70;
// Notion caps a single rich_text content string at 2000 characters.
const RICH_TEXT_MAX_LENGTH = 2000;

// Field names the ring's payload might use for the note text, in priority
// order. The payload shape isn't publicly documented, so every delivery is
// logged in full — check `ntn workers runs logs` and extend this list if a
// note comes through with an unrecognized shape.
const TEXT_FIELDS = [
	"transcript",
	"transcription",
	"text",
	"note",
	"content",
	"message",
	"body",
	"summary",
];

function extractText(body: unknown): string | undefined {
	if (typeof body === "string" && body.trim()) return body;
	if (typeof body !== "object" || body === null) return undefined;
	const record = body as Record<string, unknown>;
	for (const field of TEXT_FIELDS) {
		const value = record[field];
		if (typeof value === "string" && value.trim()) return value;
	}
	return undefined;
}

function makeTitle(text: string): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	return collapsed.length <= TITLE_MAX_LENGTH
		? collapsed
		: `${collapsed.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

function makeParagraphBlocks(text: string) {
	const chunks: string[] = [];
	for (let i = 0; i < text.length; i += RICH_TEXT_MAX_LENGTH) {
		chunks.push(text.slice(i, i + RICH_TEXT_MAX_LENGTH));
	}
	return chunks.map((chunk) => ({
		object: "block" as const,
		type: "paragraph" as const,
		paragraph: {
			rich_text: [{ type: "text" as const, text: { content: chunk } }],
		},
	}));
}

// Pages are created under the database's data source (Notion API 2025-09-03).
// Resolved once per worker instance.
let dataSourceId: string | undefined;

async function getDataSourceId(notion: Client): Promise<string> {
	if (dataSourceId) return dataSourceId;
	const databaseId = process.env.PEBBLE_DATABASE_ID;
	if (!databaseId) throw new Error("PEBBLE_DATABASE_ID not set");
	const database = await notion.databases.retrieve({
		database_id: databaseId,
	});
	const dataSources = "data_sources" in database ? database.data_sources : [];
	const first = dataSources[0];
	if (!first) {
		throw new Error(`Database ${databaseId} has no data sources`);
	}
	dataSourceId = first.id;
	return dataSourceId;
}

worker.webhook("onVoiceNote", {
	title: "Pebble Index Voice Note",
	description:
		"Receives a voice note from the Pebble Index 01 ring and creates a page in the configured database.",
	execute: async (events, { notion }) => {
		for (const event of events) {
			console.log(`Delivery ${event.deliveryId}:`, JSON.stringify(event.body));

			const text = extractText(event.body);
			if (!text) {
				console.warn(
					`Delivery ${event.deliveryId}: no text field found in payload, skipping`,
				);
				continue;
			}

			const page = await notion.pages.create({
				parent: {
					type: "data_source_id",
					data_source_id: await getDataSourceId(notion),
				},
				properties: {
					title: {
						title: [{ type: "text", text: { content: makeTitle(text) } }],
					},
				},
				children: makeParagraphBlocks(text),
			});
			console.log(`Delivery ${event.deliveryId}: created page ${page.id}`);
		}
	},
});
