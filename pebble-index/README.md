# pebble-index

Turns voice notes from the [Pebble Index 01](https://repebble.com/index) ring into pages in a Notion database. The ring POSTs each note to this worker's webhook URL; the worker creates a page with the first 70 characters of the transcript as the title and the full transcript as the page body.

## Capabilities

- **`onVoiceNote`** (webhook) — receives a voice-note delivery and creates a database page. The Pebble app posts `multipart/form-data` with fields `transcription`, `recordedAt`, and `client`; the platform doesn't parse multipart bodies, so the handler parses `rawBody` itself. As a fallback it also accepts plain JSON with any common text field name (`transcript`, `transcription`, `text`, `note`, etc. — see `TEXT_FIELDS` in `src/index.ts`) or a raw string body. If a delivery is skipped with "no text field found", the full request is logged — check `ntn workers runs logs <runId>` and extend the parsing from there.

Note: the ring's two triggers (single vs. double click-and-hold) send byte-identical payloads — per-trigger behavior would require a second webhook capability so each trigger gets its own URL.

Get the webhook URL with `ntn workers webhooks list` and paste it into the ring's webhook settings in the Pebble app.

## Env vars

- `NOTION_API_TOKEN` — token for a Notion connection ([create one](https://app.notion.com/developers/connections)) that has access to the target database.
- `PEBBLE_DATABASE_ID` — the database to create pages in. The connection above must have access to it. (Can't be `NOTION_`-prefixed: that prefix is reserved by the platform for remote env vars.)
