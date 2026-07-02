# firecrawl

Fetches web page content via [Firecrawl](https://firecrawl.dev). Useful for pulling articles, docs, or blog posts into Notion, or capturing how a page looks.

## Tools

### urlToMarkdown

Fetches a page and returns its main content as clean markdown.

- **Input:** `url` (string)
- **Output:** `markdown`, `title`, `sourceUrl`

```shell
ntn workers exec urlToMarkdown --local -d '{"url": "https://example.com"}'
```

### urlToScreenshot

Takes a full-page screenshot and returns it base64-encoded.

- **Input:** `url` (string)
- **Output:** `screenshot`, `sourceUrl`

## Env vars

| Var | Purpose |
| :-- | :-- |
| `FIRECRAWL_API_KEY` | Firecrawl API key ([get one](https://firecrawl.dev)) |
