# How to build a Lean proof checker — and know that it is right

Fourteen chapters for a TypeScript developer who has never met a proof
assistant. Start at [ch01.md](ch01.md); every chapter names the next one.
Keep [the notation card](NOTATION.md) open beside them — one page with
every symbol and every piece of jargon, how to say it out loud, and the
chapter that earns it.

> A proof checker is small enough for one person to understand and
> expensive enough to surprise them, and you only learn the second half by
> building one and pointing it at a real library.

The checker the book describes lives in `../src` and passes the local
Lean Kernel Arena suite 199/199. Every measured number in the book is
recorded, with its command, in `../docs/NOTEBOOK.md`.

## The shape

Chapters 1–9 are the theory, each one node or one rule at a time: terms,
variables, universes, computation, the two-function core, data
declarations, structures, recursors, and the last two primitives.
Chapters 10–14 point the finished checker at the world: the real export
format, the kernel conventions a port must match, the measured cost, the
forgeries, and the outside judge.

## The spine: a verified correspondence

The book does not run on trust, including trust in its author. Its spine
is [rules.json](rules.json), a registry in which every formal rule of the
type theory maps to:

- the **thesis** — Carneiro, *The Type Theory of Lean* — by a literal
  anchor in the vendored LaTeX source;
- the **Lean 4 kernel** (githash `5045d005`) by a symbol in the vendored
  C++ file;
- **this checker** by a symbol in `src/`;
- for soundness rules, a **forgery**: an export in [forgeries/](forgeries/)
  that the normal kernel refuses and a kernel with exactly that rule
  disabled accepts (`../tests/forgery.test.ts`);
- where this checker deliberately does *not* match the C++ kernel, a
  **divergence**, which must be argued in
  [`../docs/DIVERGENCES.md`](../docs/DIVERGENCES.md).

Chapters cite rules as `[R: T-APP](RULES.md#t-app)` — the tag links to
[RULES.md](RULES.md), a generated appendix giving each rule's plain-English
name, meaning, and pinned links to the thesis, the kernel source, and this
checker. CI fails when a citation does not resolve in either direction,
when a link's target is not its own anchor, or when the appendix is stale
against the registry.

## The gates (`../scripts/book-gates.ts`, run in CI)

1. Fourteen chapters, 250 lines of prose each at most (exercises are
   held to their own standard, below), one claim per chapter.
2. Reading order: each chapter names the next by its real title.
3. Every claim names an evidence file that exists and says what the
   chapter says it says.
4. Every `Try it` block is a real file under [tryit/](tryit/), typechecked
   by `bun check`, executed in CI, and its printed output is compared
   byte-for-byte against the chapter.
5. The registry resolves totally, including both directions of the
   divergence list. On a fresh clone, run
   `../scripts/fetch-vendor-sources.sh` first; `vendor/` is not
   committed, and the gate says so in one line rather than failing
   every citation separately.
6. No term is used before the chapter that defines it
   ([terms.json](terms.json)). A term that is also an ordinary English
   word may opt out, and must say why in the file.
7. [RULES.md](RULES.md) equals a fresh generation from the registry
   (`../scripts/gen-rules-appendix.ts`), and every chapter citation in
   prose links to its own anchor there.
8. [NOTATION.md](NOTATION.md) equals a fresh generation from
   [terms.json](terms.json) (`../scripts/gen-notation-card.ts`).

## Reading rules the book holds itself to

- Chapters 1–9 contain no Lean syntax, no repository paths, no commands,
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
  lives in `../docs/NOTEBOOK.md`, which is where it belongs.

## What is deliberately not claimed

The reader-facing evidence — think-aloud sessions with real
undergraduates, the posttest against the bar fixed in
`../docs/PLAN.md`, an independent fact check — has not been collected
yet. Those are open rows in the notebook, and chapter 14 says so in
print. A book that grades its own readability has not been graded.
