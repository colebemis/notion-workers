# readwise

Saves links to [Readwise Reader](https://read.readwise.io) to read or watch later.

## Tools

### saveLink

Saves a URL to Readwise Reader via `POST /api/v3/save/`.

- **Input:** `url` (string, required); optional `title`, `tags` (string[]), `notes`, `location` (`new` | `later` | `archive`, defaults to `new`)
- **Output:** `id`, `readerUrl`, `alreadyExisted` (true if the URL was already saved)

```shell
ntn workers exec saveLink --local -d '{"url": "https://example.com/article"}'
```

## Env vars

| Var | Purpose |
| :-- | :-- |
| `READWISE_TOKEN` | Readwise access token ([get one](https://readwise.io/access_token)) |
