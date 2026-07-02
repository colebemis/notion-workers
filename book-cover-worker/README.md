# book-cover-worker

Looks up book cover images from [OpenLibrary Covers](https://openlibrary.org/dev/docs/api/covers).

## Tools

### getBookCover

Returns the cover image URL for a book by ISBN.

- **Input:** `isbn` (string), `size` (`"S"` | `"M"` | `"L"` | `null`, defaults to `M`)
- **Output:** `url`, `isbn`, `size`
- Throws if OpenLibrary has no cover for the ISBN.

```shell
ntn workers exec getBookCover --local -d '{"isbn": "9780140328721", "size": null}'
```

## Env vars

None.
