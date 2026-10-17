/**
 * Generates book/RULES.md, the reader-facing appendix of the rule
 * registry (book/rules.json). Chapters cite rules as
 * [R: T-APP](RULES.md#t-app); this file is where those links land.
 *
 * scripts/book-gates.ts imports generateRulesAppendix and fails the build
 * when the committed book/RULES.md differs from a fresh generation, so
 * the appendix can never go stale against the registry.
 *
 * Run: bun run scripts/gen-rules-appendix.ts
 */
import { readFileSync, writeFileSync } from "node:fs";

// The same revisions scripts/fetch-vendor-sources.sh vendors.
const LEAN_HASH = "5045d0056413266e57c625dcd7c365b10e377c52";
const THESIS_HASH = "0ba178704380d2fad751f020d461b293f47e36d5";
const LEAN_BLOB = `https://github.com/leanprover/lean4/blob/${LEAN_HASH}/src/kernel`;
const THESIS_BLOB = `https://github.com/digama0/lean-type-theory/blob/${THESIS_HASH}`;
const THESIS_PDF = "https://github.com/digama0/lean-type-theory/releases/tag/v1.0";

interface Cite {
  file: string;
  symbol?: string;
  anchor?: string;
}

export interface RegistryRule {
  id: string;
  name: string;
  kind: string;
  statement: string;
  meaning: string;
  thesis: Cite | null;
  note?: string;
  kernel: Cite;
  src: Cite;
  forgery?: { flag: string; artifact: string; soundness: boolean };
}

const KIND_TITLES: Record<string, string> = {
  typing: "Typing",
  level: "Levels",
  reduction: "Reduction",
  defeq: "Definitional equality",
  wellformedness: "Well-formedness",
};

// vendor/lean4-type_checker.cpp -> src/kernel/type_checker.cpp at LEAN_HASH.
function kernelLink(cite: Cite): string {
  const file = cite.file.replace(/^vendor\/lean4-/, "");
  return `[\`${cite.symbol ?? ""}\` in src/kernel/${file}](${LEAN_BLOB}/${file})`;
}

// vendor/lean-type-theory/axioms.tex -> the pinned blob in the thesis repo.
function thesisLink(cite: Cite): string {
  const file = cite.file.replace(/^vendor\/lean-type-theory\//, "");
  return `[${file}, at \`${cite.anchor ?? ""}\`](${THESIS_BLOB}/${file}) · [PDF (release v1.0)](${THESIS_PDF})`;
}

// Links are relative to book/, where RULES.md lives.
function srcLink(cite: Cite): string {
  return `[\`${cite.symbol ?? ""}\` in ${cite.file}](../${cite.file})`;
}

export function generateRulesAppendix(rules: RegistryRule[]): string {
  const out: string[] = [
    "# The rules, in plain English",
    "",
    "<!-- Generated from rules.json by scripts/gen-rules-appendix.ts. -->",
    "<!-- Do not edit by hand: the book gates compare this file against a -->",
    "<!-- fresh generation and fail CI on any difference. -->",
    "",
    "Every `[R: …]` tag in the chapters lands here. Each entry gives the",
    "rule's meaning, its formal statement, and the three places the build",
    "verifies it against: Carneiro's thesis (*The Type Theory of Lean*),",
    "the Lean 4 kernel at githash `" + LEAN_HASH.slice(0, 8) + "`, and this",
    "checker's source. Soundness rules also carry a forgery: an input the",
    "normal kernel refuses and a kernel with exactly that rule disabled",
    "accepts.",
    "",
    "| Rule | Name | Kind |",
    "|---|---|---|",
  ];
  for (const r of rules) {
    out.push(`| [${r.id}](#${r.id.toLowerCase()}) | ${r.name} | ${r.kind} |`);
  }
  let kind = "";
  for (const r of rules) {
    if (r.kind !== kind) {
      kind = r.kind;
      out.push("", `## ${KIND_TITLES[kind] ?? kind}`);
    }
    out.push(
      "",
      `<a id="${r.id.toLowerCase()}"></a>`,
      "",
      `### ${r.id} — ${r.name}`,
      "",
      r.meaning,
      "",
      `> \`${r.statement}\``,
      "",
    );
    if (r.thesis !== null) {
      out.push(`- Thesis: ${thesisLink(r.thesis)}`);
    } else {
      out.push(`- Thesis: not modeled — ${r.note ?? "kernel extension"}`);
    }
    out.push(`- Lean 4 kernel: ${kernelLink(r.kernel)}`);
    out.push(`- This checker: ${srcLink(r.src)}`);
    if (r.forgery !== undefined) {
      out.push(
        `- Forgery (${r.forgery.soundness ? "soundness" : "hygiene"}): flag \`${r.forgery.flag}\`, ` +
          `[artifact](${r.forgery.artifact.replace(/^book\//, "")}), run in [tests/forgery.test.ts](../tests/forgery.test.ts)`,
      );
    }
  }
  out.push("");
  return out.join("\n");
}

export function loadRegistry(): RegistryRule[] {
  return (JSON.parse(readFileSync("book/rules.json", "utf8")) as { rules: RegistryRule[] }).rules;
}

if (import.meta.main) {
  writeFileSync("book/RULES.md", generateRulesAppendix(loadRegistry()));
  console.log("wrote book/RULES.md");
}
