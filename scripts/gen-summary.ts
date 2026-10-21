/**
 * Generate book/SUMMARY.md, mdBook's table of contents, from the chapters
 * themselves: the H1 of each book/chNN.md, in order, with the preface and
 * the two generated appendices around them.
 *
 * Generated rather than hand-kept because mdBook treats SUMMARY.md as the
 * truth: a stale entry after a chapter is renamed would make the site
 * build a stub page (or, with create-missing on, create a file in the
 * source tree). scripts/book-gates.ts checks the file is fresh.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export function generateSummary(): string {
  const lines = ["# Summary", "", "[How to build a Lean proof checker](README.md)", "", "---", ""];
  for (let n = 1; existsSync(`book/ch${String(n).padStart(2, "0")}.md`); n++) {
    const file = `ch${String(n).padStart(2, "0")}.md`;
    const h1 = /^# (.+)$/m.exec(readFileSync(`book/${file}`, "utf8"));
    if (h1 === null) throw new Error(`book/${file} has no H1`);
    lines.push(`- [${h1[1] ?? ""}](${file})`);
  }
  // Bare links after the separator are mdBook "suffix chapters": listed, not numbered.
  lines.push("", "---", "", "[Notation card](NOTATION.md)", "[Rules appendix](RULES.md)", "");
  return lines.join("\n");
}

if (import.meta.main) {
  writeFileSync("book/SUMMARY.md", generateSummary());
  console.log("wrote book/SUMMARY.md");
}
