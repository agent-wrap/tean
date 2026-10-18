# tean

A Lean 4 proof checker written in TypeScript, and a fourteen-chapter book
about building it that is wired to CI so the two cannot drift apart.

Lean's kernel is the part of a proof assistant that has to be right. The
editor, the elaborator, the tactic engine and the compiler are all allowed
to emit garbage, because each of them has to hand its output to the kernel
before anything is believed. The kernel is small on purpose: the 14 source
files this port was read against come to 6,198 lines of C++. That makes it
one of the few pieces of load-bearing software a single person can read end
to end.

This repository is what happened after reading it. 5,120 lines of
TypeScript that re-check Lean proofs from scratch, and a book that teaches
you to do the same. The [Lean Kernel Arena](https://arena.lean-lang.org/)
ships 27 checker definitions — the official kernel and 26 independent
reimplementations, in Rust, Python, Haskell, Java, Fortran and COBOL.
None of them are in TypeScript.

---

## The book

**[Start at book/ch01.md](book/ch01.md).** Fourteen chapters for a
TypeScript developer who has never opened a proof assistant. Chapters 1–9
are the theory; no Lean syntax appears before chapter 10. Each chapter
makes one claim, names the file that backs it, and names the chapter that
follows. [book/NOTATION.md](book/NOTATION.md) is the one-page card of
every symbol and term, with how to say each one out loud.

### Every rule is defined by what it refuses

Most writing about type theory states a rule and asks you to accept that
it matters. This book ships the counterexample instead.

Chapter 6 covers strict positivity: a constructor may not take an argument
that mentions the type being defined in a negative position. Here is what
the checker does with a declaration that breaks the rule.

```
$ ./run.sh book/forgeries/WF-IND-POS.ndjson
FAIL [inductive] indNeg: arg #1 of 'indNeg.mk' has a non positive occurrence of the datatypes being declared
$ echo $?
1
```

`src/kernel/weaken.ts` can switch off exactly one named rule and nothing
else. With `WF-IND-POS` switched off, that same file is **accepted**, and
the classic route to a proof of `False` is open.
`tests/forgery.test.ts` asserts both halves for five rules, so a
decorative rule would fail the suite. The rule is not described as
load-bearing. It is shown to be, in a test that runs in 33 ms.

```sh
bun test tests/forgery.test.ts   # 10 tests: five rules, both halves
```

Two honesty notes the book insists on, and so does this file. One of the
five, `WF-THM-PROP`, is a hygiene rule rather than a soundness rule, and
its weakened acceptance proves nothing false; chapter 13 explains why the
difference matters. And this checker refuses the inductive forgeries twice
over, once by the named rule and once by deriving recursors instead of
trusting the export, so those weakened runs disable the second net too, as
the historical attacks assumed. `book/forgeries/README.md` has the table.

### The book cites its sources, and CI resolves the citations

`book/rules.json` holds 37 formal rules. Each one points at four things:

- Carneiro's *The Type Theory of Lean*, by a literal anchor in the
  vendored LaTeX source;
- the Lean 4 kernel at githash `5045d005`, by C++ symbol;
- this checker, by symbol in `src/`;
- for the soundness rules, its forgery;
- and, where this checker deliberately does not match the C++ kernel, an
  entry in [`docs/DIVERGENCES.md`](docs/DIVERGENCES.md) arguing the
  difference. The gate checks that list in both directions.

`scripts/book-gates.ts` runs in CI and fails the build when a citation
does not resolve in either direction, when a chapter uses a term before
the chapter that defines it, when a chapter runs past 250 lines of prose
or carries more than one claim, or when a `Try it` block's printed output
differs by a byte from what the real file prints.

A citation resolves only if the cited file *defines* the cited symbol. A
string that merely occurs somewhere in the file is not a citation, and
the gate rejects a call site, a comment, or a longer identifier that
happens to contain the name.

**[book/README.md](book/README.md)** lists all the gates.
**[book/RULES.md](book/RULES.md)** is the generated appendix: every rule
in plain English, with pinned links to the thesis, the kernel source, and
the code.

---

## Run the proof checker yourself

Four steps, each larger than the last. Every command below was run before
this file was committed.

### 1. Thirty seconds, no setup

Each chapter's `Try it` block is a standalone file. Chapter 1's is a
complete type checker for the lambda calculus in about 60 lines:

```sh
bun run book/tryit/ch01.ts
# (fun x : Nat => (f x))
# nodes: 5
```

It has no imports. Paste it into any TypeScript playground.

### 2. The repository

```sh
devbox shell    # provides bun, node, elan
bun install
bun check       # typecheck: tsc, strict, erasable syntax only
bun test        # 41 tests, 1267 assertions
```

### 3. One real proof, and one forgery

Fetch the Arena's test suite, which is 127 valid proofs and 72 invalid
ones:

```sh
mkdir -p vendor
curl -sL -o /tmp/arena.tar.gz https://arena.lean-lang.org/lean-arena-tests.tar.gz
tar -xzf /tmp/arena.tar.gz -C vendor

./run.sh vendor/good/init-prelude.ndjson          # silent, exit 0, 0.37 s
./run.sh vendor/bad/tutorial/054_indNeg.ndjson    # prints the refusal, exit 1
```

Exit codes follow the Arena convention: 0 accept, 1 reject, 2 decline,
anything else is a bug in the checker. A clean accept prints nothing,
because that is what the Arena harness wants.

### 4. The whole suite, and a real Lean library

```sh
bun run arena     # all 199 local tests
bun run verify    # everything CI runs, book gates included
```

For the real corpora you need a Lean toolchain. `docs/NOTEBOOK.md`
(2026-10-16) records the exact steps: elan at v4.34.1, `lean4export`
pinned to it, a scaffold project importing `Init` or `Std`.

---

## What is measured

Every number here traces to a dated entry in `docs/NOTEBOOK.md`, with the
command that produced it.

| | result |
|---|---|
| Arena local suite | 199/199, including all 72 invalid proofs refused |
| Lean `init` corpus (347 MB) | 59,623 declarations, all accepted |
| `init` time, this machine | 22.2 s. The official C++ kernel, same file and machine: 35.1 s. |
| Lean `std` corpus (596 MB) | 104,050 of 104,056 declarations pass |
| `std` time | 13.5 min against the official kernel's 60 s, roughly 13x slower |

One caveat on the suite, because the default invocation does not show
199/199. `bun run arena` with its defaults reports 198/199: one perf
test, `magma-list-deep-n36`, exceeds both the 60 s timeout and the 16 GB
heap the entry point sets. Raise the ceiling and it passes:

```sh
bun run arena --timeout 240 --jobs 6 --exclude magma-list-deep-n36   # 198/198
TEAN_WORKER_HEAP_MB=48000 ./run.sh vendor/good/perf/magma-list-deep-n36.ndjson
# accepted in 99.4 s, 17.3 GB resident
```

The heap ceiling has to be raised well above the 17.3 GB actually used,
or the collector aborts. Other checkers pass that test in 2.2 to 35 s
inside 10 GB, so bytes per expression node is an open problem here, not
the algorithm.

The `init` result is one corpus on one machine, not a general speed claim,
and `std` is the counterweight. Churn profiling attributes most of the
`std` gap to symbolic evaluation inside `Std.Tactic.BVDecide` proofs,
where tens of millions of reduction steps unfold
`DHashMap.Internal.Raw₀.insert` over free variables and the official
kernel somehow does not. That gap is the top-ranked open question about
this checker; chapter 12 states it in those terms rather than rounding it
off.

## What is not claimed

The checker has not been submitted to the Arena. `checker.yaml` is a
draft and its `url` and `rev` are still placeholders.

The book has not been read by a stranger. Think-aloud sessions, the
posttest against the bar in `docs/PLAN.md`, and an independent fact check
are all open rows in the notebook, and chapter 14 says so in print. A book
that grades its own readability has not been graded.

## Layout

- `src/kernel/` names, levels, expressions, environment, type checker,
  inductive validation, quotients
- `src/export/` the NDJSON parser for `lean4export` files
- `src/checker.ts`, `src/main.ts` declaration admission and the CLI
- `book/` fourteen chapters, the rule registry, the notation card, the
  forgeries, the runnable `Try it` files
- `docs/NOTEBOOK.md` the measurement record. Every number in every
  document in this repository traces to an entry here.
- `docs/DIVERGENCES.md` every deliberate behavioural difference from the
  C++ kernel, with its reasoning and its evidence
- `docs/PLAN.md` the book's claim, reader, exit tasks, and gates

---

## Future work

The point of this repository is that reimplementing a component teaches
you what reading about it cannot. The kernel is the smallest component
worth doing that way. It is not the only one.

### Other Lean components worth reimplementing

Roughly in order of how much they teach per line of code.

- **The exporter, not the checker.** Write your own `lean4export`. You
  meet the term representation from the producing side, which is where
  the awkward parts live.
- **The pretty-printer and delaborator.** Terms back to readable syntax.
  Much shorter than a checker, and it forces you to understand implicit
  arguments and binder naming, which most tutorials wave through.
- **`Decidable` and `decide`.** The bridge from a proposition to a
  computation. Small, self-contained, and the clearest short answer to
  why a proof can be a program.
- **`simp`.** Term rewriting with a discrimination tree index. The first
  place where performance engineering and logic meet.
- **The metavariable context and `MetaM`.** Goals, assignment,
  instantiation. This is the machinery the kernel deliberately does not
  have, and the reason it stays small.
- **The unifier and the elaborator.** Why the kernel is 6,000 lines and
  the elaborator is enormous. Higher-order unification is where the
  difficulty actually sits.
- **The macro and syntax system.** A Pratt parser that users extend at
  compile time, in the language itself.
- **`BVDecide`.** A SAT solver emits an LRAT certificate and the kernel
  re-checks it. The clearest example in the whole system of "do not trust
  the tool, check the artifact". It is also the thing costing this checker
  13x on `std`, so it is not a toy exercise.
- **The `.olean` module format and import resolution.** Unglamorous, and
  immediately useful if you want to read a Lean build without running
  Lean.
- **The compiler path**, lcnf down to C. Explicitly outside the trusted
  core, which makes it a good place to see where the trust boundary is
  drawn and why.

### Tools that help you understand how Lean works

Start interactive, then go to source.

- **[Visual Lean](https://leangame.autumnofautumn.com)** runs Lean in your
  browser over WASM and rebuilds the Natural Number Game as a graphical
  interface. Prove arithmetic from the axioms with nothing installed.
  Designed and directed by Autumn Mapes, advised by Timothy Gowers, Miles
  Cranmer and Matthew Colbrook, with contributors from the original
  Natural Number Game.
- **[The Lean 4 Game server](https://adam.math.hhu.de/)** hosts the
  Natural Number Game and several others.
- **[live.lean-lang.org](https://live.lean-lang.org/)** is a full Lean
  editor in a tab. No toolchain.
- **[The Lean Kernel Arena](https://arena.lean-lang.org/)** benchmarks
  independent kernels against a shared suite, and ships the suite. Its
  invalid tests are named after the exact traps a new kernel falls into.
  Download it and point your own code at it.
- **[loogle](https://loogle.lean-lang.org/)** searches mathlib by the
  shape of a type rather than by name.

### Other people's kernels, to read against your own

- **[lean4lean](https://github.com/digama0/lean4lean)** by Mario Carneiro:
  the Lean kernel in Lean, with a formal metatheory development alongside
  it. Paper: [arXiv:2403.14064](https://arxiv.org/abs/2403.14064).
- **[nanoda_lib](https://github.com/ammkrn/nanoda_lib)** in Rust, and
  **[nanoclo](https://github.com/sgraf812/nanoclo)**, a fork exploring
  delayed instantiation.
- **[trepplein](https://github.com/gebner/trepplein)** by Gabriel Ebner, a
  Lean 3 checker in Scala. Older, and short enough to read in a sitting.
- **[lean4export](https://github.com/leanprover/lean4export)**, the
  official exporter. The input format every external checker reads.

### Reading

- **[Type Checking in Lean 4](https://ammkrn.github.io/type_checking_in_lean4/)**
  covers the same ground as this book's chapters 1 to 9, from the other
  direction. Read it against ours and find where we disagree.
- **[The Type Theory of Lean](https://github.com/digama0/lean-type-theory)**,
  Carneiro's thesis. The authority `book/rules.json` cites.
- **[Theorem Proving in Lean 4](https://leanprover.github.io/theorem_proving_in_lean4/)**
  for using Lean rather than building it.
- **[Functional Programming in Lean](https://lean-lang.org/functional_programming_in_lean/)**
  for Lean as a programming language.
- **[Metaprogramming in Lean 4](https://leanprover-community.github.io/lean4-metaprogramming-book/)**
  for everything above the kernel, which is most of the components listed
  above.
- **[The Lean Zulip](https://leanprover.zulipchat.com/)**, where the
  people who wrote all of this will answer a specific question.
