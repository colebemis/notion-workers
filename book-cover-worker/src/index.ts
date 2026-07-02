import { Worker } from "@notionhq/workers";
import { j } from "@notionhq/workers/schema-builder";

const worker = new Worker();

type GetBookCoverInput = {
  isbn: string;
  size: "S" | "M" | "L" | null;
};

type GetBookCoverOutput = {
  url: string;
  isbn: string;
  size: string;
};

worker.tool<GetBookCoverInput, GetBookCoverOutput>("getBookCover", {
  title: "Get Book Cover",
  description:
    "Get the cover image URL for a book by its ISBN from OpenLibrary.",
  schema: j.object({
    isbn: j.string().describe("The ISBN of the book"),
    size: j
      .enum("S", "M", "L")
      .describe(
        "Cover image size: S (small), M (medium), L (large). Defaults to M."
      )
      .nullable(),
  }),
  execute: async (input) => {
    const size = input.size ?? "M";
    const url = `https://covers.openlibrary.org/b/isbn/${input.isbn}-${size}.jpg`;

    const response = await fetch(`${url}?default=false`, {
      method: "HEAD",
      redirect: "follow",
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`No cover found for ISBN ${input.isbn}`);
      }
      throw new Error(
        `Failed to fetch cover for ISBN ${input.isbn}: HTTP ${response.status}`
      );
    }

    return { url, isbn: input.isbn, size };
  },
});

export default worker;
