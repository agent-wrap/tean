/**
 * mdBook preprocessor: rewrite links that leave book/ to the repository.
 *
 * The chapters and the generated rules appendix link to ../docs, ../src
 * and ../tests by relative path, which is right for a clone and for
 * github.com but cannot be served by the built site. At build time this
 * turns `](../x)` into `](<git-repository-url>/blob/main/x)` and leaves
 * the source untouched. Configured in book.toml as
 * [preprocessor.repo-links].
 *
 * Protocol: `supports <renderer>` exits 0; otherwise read [context, book]
 * as JSON on stdin and write the transformed book as JSON on stdout.
 * mdBook 0.4 named the item list `sections`; 0.5 names it `items`.
 */
import { readFileSync } from "node:fs";

interface Chapter {
  content: string;
  sub_items?: BookItem[];
}
// mdBook 0.5 sends a separator as the bare string "Separator".
type BookItem = { Chapter: Chapter } | { PartTitle: string } | string;
interface Book {
  sections?: BookItem[];
  items?: BookItem[];
}
interface Context {
  config: { output?: { html?: { "git-repository-url"?: string } } };
}

if (process.argv[2] === "supports") process.exit(0);

const [context, book] = JSON.parse(readFileSync(0, "utf8")) as [Context, Book];
const repo = context.config.output?.html?.["git-repository-url"] ?? "";
if (repo === "") throw new Error("mdbook-links: output.html.git-repository-url is not set in book.toml");
const base = `${repo.replace(/\/$/, "")}/blob/main/`;

const items = book.items ?? book.sections;
if (items === undefined) throw new Error(`mdbook-links: no items in book (keys: ${Object.keys(book).join(", ")})`);

let rewritten = 0;
const rewrite = (list: BookItem[]): void => {
  for (const item of list) {
    if (typeof item !== "object" || !("Chapter" in item)) continue;
    const before = item.Chapter.content;
    item.Chapter.content = before.replaceAll("](../", `](${base}`);
    rewritten += before.split("](../").length - 1;
    rewrite(item.Chapter.sub_items ?? []);
  }
};
rewrite(items);
process.stderr.write(`mdbook-links: ${rewritten} link(s) rewritten to ${base}\n`);
process.stdout.write(JSON.stringify(book));
