# How the book is built

Maintainer notes for [the book](../book/README.md): its structure, the
registry it rests on, the CI gates in `../scripts/book-gates.ts`, and the
writing rules it holds itself to. None of this is reader-facing.

The checker the book describes lives in `../src` and passes the local
Lean Kernel Arena suite 199/199. Every measured number in the book is
recorded, with its command, in `NOTEBOOK.md`.

## The shape

Chapters 1–10 are the theory, each one node or one rule at a time: the
untyped calculus, variables as indices, the arrow and the first type
checker, universes and declarations, computation, the two-function core,
data declarations, structures, recursors, and the last two primitives.
Chapters 11–15 point the finished checker at the world: the real export
format, the kernel conventions a port must match, the measured cost, the
forgeries, and the outside judge.

## The spine: a verified correspondence

The book does not run on trust, including trust in its author. Its spine
is [rules.json](../book/rules.json), a registry in which every formal rule of the
type theory maps to:

- the **thesis** — Carneiro, *The Type Theory of Lean* — by a literal
  anchor in the vendored LaTeX source;
- the **Lean 4 kernel** (githash `5045d005`) by a symbol in the vendored
  C++ file;
- **this checker** by a symbol in `src/`;
- for soundness rules, a **forgery**: an export in [forgeries/](../book/forgeries/)
  that the normal kernel refuses and a kernel with exactly that rule
  disabled accepts (`../tests/forgery.test.ts`);
- where this checker deliberately does *not* match the C++ kernel, a
  **divergence**, which must be argued in
  [`../docs/DIVERGENCES.md`](DIVERGENCES.md).

Chapters cite rules as `[R: T-APP](../book/RULES.md#t-app)` — the tag links to
[RULES.md](../book/RULES.md), a generated appendix giving each rule's plain-English
name, meaning, and pinned links to the thesis, the kernel source, and this
checker. CI fails when a citation does not resolve in either direction,
when a link's target is not its own anchor, or when the appendix is stale
against the registry.

## The gates (`../scripts/book-gates.ts`, run in CI)

1. Fifteen chapters, 250 lines of prose each at most (exercises are
   held to their own standard, below), one claim per chapter.
2. Reading order: each chapter ends with a link to the next by its real
   title and filename, and every chapter cross-reference resolves.
3. Every claim names an evidence file that exists and says what the
   chapter says it says.
4. Every `Try it` block is a real file under [tryit/](../book/tryit/), typechecked
   by `bun check`, executed in CI, and its printed output is compared
   byte-for-byte against the chapter.
5. The registry resolves totally, including both directions of the
   divergence list. On a fresh clone, run
   `../scripts/fetch-vendor-sources.sh` first; `vendor/` is not
   committed, and the gate says so in one line rather than failing
   every citation separately.
6. No term is used before the chapter that defines it
   ([terms.json](../book/terms.json)). A term that is also an ordinary English
   word may opt out, and must say why in the file.
7. [RULES.md](../book/RULES.md) equals a fresh generation from the registry
   (`../scripts/gen-rules-appendix.ts`), and every chapter citation in
   prose links to its own anchor there.
8. [NOTATION.md](../book/NOTATION.md) equals a fresh generation from
   [terms.json](../book/terms.json) (`../scripts/gen-notation-card.ts`).
9. No `Try it` file uses a grammar node before the chapter that
   introduces it. Gate 6 reads prose; this one reads the code.
10. [SUMMARY.md](../book/SUMMARY.md), the site's table of contents, equals a
    fresh generation from the chapter headings
    (`../scripts/gen-summary.ts`). The site is built from
    [`../book.toml`](../book.toml) by mdBook (`devbox run site`) and
    published by `.github/workflows/pages.yml`.

## Reading rules the book holds itself to

- Chapters 1–10 contain no Lean syntax, no repository paths, no commands,
  and no test names in their prose. The sanctioned exceptions are the
  machine apparatus (gate comments in HTML, the `Try it` footer), link
  targets, and the titles cited under References.
- Data before notation: every idea arrives as a TypeScript type, then a
  runnable function, then the formal rule.
- Reach for what the reader already knows. Definitional equality is
  structural typing with programs in the shapes; a recursor is `reduce`;
  positivity is the rule TypeScript does not have.
- The book describes the checker as it is, and the type theory as it is.
  It is not a development diary: the record of how the code got here
  lives in `NOTEBOOK.md`, which is where it belongs.

## What is deliberately not claimed

The reader-facing evidence — think-aloud sessions with real
undergraduates, the posttest against the bar fixed in
`PLAN.md`, an independent fact check — has not been collected
yet. Those are open rows in the notebook, and chapter 14 says so in
print. A book that grades its own readability has not been graded.
