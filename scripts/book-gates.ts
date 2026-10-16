/**
 * The book's CI gates (see book/README.md). Every check is mechanical and
 * every failure names its file. Run: bun run scripts/book-gates.ts
 *
 * Gates:
 *  1. Twelve chapters exist, each at most 250 lines.
 *  2. Reading order: each chapter has a Claim and names the next chapter
 *     by its real title.
 *  3. Every chapter's claim names an evidence file (and a string that
 *     must appear in it): <!-- gate:claim-test path[::grep] -->
 *  4. Every `Try it` block equals its file under book/tryit/, runs, and
 *     prints exactly the chapter's expected output.
 *  5. The rule registry (book/rules.json) resolves totally: src symbols,
 *     vendored kernel symbols, vendored thesis anchors, forgery artifacts
 *     and their flags in tests/forgery.test.ts and src/kernel/weaken.ts.
 *  6. Rule citations: every [R: ID] in book/ and src/ exists in the
 *     registry; every registry rule is cited by at least one chapter.
 *  7. No forward references: each term in book/terms.json first occurs in
 *     or after its defining chapter.
 *
 * Reference scanning is wrap-aware: chapters are scanned as joined text,
 * so a citation broken across a line wrap is still found (and a stray
 * half-citation still fails). Run scripts/fetch-vendor-sources.sh first
 * on a fresh clone; vendor/ is not committed.
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

let failures = 0;
function fail(msg: string): void {
  failures++;
  console.error(`GATE FAIL: ${msg}`);
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const chapterPaths = Array.from({ length: 12 }, (_, i) => `book/ch${String(i + 1).padStart(2, "0")}.md`);

interface Chapter {
  path: string;
  num: number;
  text: string;
  joined: string; // wrap-aware: newlines become spaces
  title: string;
}

const chapters: Chapter[] = [];
for (const [i, path] of chapterPaths.entries()) {
  if (!existsSync(path)) {
    fail(`${path} does not exist`);
    continue;
  }
  const text = read(path);
  const lines = text.split("\n");
  if (lines.length > 251) fail(`${path} has ${lines.length - 1} lines (cap: 250)`);
  const h1 = /^# Chapter (\d+) — (.+)$/.exec(lines[0] ?? "");
  if (h1 === null || Number(h1[1]) !== i + 1) {
    fail(`${path} first line must be "# Chapter ${i + 1} — <title>"`);
    continue;
  }
  // Joined text is wrap-aware: line breaks and quote-block markers
  // disappear, so a reference split across wrapped lines is still seen.
  chapters.push({ path, num: i + 1, text, joined: text.replace(/\n>?\s*/g, " "), title: h1[2] ?? "" });
}

// Gate 2: claim present, next-chapter reference matches the real title.
for (const ch of chapters) {
  if (!ch.text.includes("**Claim.**")) fail(`${ch.path} has no **Claim.**`);
  if (ch.num < 12) {
    const next = chapters.find((c) => c.num === ch.num + 1);
    if (next !== undefined) {
      const expected = `Chapter ${next.num} — ${next.title}`;
      if (!ch.joined.includes(expected)) fail(`${ch.path} must name "${expected}" as next`);
    }
  }
  // Every "Chapter N" mention must point at a chapter that exists.
  for (const m of ch.joined.matchAll(/[Cc]hapter (\d+)/g)) {
    const n = Number(m[1]);
    if (n < 1 || n > 12) fail(`${ch.path} references chapter ${n}, which does not exist`);
  }
}

// Gate 3: the claim's evidence resolves.
for (const ch of chapters) {
  const m = /<!-- gate:claim-test ([^ ]+?)(?:::(.+?))? -->/.exec(ch.text);
  if (m === null) {
    fail(`${ch.path} has no gate:claim-test comment`);
    continue;
  }
  const [, path, grep] = m;
  if (path === undefined || !existsSync(path)) {
    fail(`${ch.path} claim-test file missing: ${path ?? "?"}`);
    continue;
  }
  if (grep !== undefined && !read(path).includes(grep)) {
    fail(`${ch.path} claim-test: "${grep}" not found in ${path}`);
  }
}

