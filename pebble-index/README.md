# pebble-index

Turns voice notes from the [Pebble Index 01](https://repebble.com/index) ring into pages in a Notion database. The ring POSTs each note to this worker's webhook URL; the worker creates a page with the first 70 characters of the transcript as the title and the full transcript as the page body.

## Capabilities

- **`onVoiceNote`** (webhook) — receives a voice-note payload and creates a database page. The ring's payload shape isn't publicly documented, so the handler tries common text field names (`transcript`, `transcription`, `text`, `note`, `content`, `message`, `body`, `summary`, or a raw string body) and logs every delivery in full. If a note is skipped with "no text field found", check `ntn workers runs logs <runId>` and add the actual field name to `TEXT_FIELDS` in `src/index.ts`.

Get the webhook URL with `ntn workers webhooks list` and paste it into the ring's webhook settings in the Pebble app.

## Env vars

- `NOTION_API_TOKEN` — token for a Notion connection ([create one](https://app.notion.com/developers/connections)) that has access to the target database.
- `PEBBLE_DATABASE_ID` — the database to create pages in. The connection above must have access to it. (Can't be `NOTION_`-prefixed: that prefix is reserved by the platform for remote env vars.)
