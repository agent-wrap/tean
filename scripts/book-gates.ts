/**
 * The book's CI gates (see book/README.md). Every check is mechanical and
 * every failure names its file. Run: bun run scripts/book-gates.ts
 *
 * Gates:
 *  1. Fifteen chapters exist, each at most 250 lines.
 *  2. Exactly one Claim per chapter, each chapter ends with a link to the
 *     next by its real title and filename, and every "Chapter N" mention
 *     points at a chapter that exists.
 *  3. Every chapter's claim names an evidence file (and a string that
 *     must appear in it): <!-- gate:claim-test path[::grep] -->
 *  4. Every `Try it` block equals its file under book/tryit/, runs, and
 *     prints exactly the chapter's expected output.
 *  5. The rule registry (book/rules.json) resolves totally: src symbols,
 *     vendored kernel symbols, vendored thesis anchors, forgery artifacts
 *     and their flags in tests/forgery.test.ts and src/kernel/weaken.ts,
 *     and — for a rule marked `divergence` — a heading naming it in the
 *     divergences document.
 *  6. Rule citations: every [R: ID] in book/ and src/ exists in the
 *     registry; every registry rule is cited by at least one chapter.
 *  7. No forward references: each term in book/terms.json first occurs in
 *     or after its defining chapter.
 *  8. The appendix: book/RULES.md equals a fresh generation from the
 *     registry, every chapter citation is a link whose target is its own
 *     RULES.md anchor, and no citation is left unlinked.
 *  9. The notation card: book/NOTATION.md equals a fresh generation from
 *     book/terms.json.
 *
 * Reference scanning is wrap-aware: chapters are scanned as joined text,
 * so a citation broken across a line wrap is still found (and a stray
 * half-citation still fails).
 *
 * Gate 5 needs the vendored sources, which are not committed. On a fresh
 * clone this script says so in one line and stops, rather than reporting
 * every unresolvable citation as a separate failure.
 */
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename } from "node:path";
import { generateRulesAppendix, loadRegistry } from "./gen-rules-appendix.ts";
import { generateNotationCard, loadTerms } from "./gen-notation-card.ts";

// A fresh clone has no vendor/. Without it every registry citation fails
// at once, which reads like a broken project rather than a missing step.
const VENDOR_WITNESSES = ["vendor/lean4-type_checker.cpp", "vendor/lean-type-theory"];
const missingVendor = VENDOR_WITNESSES.filter((p) => !existsSync(p));
if (missingVendor.length > 0) {
  console.error(`vendor sources absent (${missingVendor[0] ?? ""}); run: scripts/fetch-vendor-sources.sh`);
  process.exit(1);
}