// Gate 4: Try it blocks match their files, run, and print what they say.
for (const ch of chapters) {
  const m = /<!-- gate:tryit ([^ ]+) -->/.exec(ch.text);
  if (m === null) {
    fail(`${ch.path} has no gate:tryit comment`);
    continue;
  }
  const tryitPath = m[1] ?? "";
  if (!existsSync(tryitPath)) {
    fail(`${ch.path} tryit file missing: ${tryitPath}`);
    continue;
  }
  const fence = /## Try it\n\n```ts\n([\s\S]*?)\n```/.exec(ch.text);
  if (fence === null) {
    fail(`${ch.path} has no \`\`\`ts fence under ## Try it`);
    continue;
  }
  const fileBody = read(tryitPath).replace(/\n$/, "");
  if ((fence[1] ?? "") !== fileBody) {
    fail(`${ch.path} Try-it fence differs from ${tryitPath}`);
    continue;
  }
  const expected = /Expected output:\n\n```text\n([\s\S]*?)\n```/.exec(ch.text);
  if (expected === null) {
    fail(`${ch.path} has no Expected output block`);
    continue;
  }
  const run = spawnSync("bun", [tryitPath], { encoding: "utf8" });
  if (run.status !== 0) {
    fail(`${tryitPath} exited ${run.status}: ${run.stderr.slice(0, 200)}`);
    continue;
  }
  if (run.stdout.replace(/\n$/, "") !== (expected[1] ?? "")) {
    fail(`${tryitPath} output differs from ${ch.path} Expected output`);
  }
}

// Gate 5: the registry resolves totally.
interface Cite {
  file: string;
  symbol?: string;
  anchor?: string;
}
interface Rule {
  id: string;
  statement: string;
  thesis: Cite | null;
  kernel: Cite;
  src: Cite;
  forgery?: { flag: string; artifact: string };
}
const registry = (JSON.parse(read("book/rules.json")) as { rules: Rule[] }).rules;
const ruleIds = new Set(registry.map((r) => r.id));
if (registry.length !== ruleIds.size) fail("book/rules.json has duplicate rule ids");

function checkCite(id: string, what: string, cite: Cite): void {
  if (!existsSync(cite.file)) {
    fail(`${id}: ${what} file missing: ${cite.file} (run scripts/fetch-vendor-sources.sh?)`);
    return;
  }
  const needle = cite.symbol ?? cite.anchor ?? "";
  if (needle !== "" && !read(cite.file).includes(needle)) {
    fail(`${id}: "${needle}" not found in ${cite.file}`);
  }
}

const weakenSrc = read("src/kernel/weaken.ts");
const forgeryTests = read("tests/forgery.test.ts");
for (const r of registry) {
  checkCite(r.id, "src", r.src);
  checkCite(r.id, "kernel", r.kernel);
  if (r.thesis !== null) checkCite(r.id, "thesis", r.thesis);
  if (r.forgery !== undefined) {
    if (!existsSync(r.forgery.artifact)) fail(`${r.id}: forgery artifact missing: ${r.forgery.artifact}`);
    if (!weakenSrc.includes(`"${r.forgery.flag}"`)) fail(`${r.id}: flag ${r.forgery.flag} not in src/kernel/weaken.ts`);
    if (!forgeryTests.includes(r.forgery.flag)) fail(`${r.id}: flag ${r.forgery.flag} not tested in tests/forgery.test.ts`);
  }
}

// Gate 6: citations in both directions.
const citedInChapters = new Set<string>();
for (const ch of chapters) {
  for (const m of ch.joined.matchAll(/\[R: ([A-Z0-9-]+)\]/g)) {
    const id = m[1] ?? "";
    citedInChapters.add(id);
    if (!ruleIds.has(id)) fail(`${ch.path} cites unknown rule [R: ${id}]`);
  }
}
const srcFiles = ["src/checker.ts", "src/kernel/tc.ts", "src/kernel/inductive.ts"];
for (const f of srcFiles) {
  for (const m of read(f).matchAll(/\[R: ([A-Z0-9-]+)\]/g)) {
    if (!ruleIds.has(m[1] ?? "")) fail(`${f} cites unknown rule [R: ${m[1] ?? ""}]`);
  }
}
for (const id of ruleIds) {
  if (!citedInChapters.has(id)) fail(`rule ${id} is cited by no chapter`);
}

// Gate 7: no forward references.
const terms = (JSON.parse(read("book/terms.json")) as { terms: Record<string, number> }).terms;
for (const [term, definedIn] of Object.entries(terms)) {
  const re = new RegExp(`(?<![A-Za-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
  for (const ch of chapters) {
    if (re.test(ch.joined)) {
      if (ch.num < definedIn) {
        fail(`term "${term}" (defined in chapter ${definedIn}) first appears in ${ch.path}`);
      }
      break;
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} gate failure(s).`);
  process.exit(1);
}
console.log(`book gates: all green (${chapters.length} chapters, ${registry.length} rules, ${Object.keys(terms).length} terms)`);
