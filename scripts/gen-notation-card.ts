/**
 * Generates book/NOTATION.md, the reader-facing notation card, from
 * book/terms.json — the same file the forward-reference gate reads.
 *
 * scripts/book-gates.ts imports generateNotationCard and fails the build
 * when the committed book/NOTATION.md differs from a fresh generation,
 * so the card can never go stale against the term table.
 *
 * Run: bun run scripts/gen-notation-card.ts
 */
import { readFileSync, writeFileSync } from "node:fs";

export interface Term {
  chapter: number;
  symbol?: string;
  say: string;
  gloss: string;
  /** false opts this term out of the forward-reference gate. Only for
   *  words that are ordinary English too; `gateNote` must say which. */
  gate?: boolean;
  gateNote?: string;
}

export function loadTerms(): Record<string, Term> {
  return (JSON.parse(readFileSync("book/terms.json", "utf8")) as { terms: Record<string, Term> }).terms;
}

function row(name: string, t: Term): string {
  const shown = t.symbol ?? `**${name}**`;
  return `| ${shown} | ${t.say} | ${t.gloss} | [${t.chapter}](ch${String(t.chapter).padStart(2, "0")}.md) |`;
}

export function generateNotationCard(terms: Record<string, Term>): string {
  const entries = Object.entries(terms);
  const symbols = entries.filter(([, t]) => t.symbol !== undefined);
  const words = entries.filter(([, t]) => t.symbol === undefined);
  const byChapter = (a: [string, Term], b: [string, Term]): number => a[1].chapter - b[1].chapter;

  const out: string[] = [
    "# The notation card",
    "",
    "<!-- Generated from terms.json by scripts/gen-notation-card.ts. -->",
    "<!-- Do not edit by hand: the book gates compare this file against a -->",
    "<!-- fresh generation and fail CI on any difference. -->",
    "",
    "One page to keep open while reading. Every symbol and every piece of",
    "jargon the book uses, how to say it out loud, what it means, and the",
    "chapter that earns it. Nothing here is a prerequisite — each entry is",
    "explained properly where it first appears.",
    "",
    "## Symbols",
    "",
    "| Notation | Say it | What it means | Ch. |",
    "|---|---|---|---|",
    ...symbols.sort(byChapter).map(([n, t]) => row(n, t)),
    "",
    "## Words",
    "",
    "| Term | Say it | What it means | Ch. |",
    "|---|---|---|---|",
    ...words.sort(byChapter).map(([n, t]) => row(n, t)),
    "",
    "## Two conventions worth stating once",
    "",
    "**The inference bar.** A rule written as a fraction —",
    "premises above a horizontal line, conclusion below — reads \"if",
    "everything above the line holds, then the thing below it holds\".",
    "Chapter 3 is the first to use one.",
    "",
    "**Rule tags.** `[R: T-APP]` in a chapter is a citation into",
    "[the rules appendix](RULES.md), where every rule of the type theory is",
    "given in plain English with links to the published theory, the Lean 4",
    "kernel source, and this checker. On a first read they are footnotes.",
    "",
  ];
  return out.join("\n");
}

if (import.meta.main) {
  writeFileSync("book/NOTATION.md", generateNotationCard(loadTerms()));
  console.log("wrote book/NOTATION.md");
}