let failures = 0;
function fail(msg: string): void {
  failures++;
  console.error(`GATE FAIL: ${msg}`);
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const CHAPTER_COUNT = 15;
const chapterPaths = Array.from({ length: CHAPTER_COUNT }, (_, i) => `book/ch${String(i + 1).padStart(2, "0")}.md`);

interface Chapter {
  path: string;
  num: number;
  text: string;
  joined: string; // wrap-aware: newlines become spaces
  prose: string; // wrap-aware, with fenced blocks removed
  title: string;
}

/** The cap is on PROSE, which is what a reader has to hold in their head.
 *  An exercise is held to its own standard — it must typecheck, run, and
 *  print what the chapter says — so counting its lines here would only
 *  push authors toward smaller exercises. */
const PROSE_CAP = 250;
const stripFences = (s: string): string => s.replace(/```[\s\S]*?```/g, "");

const chapters: Chapter[] = [];
for (const [i, path] of chapterPaths.entries()) {
  if (!existsSync(path)) {
    fail(`${path} does not exist`);
    continue;
  }
  const text = read(path);
  const lines = text.split("\n");
  const proseLines = stripFences(text).split("\n").length - 1;
  if (proseLines > PROSE_CAP) fail(`${path} has ${proseLines} prose lines (cap: ${PROSE_CAP})`);
  const h1 = /^# Chapter (\d+) — (.+)$/.exec(lines[0] ?? "");
  if (h1 === null || Number(h1[1]) !== i + 1) {
    fail(`${path} first line must be "# Chapter ${i + 1} — <title>"`);
    continue;
  }
  // Joined text is wrap-aware: line breaks and quote-block markers
  // disappear, so a reference split across wrapped lines is still seen.
  const joined = text.replace(/\n>?\s*/g, " ");
  chapters.push({
    path,
    num: i + 1,
    text,
    joined,
    prose: stripFences(text).replace(/\n>?\s*/g, " "),
    title: h1[2] ?? "",
  });
}

// Gate 2: one claim, a resolving next-chapter link, and no dangling
// cross-reference. The link is checked as a link, not as prose: a chapter
// that renames itself breaks the previous chapter's footer, and CI says so.
for (const ch of chapters) {
  const claims = (ch.text.match(/\*\*Claim\.\*\*/g) ?? []).length;
  if (claims !== 1) fail(`${ch.path} has ${claims} **Claim.** blocks (must be exactly 1)`);
  if (ch.num < CHAPTER_COUNT) {
    const next = chapters.find((c) => c.num === ch.num + 1);
    if (next !== undefined) {
      const expected = `[Chapter ${next.num} — ${next.title}](${basename(next.path)})`;
      if (!ch.joined.includes(expected)) fail(`${ch.path} must end with the link ${expected}`);
    }
  }
  // Every "Chapter N" mention must point at a chapter that exists.
  for (const m of ch.joined.matchAll(/[Cc]hapter (\d+)/g)) {
    const n = Number(m[1]);
    if (n < 1 || n > CHAPTER_COUNT) fail(`${ch.path} references chapter ${n}, which does not exist`);
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
  divergence?: { summary: string; doc: string };
}
const registry = (JSON.parse(read("book/rules.json")) as { rules: Rule[] }).rules;
const ruleIds = new Set(registry.map((r) => r.id));
if (registry.length !== ruleIds.size) fail("book/rules.json has duplicate rule ids");

// A symbol citation must name the file that DEFINES the symbol, not one
// that merely calls it, and must match the whole identifier. Three real
// errors hid behind a plain substring test: a symbol that existed only
// inside a longer name (nat_lit_ext in is_nat_lit_ext), and two defined
// in a different vendored file than the one cited. The match therefore
// requires the symbol to open a definition: start of line, optional
// return type / qualifiers, then the symbol and its parameter list.
// The symbol must open a definition: a line start, an optional return
// type or qualifier chain (which may not contain "=", "(" or ";", so a
// call is not mistaken for a definition), a word boundary, then the
// symbol and its parameter list.
const STATEMENT_KEYWORDS = "return|if|while|for|else|throw|new|case|switch|do|delete";
function definesSymbol(text: string, symbol: string): boolean {
  const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?:^|\\n)[ \\t]*(?!(?:${STATEMENT_KEYWORDS})\\b)(?:[A-Za-z_][\\w:<>&*,\\s]*(?<![\\w]))?${esc}\\s*\\(`,
  );
  return re.test(text);
}

function checkCite(id: string, what: string, cite: Cite): void {
  if (!existsSync(cite.file)) {
    fail(`${id}: ${what} file missing: ${cite.file} (run scripts/fetch-vendor-sources.sh?)`);
    return;
  }
  const text = read(cite.file);
  if (cite.symbol !== undefined && cite.symbol !== "") {
    if (!definesSymbol(text, cite.symbol)) {
      const calledOnly = text.includes(cite.symbol);
      fail(
        `${id}: ${what} "${cite.symbol}" is ${calledOnly ? "present but not defined" : "not found"} in ${cite.file}` +
          (calledOnly ? " (a call site or a longer identifier is not a definition)" : ""),
      );
    }
    return;
  }
  const anchor = cite.anchor ?? "";
  if (anchor !== "" && !text.includes(anchor)) {
    fail(`${id}: ${what} anchor "${anchor}" not found in ${cite.file}`);
  }
}

const weakenSrc = read("src/kernel/weaken.ts");
const forgeryTests = read("tests/forgery.test.ts");
const divergenceDocs = new Set<string>();
for (const r of registry) {
  checkCite(r.id, "src", r.src);
  checkCite(r.id, "kernel", r.kernel);
  if (r.thesis !== null) checkCite(r.id, "thesis", r.thesis);
  if (r.forgery !== undefined) {
    if (!existsSync(r.forgery.artifact)) fail(`${r.id}: forgery artifact missing: ${r.forgery.artifact}`);
    if (!weakenSrc.includes(`"${r.forgery.flag}"`)) fail(`${r.id}: flag ${r.forgery.flag} not in src/kernel/weaken.ts`);
    if (!forgeryTests.includes(r.forgery.flag)) fail(`${r.id}: flag ${r.forgery.flag} not tested in tests/forgery.test.ts`);
  }
  // A documented divergence must be documented: the named file needs a
  // heading for this rule, so "we match the kernel except here" is a
  // claim the build can check rather than a claim the author remembers.
  if (r.divergence !== undefined) {
    divergenceDocs.add(r.divergence.doc);
    if (!existsSync(r.divergence.doc)) {
      fail(`${r.id}: divergence doc missing: ${r.divergence.doc}`);
    } else if (!new RegExp(`^## ${r.id}\\b`, "m").test(read(r.divergence.doc))) {
      fail(`${r.id}: ${r.divergence.doc} has no "## ${r.id}" heading`);
    }
  }
}
// ...and the other direction: no heading there for a rule that is not
// marked divergent in the registry.
const divergentIds = new Set(registry.filter((r) => r.divergence !== undefined).map((r) => r.id));
for (const doc of divergenceDocs) {
  for (const m of read(doc).matchAll(/^## ([A-Z][A-Z0-9-]+)\b/gm)) {
    const id = m[1] ?? "";
    if (!divergentIds.has(id)) fail(`${doc} documents "${id}", which no registry rule marks as divergent`);
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
// Chapter titles are exempt: a title names its own subject, so the
// heading "Chapter 8 — Structures and projections" must not count as a
// use of "structure".
const titles = chapters.map((c) => `Chapter ${c.num} — ${c.title}`);
const withoutTitles = (s: string): string => titles.reduce((acc, t) => acc.split(t).join(" "), s);
const terms = loadTerms();
let exempt = 0;
for (const [term, entry] of Object.entries(terms)) {
  if (entry.chapter < 1 || entry.chapter > CHAPTER_COUNT) {
    fail(`term "${term}" names chapter ${entry.chapter}, which does not exist`);
  }
  // An opt-out must say why, so it stays an argued exception rather than
  // a quiet way to make the gate green.
  if (entry.gate === false) {
    exempt++;
    if ((entry.gateNote ?? "").length < 20) fail(`term "${term}" opts out of the gate without a gateNote`);
    continue;
  }
  const re = new RegExp(`(?<![A-Za-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
  for (const ch of chapters) {
    if (re.test(withoutTitles(ch.joined))) {
      if (ch.num < entry.chapter) {
        fail(`term "${term}" (defined in chapter ${entry.chapter}) first appears in ${ch.path}`);
      }
      break;
    }
  }
}

// Gate 8: the appendix is fresh, and every citation is a link to its own
// anchor (the registry's reader-facing face; see book/RULES.md).
const appendixPath = "book/RULES.md";
if (!existsSync(appendixPath)) {
  fail(`${appendixPath} missing (run: bun run scripts/gen-rules-appendix.ts)`);
} else if (read(appendixPath) !== generateRulesAppendix(loadRegistry())) {
  fail(`${appendixPath} is stale (run: bun run scripts/gen-rules-appendix.ts)`);
}
// Prose only: inside a `Try it` block a rule tag is a source comment, in
// the same style src/ uses, and markdown links do not belong in code.
// Gate 6 above still requires those tags to name a real rule.
for (const ch of chapters) {
  for (const m of ch.prose.matchAll(/\[R: ([A-Z0-9-]+)\]\(([^)]*)\)/g)) {
    const id = m[1] ?? "";
    const target = m[2] ?? "";
    if (target !== `RULES.md#${id.toLowerCase()}`) {
      fail(`${ch.path} citation [R: ${id}] links to "${target}", expected RULES.md#${id.toLowerCase()}`);
    }
  }
  for (const m of ch.prose.matchAll(/\[R: ([A-Z0-9-]+)\](?!\()/g)) {
    fail(`${ch.path} citation [R: ${m[1] ?? ""}] is not linked to the appendix`);
  }
}

// Gate 9: a Try-it file uses no grammar node before the chapter that
// introduces it. Gate 6 catches words in prose; this catches the code —
// chapter 1 once encoded a bound variable as a const and no gate noticed.
// Only kinds that name a node of the kernel grammar are listed; an
// exercise may invent kinds of its own for its own data.
const NODE_CHAPTER: Record<string, number> = {
  var: 1, lam: 1, app: 1,
  bvar: 2, fvar: 2,
  base: 3, arrow: 3,
  sort: 4, const: 4, pi: 4,
  let: 5,
  proj: 8,
  lit: 11,
};
for (const ch of chapters) {
  const m = /<!-- gate:tryit ([^ ]+) -->/.exec(ch.text);
  const tryitPath = m?.[1] ?? "";
  if (!existsSync(tryitPath)) continue;
  for (const k of read(tryitPath).matchAll(/kind: "([a-z]+)"/g)) {
    const kind = k[1] ?? "";
    const owner = NODE_CHAPTER[kind];
    if (owner !== undefined && owner > ch.num) {
      fail(`${tryitPath} uses node kind "${kind}", which chapter ${owner} introduces`);
    }
  }
}

// Gate 10: the notation card is a fresh generation from the term table.
const notationPath = "book/NOTATION.md";
if (!existsSync(notationPath)) {
  fail(`${notationPath} missing (run: bun run scripts/gen-notation-card.ts)`);
} else if (read(notationPath) !== generateNotationCard(terms)) {
  fail(`${notationPath} is stale (run: bun run scripts/gen-notation-card.ts)`);
}

if (failures > 0) {
  console.error(`\n${failures} gate failure(s).`);
  process.exit(1);
}
console.log(
  `book gates: all green (${chapters.length} chapters, ${registry.length} rules, ` +
    `${Object.keys(terms).length} terms, ${exempt} gate-exempt, ${divergentIds.size} documented divergence(s))`,
);
