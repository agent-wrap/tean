# How to build a Lean proof checker — and know that it is right

Twelve chapters for a TypeScript developer who has never met a proof
assistant. Start at [ch01.md](ch01.md); every chapter names the next one.

> A proof checker is small enough for one person to understand and
> expensive enough to surprise them, and you only learn the second half by
> building one and pointing it at a real library.

The checker the book describes lives in `../src` and passes the local
Lean Kernel Arena suite 199/199. Every number in the book was measured
and is recorded, with its command, in `../docs/NOTEBOOK.md`.

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
  disabled accepts (`../tests/forgery.test.ts`).

Chapters cite rules as `[R: T-APP]`. CI fails when a citation does not
resolve, in either direction.

## The gates (`../scripts/book-gates.ts`, run in CI)

1. Twelve chapters, 250 lines each at most, one claim per chapter.
2. Reading order: each chapter names the next by its real title.
3. Every claim names an evidence file that exists and says what the
   chapter says it says.
4. Every `Try it` block is a real file under [tryit/](tryit/), typechecked
   by `bun check`, executed in CI, and its printed output is compared
   byte-for-byte against the chapter.
5. The registry resolves totally (run `../scripts/fetch-vendor-sources.sh`
   first on a fresh clone; `vendor/` is not committed).
6. No term is used before the chapter that defines it
   ([terms.json](terms.json)).

## Reading rules the book holds itself to

- Chapters 1–7 contain no Lean syntax, no repository paths, no commands,
  and no test names in their prose. The machine apparatus (gate comments,
  the `Try it` footer) is the one sanctioned exception, kept out of the
  reader's way in HTML comments.
- Data before notation: every idea arrives as a TypeScript type, then a
  runnable function, then the formal rule.
- Every dead guess is kept, next to the measurement that killed it
  (chapter 10).

## What is deliberately not claimed

The reader-facing evidence — think-aloud sessions with real
undergraduates, the posttest against the bar fixed in
`../docs/PLAN.md`, an independent fact check — has not been collected
yet. Those are open rows in the notebook, and chapter 12 says so in
print. A book that grades its own readability has not been graded.
