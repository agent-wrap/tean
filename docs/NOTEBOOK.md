# Notebook

The rule: every measurement, every guess, and every wrong guess goes here on
the day it happens, with the command that produced it and the number it
produced. The book is written from this file. A mirror of this file lives
outside the repository.

Entry format: date, what I asked, the command, the number, what it means.

---

## 2026-10-15 — The arena is real, and it ships the tests

Asked: does the Lean Kernel Arena exist, and what does it provide?

- Fetched <https://arena.lean-lang.org/>. It exists. It claims 127 good tests
  and 72 bad tests in `lean-arena-tests.tar.gz`.
- `curl -sL -o vendor/lean-arena-tests.tar.gz https://arena.lean-lang.org/lean-arena-tests.tar.gz`
  → 3,659,724 bytes, gzip, dated 2026-10-15.
- `find vendor -type f ! -name "*.tar.gz" | wc -l` → 201 files after extract,
  in `good/` and `bad/`, with subdirectories `tutorial`, `corner-cases`,
  `other`, `perf`, `bugs`, and one `good/init-prelude.ndjson`.

Meaning: I do not need to build a Lean toolchain to get real input today. The
arena tarball is the ground truth and the red team in one download.

## 2026-10-15 — The export format is NDJSON, and the bytes agree with the doc

Asked: what format does lean4export write now?

- `vendor/format_ndjson.md` from the lean4export repository: version 3.1.0,
  one JSON object per line after a `meta` header.
- `head -c 1500 vendor/good/init-prelude.ndjson` → the real bytes agree with
  the document. Facts the bytes add:
  - Key order inside an object varies. A parser must not depend on it.
  - Name index 0 is the anonymous name. Level index 0 is zero. Both are
    implicit, never declared.
  - `natVal` is a JSON string, not a number. Big literals will not fit a
    JS number, so the parser must use `BigInt`.
  - Exporter was Lean 4.34.1, githash 5045d0056413266e57c625dcd7c365b10e377c52.
- `wc -l vendor/good/init-prelude.ndjson` → 64,110 lines.

Meaning: the prompt said NDJSON and the prompt was right, but the old build
read a line-based text format. The parser is new work, not a port.

## 2026-10-15 — Ground truth for the kernel came from six source files

Asked: what does the real kernel do, exactly, at the Lean version of the
export (4.34.1, githash 5045d005)?

Downloaded into `vendor/`: `type_checker.cpp`, `inductive.cpp`, `quot.cpp`,
`level.cpp`, `environment.cpp`, `declaration.cpp`, plus `inductive.h`,
`quot.h`, `expr_eq_fn.cpp`, and `instantiate.cpp`. Facts that moved the
design, each checked in the source, not from memory:

- The string rule compares a literal against `String.ofList`, not
  `String.mk`. H7 confirmed in a form nobody guessed.
- The kernel bounds Nat numerals at 128 MB (`LEAN_NAT_MAX_SIZE`), bounds
  `Nat.pow` and `Nat.shiftLeft` by predicted result size, and bounds their
  second argument to 32 bits. The perf `bad` tests target exactly this.
- Beta discharges the whole spine in one `instantiate` call. H4 confirmed
  in source. The measurement of the cost is still open.
- Structural equality ignores binder names AND binder infos
  (`expr_eq_fn<false>`), so the hash must too. H2 confirmed in source.
- Proof irrelevance returns a definitive false when the first term is a
  proof and the types are not defeq. It is three-valued, but not in the
  shape H3 described.
- Theorems must be propositions. Axioms only need a sort.
- The quotient module builds its four declarations itself and checks `Eq`
  first. Exported quot types are decoration.
- A recursor is derived, never read from the input. The kernel re-checks
  its own derived recursors for type preservation (`check_recursors`).
- K-like reduction, structure eta on the major premise, and
  literal-to-constructor conversion all live inside `inductive_reduce_rec`.

## 2026-10-15 — First full local arena run: 152/199, one root blocked 46

Command: `bun run scripts/arena.ts` over the extracted tarball.

- Round 1: **152/199. All 72 bad tests refused.** 47 good tests failed.
- 46 of the 47 shared one root: "exported recursor does not match the
  derived one" on universe-polymorphic types.
- Diffed derived vs exported `PUnit.rec`: the fresh elim level param is
  `u_1` in the export and `u1` in my code. `name::append_after` inserts an
  underscore. One character, 46 tests. H11 (rank by blocked count) holds.
- Round 2 after the fix: **185/199**. The next root: `HAdd.rec` differs by
  an `outParam` wrapper. The kernel strips type annotations
  (`consumeTypeAnnotations`: optParam, autoParam, outParam, semiOutParam)
  when it makes recursor locals. Found by diffing real bytes again.
- Round 3 after that fix: **195/199**. The four left are resource cases:
  two stack overflows, one out-of-memory, one timeout.

## 2026-10-15 — The deep terms are made, not read

Asked: how deep are the terms in the failing perf tests?

- `python3` DAG-depth scan of the inputs: church-numerals max depth **128**,
  app-lam 19,999, discarded-argument-match 205, magma-n36 1,325.
- So church-numerals (reduction depth 14,520 per the arena description)
  builds its depth during reduction. H10 confirmed, with a sharper shape:
  the input is shallow, the reduction is deep.
- Measured stack depth: Bun default **65,483** frames,
  `BUN_JSC_maxPerThreadStackUsage=512MB` **113,405**, Bun Worker **45,247**
  (workers are worse). `ulimit -s` does not move Bun. Bun plus ulimit plus
  the env var segfaults.
- Node 26: `ulimit -s 65520` + `--stack-size=60000` gives **639,753**
  frames, ten times Bun. Decision: `bun check` stays the typechecker and
  `bun test` the test runner; the arena runner executes the same TypeScript
  under Node with the big stack. The source moved to erasable-only syntax
  (no const enum, no parameter properties) so both engines run one code.
- `instantiate` was rewritten as an explicit-stack machine after a measured
  overflow (trace pointed at expr.ts, the recursive walk). First version of
  the rewrite had the child pop order reversed, caught by `bun test`.
- Result: church-numerals passes in 0.14 s, app-lam in 7.2 s under Node.

## 2026-10-15 — The arena numbers for everyone else

Command: `curl results.json` from the arena, then python.

- The hosted suite has 234 tests. The top score is **208/234**, held by
  lean4lean, the official kernel, tenet, nanoda-class checkers.
- My four hard tests also break others: church-numerals fails 7 checkers,
  app-lam 7, discarded-argument-match 4, magma-n36 9.
- magma-n36 pass times spread from 2.2 s (lazylean) to 35 s (con-ron).
  This is a genuinely hard test, good material for the cost chapter.
- Identity-keyed caches were the OOM suspect for discarded-argument-match:
  reduction rebuilds equal terms as fresh objects, so an identity cache
  misses and work repeats. Switched whnf, infer, and defeq caches to
  hash-bucket maps with structural equality, as the kernel's expr_map does.

## 2026-10-15 — One profile, one dead guess, one 2.5x

Command: `node --cpu-prof` on `magma-list-deep-n21`, then a python summary
of self time. Baseline 10.1 s against 0.16–2.5 s for the native structural
checkers.

- Profile: 24.5% in a closure at expr.ts:627, 17.5% garbage collector,
  10.4% exprEq, 9.4% instantiate, ~14% in node constructors.
- **Dead guess:** the hot `rec` was assumed to be the lift walk inside
  instantiate. Added a per-(depth, index) lift cache: 10.1 s → 10.6 s.
  No change. The guess was killed by re-profiling with line numbers:
  the hot `rec` is `instantiateLevelParams`, line 627, called on every
  delta unfold.
- The real kernel caches unfolds per constant instance (`m_unfold` in
  type_checker.cpp). I had skipped that cache. Adding it:
  **10.6 s → 4.2 s** on magma-list-deep-n21. Now within 2x of nanobruijn
  (2.46 s on the arena machine).
- `discarded-argument-match` went from out-of-memory to **1.4 s** when the
  whnf, infer, and defeq caches switched from identity keys to structural
  keys. H1/H2 get a sharper statement: the cache must be structural,
  because reduction rebuilds equal terms as fresh objects.

## Hypotheses carried from the deleted build, each unverified

Each one is a hint, not a fact. Status moves only with a measurement in this
file.

| # | Hypothesis | Status 2026-10-15 | Evidence |
|---|---|---|---|
| H1 | Cache per node: loose bvar range, node count, hash | revised and confirmed | loose range and hash are load-bearing. Node count never needed yet. The sharper fact: caches must key on STRUCTURE, not identity (discarded-argument-match: OOM → 1.4 s) |
| H2 | Hash must ignore binder names and level shape | confirmed for names and infos | expr_eq_fn<false> in the kernel source ignores binder names and infos, so the hash does too. "Level shape" part still unverified |
| H3 | Proof irrelevance must be three-valued | revised | the kernel source returns definitive false when the first term is a proof and the types differ. Three-valued, but not the shape the seed described. No loop observed |
| H4 | Beta must discharge the whole spine in one pass | confirmed in source | whnf_core instantiates m arguments in one call. Cost difference not measured |
| H5 | Never put a constructor in the computed-ops table | held by construction | reduce_nat and nat_lit_to_constructor ported as-is; tutorial iota tests pass. No loop reproduced |
| H6 | A recursor must be verified, or a forgery proves False | confirmed | derive-and-compare refuses 073_BogusRecursor and 136_misnamed_rec_user |
| H7 | String is not a list of characters anymore | confirmed, new form | the kernel's string rule targets `String.ofList`, not `String.mk`. Read in type_checker.cpp at the export's githash |
| H8 | Cheap test before expensive test in defeq | unverified | needs a defeq profile on a large corpus |
| H9 | Hash-consing is slower despite high duplicate rate | untested | structural cache maps gave the sharing benefit without consing |
| H10 | Deep recursion needs a big stack; read exit code, not clock | confirmed, sharper | input terms are shallow (church-numerals: depth 128 in the file, 14,520 under reduction). Bun pins ~8 MB; Node + ulimit + --stack-size gives 639,753 frames |
| H11 | Rank failures by blocked count, not by frequency | confirmed | one underscore in `append_after` blocked 46 of 47 good failures |

## 2026-10-15 — End of day one: 199/199 on the local suite

Command: `bun run scripts/arena.ts --timeout 240 --jobs 6
--out docs/measurements/arena-2026-10-15.json`.

- **199/199. good 127/127, bad 72/72.**
- Slowest: magma-list-deep-n36 at 111 s with a 48 GB Node heap (it aborts
  at 16 GB). Other checkers pass it in 2.2–35 s within 10 GB. Memory per
  node is the open problem, not the algorithm.
- magma-list-pair-n21 at 50 s is the next perf target.
- init-prelude (64,110 lines) checks in 0.3 s.
- The hosted arena holds 234 tests. The extra ones are the big real-world
  corpora (init, std, mathlib), not in the downloadable tarball. The top
  score there is 208/234. Nobody holds 234.

## 2026-10-15 — Strictness work starts from the defect record, not a preset

Asked: which compiler flag, lint rule, or type invariant would have caught
each real bug of this project? Written before any config.

| Bug | What would have caught it |
|---|---|
| `u1` vs `u_1` in `Name.appendAfter` | Nothing static. String logic. Only the arena diff found it |
| Reversed child-pop order in `instantiate` | Nothing static. `bun test` caught it at once |
| Missed unfold cache | Nothing static. Only the profile found it |
| `outParam` not stripped in recursor locals | Nothing static. Semantic port gap, found by diffing real bytes |
| 4 plain `Error` throws in kernel files | A restricted-throw lint rule (new, below) |
| Potential: a non-exhaustive switch on a new ExprKind | `switch-exhaustiveness-check` (new, below) |
| Potential: `==` on bigint/number mix | `eqeqeq` (new, below) |
| Potential: `Bun.*` creeping into src and breaking the Node runner | `no-restricted-globals` (new, below) |

Honest reading: the four REAL bugs of day one were semantic, and no
static rule catches them. The rules below defend against classes that
have not fired yet, and the table says so. Tests and outside diffs remain
the primary net.

Code as data before the change (commands: grep over `src/`):
54 non-null assertions, 51 `as` casts, 0 `any`, throws: 71 KernelError,
19 ParseError, 4 plain Error.

Perf baseline, same machine, before the refactor:
`magma-list-deep-n21` 3.56 s, `init-prelude` 0.278 s
(`node --stack-size=60000` per run.sh).

Decision record: **no Effect library.** The program is nearly pure. The
one benefit, typed errors, comes from a zero-dependency Result union and
an error-code taxonomy. The kernel keeps `throw` internally, as the C++
kernel does. GC was 17.5% of a hot test; an allocating effect wrapper in
the kernel fails the perf gate by construction.

## 2026-10-16 — Strictness landed, and the oracles judged it

Commands: `bun run verify` (check, lint, test, type-coverage, knip,
suppressions), `bun run scripts/arena.ts --timeout 240 --jobs 6`, timed
node runs, two bug replays, one Stryker run.

What changed:
- tsconfig: the `strict` umbrella expanded into every individual flag,
  each with its defect class in a comment, plus `noUnusedLocals`,
  `noUnusedParameters`, `noImplicitReturns`,
  `noPropertyAccessFromIndexSignature`, `isolatedModules`, and friends.
  First catch on arrival: 4 dead imports.
- ESLint flat config, `strictTypeChecked` + `stylisticTypeChecked`,
  type-aware, `--max-warnings 0`. First run: 109 findings, 0 of them a
  soundness bug. Project-invariant layer: `eqeqeq`,
  `switch-exhaustiveness-check`, no `Bun` global in src, `JSON.parse`
  only in the parser, kernel throws `KernelError` only. Non-null
  assertions stay allowed in `src/kernel` (hot-path index access under
  `noUncheckedIndexedAccess`) and are banned in boundary code.
- Typed errors, no Effect: `KernelError` now carries a `code` from a
  17-value union (72 throw sites retyped), `ParseError` maps to code
  `parse`, and `src/result.ts` + `tryStep` in the checker convert throws
  to data at the boundary. `main.ts` decides exit codes from the typed
  kind, not instanceof chains. Moving `KernelError` to
  `src/kernel/error.ts` also removed a latent env↔expr import cycle.
- Ratchets in CI: type-coverage --strict **98.55%** floor (`--at-least
  98.5`), knip clean after pruning one dead re-export, one duplicated
  function (`recMajorInduct` in env.ts), and 15 unused exports.
  Suppression policy: zero in `src/kernel`, same-line reason elsewhere;
  `scripts/check-suppressions.sh` enforces it. Current count: zero
  suppressions anywhere.

What the oracles said:
- Arena after the refactor: **199/199** (good 127/127, bad 72/72).
- Perf, same machine: magma-list-deep-n21 3.56 s → 3.63 s, init-prelude
  0.278 s → 0.286 s. Within noise.
- Bug replay 1 (`u_1` underscore removed): tsc 0 errors, eslint 0
  findings, 22/22 unit tests pass. ONLY the arena oracle refuses
  (exportMismatch on PUnit.rec). No static rule earns this bug.
- Bug replay 2 (instantiate pop order swapped): tsc 0, eslint 2
  incidental findings, **4 unit tests fail**. Tests own this bug.
- StrykerJS on `src/kernel/level.ts` against `tests/level.test.ts`
  alone: mutation score **51.8%** (187 of 361 mutants killed, 10 s).
  Honest reading: the level unit tests kill half the mutants; the
  arena suite is the real net but is too slow to run per mutant.
  Raising this score is future test work, now with a number on it.

One more dead idea for the record: a never-returning `invalid()` helper
was supposed to satisfy the restricted-throw rule in `inferProj`, but
TypeScript does not narrow after a never-call the way it narrows after
`throw`. The throw stays inline with a shared message helper.

A process bug, kept honestly: the bug replays restored files with
`git checkout --` while the day's fixes were still uncommitted, which
silently reverted the lint fixes in `expr.ts` and `name.ts`, and that
state got committed. `bun run verify` caught it on the next run. The
lesson for the method: replay a bug with a reversible stash or patch,
never with checkout against a dirty tree, and run the full verify gate
immediately before the commit, not after.

## 2026-10-16 — The book exists, as a verified correspondence

The brief, after one deepening pass: not a parallel text (code next to
math) but a proved map between them. Chapters cite rules; a registry
(`book/rules.json`, 37 rules) maps each rule to a literal anchor in the
vendored thesis LaTeX, a symbol in the vendored Lean 4 kernel source at
githash 5045d005, and a symbol in `src/`. `scripts/book-gates.ts` fails
CI when any citation breaks, in either direction. Soundness rules carry
forgeries; every `Try it` is a real file, typechecked, executed, and
diffed against the printed output in the chapter.

What was built: 12 chapters (`book/ch01..ch12.md`, cap 250 lines held,
ch05 lands exactly on 250), 12 runnable exercises (`book/tryit/`), 5
forgery pairs (`tests/forgery.test.ts` + `src/kernel/weaken.ts`), 4
fast-check properties (`tests/prop.test.ts`), 7 CI gates, and
`scripts/fetch-vendor-sources.sh` (vendor/ stays uncommitted; CI fetches
the cited files at pinned revisions).

Measurements of the day, each with the command:

- `bun test tests/forgery.test.ts`, first run: **6/10**. The finding
  that forced a design decision: tean refuses the inductive-family
  forgeries TWICE — once by the named rule, once by derive-and-compare
  (`exportMismatch`). With only the named rule off, the net still
  refuses. Decision, recorded in the test and in `book/forgeries/README.md`:
  the weakened runs for WF-IND-POS and WF-IND-UNIV also set
  WF-REC-DERIVE (trust the export), which is the posture the historical
  attacks assumed. Second finding: `bad/bugs/rec-k-lie` is a
  WF-REC-DERIVE forgery, not a K-guard forgery — its `k: true` lie dies
  in the compare. The true K-guard forgery is `100_ruleKbad`
  (`typeMismatch`). The attack-surface map is now explicit: which net
  catches which forgery class.
- `bun run scripts/book-gates.ts`, first run: **4 real failures**. The
  wrap-aware reference scan missed next-chapter titles broken across
  quote-block lines (`"> "` markers) — the gate now strips them; and two
  files cited the flag RED-K-GUARD as if it were a rule id. The gates
  paid for themselves before the first commit that carries them.
- `bun run verify`: green end to end. 36 tests, type-coverage **98.74%**
  (floor 98.5), knip clean, zero suppressions, book gates
  12 chapters / 37 rules / 32 terms.
- `bun run scripts/arena.ts --timeout 240 --jobs 6 --exclude
  magma-list-deep-n36` after the weaken-flag branches went into four
  kernel sites: **198/198** (good 126/126, bad 72/72).
  magma-list-pair-n21 at 43.8 s, app-lam at 8.8 s — within the noise of
  the 2026-10-15 numbers. The flags cost nothing measurable.

Vendored for citations: Carneiro's thesis LaTeX
(github.com/digama0/lean-type-theory, master) next to the six cited
kernel C++ files. The registry's thesis anchors are literal substrings
of the .tex files, so the gate greps them mechanically.

What the book does NOT claim, in print (ch12): reader evidence. The
think-aloud sessions and the posttest against the PLAN.md bar are
uncollected. Chapters 1–7 hold the language rules (no Lean syntax, no
repo pointers) in prose; the gate apparatus lives in HTML comments.

## 2026-10-16 — The real corpora: built, not downloaded

Asked: can we check real-world Lean proofs beyond the 199-test tarball?

- The hosted arena has 8 real-world corpora: init (331.5 MB), std
  (569 MB), con-leche (526 MB), cedar (832 MB), navier-stokes-euler
  (1.5 GB), cslib (2.3 GB), mathlib (5.8 GB), plus init-prelude. They are
  NOT downloadable: `lka.py` caches builds locally only (`cache_key` in
  results.json is a local cache key).
- Built init and std ourselves: elan toolchain v4.34.1 (the exact githash
  this kernel is ported against), lean4export master pinned to that
  toolchain, scaffold projects with `import Init` / `import Std`, exactly
  as `lka.py` does for leanfile tests. Export took 13 s and 20 s.
- Verification against the arena metadata: init 347,555,345 bytes /
  6,487,065 lines; std 596,655,086 bytes / 10,826,639 lines — both match
  the published size and line counts.
- Also built the arena's `official` checker (the C++ kernel behind an
  ndjson reader) on this machine, as the differential oracle.

Engineering the corpora forced:
- Streaming line reader in checkFile: std at 569 MB exceeds V8's maximum
  string length (~512 MiB), so `readFile` into one string cannot work.
- The failure-ranking tool from the original plan (`--keep-going` now
  attributes `unknownConstant` cascades to their roots and ranks roots by
  blocked count).
- A per-declaration trace mode (`TEAN_TRACE_FROM`): a hang must name its
  declaration, and an after-the-fact timer cannot, because a checking
  declaration blocks the event loop.
- A whnfCore churn profiler (`TEAN_DEBUG_CHURN`): counts reductions by
  head constant with sample terms, printable mid-hang.

## 2026-10-16 — init: found two algorithmic bugs, then a full pass

First run on init hung after 20,140 declarations (26 s of progress, then
forever). The tools above named everything:

- **Bug 1: the fvar gate starved the Nat fast path.** The hang was
  `Char.ofOrdinal._proof_3` (a `grind` arithmetic certificate). Churn:
  millions of `Nat.rec`/`Nat.beq._f` steps descending from ~2^32 — the
  kernel evaluating `Nat.beq` by unary recursion, four billion steps. The
  C++ kernel gates `reduce_nat` inside lazy delta on `!has_fvar` for BOTH
  sides; let-bound fvars are syntactically fvars while definitionally
  closed, so the gate starved the literal fast path and `Nat.beq`
  delta-unfolded into its `._f` form. Fix: run reduceNat ungated in the
  lazy-delta loop (sound: it returns null unless both arguments evaluate
  to literals). A deliberate, documented deviation from the C++ code.
  Repro went from non-terminating to 5 s.
- **Bug 2: recursive literal arithmetic overflowed the stack.** Six
  `Int32/Int64/ISize instRxcHasSize_eq` lemmas died at "Maximum call
  stack size exceeded": the mutual recursion reduceNat → whnf → reduceNat
  through deep nested-arithmetic chains. Fix: `natEvalToLit`, an
  explicit-stack evaluator for the arithmetic spine; only non-arithmetic
  boundaries still cost a JS frame.
- **Result: init passes whole.** 59,623 declarations accepted.
  Ours: **22.2 s**. The official C++ kernel, same machine, same file:
  **35.1 s**. (Arena-machine official time: 54.6 s.) We are faster than
  the official kernel on this corpus on this machine.
- Worker stack: a Node worker with `resourceLimits.stackSizeMb: 2000`
  measured **21,842,852 frames**, 34x the macOS main-thread maximum.
  run.sh now uses it (`TEAN_WORKER_STACK_MB`).

## 2026-10-16 — std: 99.99% and an honestly ranked open root

- std under keep-going: **104,050 of 104,056 declarations pass**. The 6
  failures are the same SInt range-lemma family, which passes in init but
  times out in std's context; with the 2 GB worker stack the overflow
  became a >600 s computation, so the root is algorithmic, not depth.
- Total std time 13.5 min vs official 60 s on this machine: ~13x. Churn
  profiling attributes the bulk to SYMBOLIC evaluation inside
  `Std.Tactic.BVDecide` proofs: tens of millions of whnfCore steps
  unfolding `DHashMap.Internal.Raw₀.insert` over free variables. The
  official kernel resolves those comparisons without this unfolding.
  That divergence is the top-ranked open root. The ranking, the churn
  dumps, and the repro prefix are preserved; the hunt continues from
  there, not from scratch.
- Regression gates after both kernel changes: local arena **199/199**,
  magma-list-deep-n21 3.48 s, init-prelude 0.295 s — all within noise.

Method note, kept for the book: every step of this day used the same
loop — heartbeat to find the declaration, churn counter to find the
constant, stack probe to find the call path, then one measured fix. No
fix went in without a number before and after.

## 2026-10-16 — The book reviewed against its own gates, then fixed

Asked: review book/ from the raw sources — citations against the vendored
thesis and kernel, every number against this file, a simulated first read
of chapters 1–7 — then apply the fixes.

- Registry audit, 14 of 37 rules sampled against the vendored LaTeX and
  C++: T-LIT cited `nat_lit_ext`, which is not a symbol (real:
  `infer_lit`); RED-IOTA cited the right symbol in the wrong file (it
  lives in inductive.h); DEFEQ-ETA resolved only via a call site (real:
  `try_eta_expansion_core`); the T-PROJ/RED-PROJ notes said the thesis
  "compiles projections away" — it never mentions projections; and
  WF-DECL-TYPE's "distinct universe parameters" is a kernel premise, not
  the thesis's (which requires containment). All five fixed in rules.json.
- Numbers: 33 of ~40 prose numbers trace to this file. Two were wrong in
  the book: "three ranked fixes to 195" (this file records two), and
  chapter 10 called magma-n21's 10.1 s "the hardest perf test" while the
  48 GB row belongs to n36. Chapter 12 credited the two init-corpus bugs
  to an afternoon with the arena board's checkers; this file says churn
  profiling. All corrected in the chapters.
- A simulated reader of ch1–7 (a model in role — NOT reader evidence; that
  open row stands) logged every stall. Worst: ch6 uses "eliminate into
  Prop" one chapter before elimination exists; systemic: the [R: …] tags
  were never explained anywhere. Fixed with glosses and one sentence in
  ch1 at first use.
- New machinery: book/RULES.md, generated from rules.json by
  scripts/gen-rules-appendix.ts — plain-English name, meaning, statement,
  and pinned links (thesis blob + v1.0 PDF, lean4 blob at 5045d005, src)
  per rule. Every [R: ID] in the chapters now links to its anchor. Gate 8
  fails CI when the appendix is stale or a link target is wrong; gate 2
  now requires exactly one Claim; chapters 9/10/12 claim-tests gained grep
  needles; every References entry now carries a verified URL; CI gained a
  lychee link check (403 accepted: DOI bot walls).
- Checks after: `bun run verify` green end to end, all 12 Try-it outputs
  byte-identical, every external URL verified live (one 403 bot wall at
  dl.acm.org; the DOI resolves).

Meaning: the gates held the machine-checkable spine — zero broken
citations, zero Try-it drift — while five registry legs and three prose
numbers were quietly wrong. That is exactly the gap between "the anchor
resolves as a string" and "the anchor says what the book says it says".
The citation gate now checks one level deeper, and the tags finally face
the reader.

## 2026-10-16 — The other 21 rules, and the substring gate that hid them

Asked: the first audit sampled 14 of 37 rules. What is in the other 21?

Nine more errors, four of them wrong rather than weak:

- **DEFEQ-ARGS cited the wrong function.** It named `is_def_eq_app`, the
  congruence *fallback* reached only after lazy delta fails
  (type_checker.cpp:1230, after :1206). The cheap argument test that runs
  *before* unfolding — which is what the rule id says and what chapter 5's
  prose describes — is `is_def_eq_args`, called at :1039 inside
  `lazy_delta_reduction_step`. Repointed to it; the chapter needed no edit
  once the registry told the truth.
- **DEFEQ-ETA-STRUCT** cited `try_eta_struct`, a call site at :1236; the
  definition is `try_eta_struct_core` at :889. Same shape as `nat_lit_ext`.
- **RED-QUOT** cited `quot_reduce_rec` to type_checker.cpp, which only
  calls it at :395; it is defined in quot.h:39. quot.h was not in
  fetch-vendor-sources.sh at all, so citing it correctly also meant
  vendoring it — added, re-fetched, byte-identical to upstream.
- **WF-NAME-FRESH's note** said the rule is implicit in "the thesis's
  notion of an environment as a function". The thesis never uses the word
  environment: `grep -ril environment vendor/lean-type-theory/` returns
  nothing. What it does say (axioms.tex:98) is that a constant declaration
  introduces "a new name". Its meaning also claimed arena forgeries
  redeclare `Nat.rec`; 135_dup_rec_def contains no `Nat` at all.
- Corrected as misleading: **LVL-LEQ** (the kernel does *not* decide level
  equality by two-way inequality, and `is_geq` has exactly one caller —
  the inductive universe bound), **LVL-NORM** (the thesis has no level
  normalization anywhere), **RED-NAT** (gcd, mod, div and the bitwise ops
  are unbounded; and no local arena test targets the bounds, contrary to
  the note and to this notebook's earlier, looser claim), **WF-THM-PROP**
  (the kernel stores and unfolds theorem values — declaration.h:467 —
  erasure is the compiler's), **WF-IND-SPEC** (the mutual-block checks it
  described live in `check_inductive_types`, not `check_constructors`),
  **WF-QUOT** (the kernel's four are Quot/mk/lift/ind; the thesis's fourth
  is `sound`, which arrives as an ordinary axiom), **DEFEQ-UNIT-LIKE**,
  **WF-DEF-VAL** (an unmeasured "most of the checker's time").
- **My own ch03 gloss was wrong too.** Fixing LVL-LEQ exposed it: the
  sentence I added earlier the same day said the checker decides the
  inequality "with a case-split rule on each variable ... so trying both
  covers all instantiations". `is_geq_core` has no substitution and no
  case split. The chapter now attributes the case split to the published
  theory and says the kernel implements a cheaper descent that refuses
  some true inequalities and accepts no false ones.

The root cause was one line: gate 5 resolved a symbol with
`text.includes(symbol)`. That accepts a substring of a longer identifier,
a bare call site, and a symbol defined in a different file. Tightened to
require a definition-shaped match (line start, optional return type or
qualifier chain containing no `=`, `(` or `;`, a word boundary, then the
symbol and its parameter list). Validated both ways: all 37 corrected
rules pass, and five negative controls fail, including every error shape
found today.

Gate negative tests, run for the first time rather than asserted: each of
the six new or changed checks was given a mutation and had to go red —
stale appendix, registry edited without regenerating, citation linked to
the wrong anchor, citation left unlinked, a second Claim block, and a
claim-test needle absent from its evidence file. All six caught, each with
the right message; baseline restored green afterwards.

Meaning: the first audit's lesson was that a resolving anchor can still be
the wrong anchor. The second one sharpens it: 14 of 37 rules was not
enough to conclude anything about the other 23, and the one mechanical
check standing behind all 111 citation legs was the weakest link in the
chain. Two of today's nine errors were introduced or propagated by the
same session that was fixing the others, which is the argument for the
gate rather than for more care.

## 2026-10-17 — README rewritten; every claim in it re-measured today

Asked: rewrite README.md for a reader who has never heard of this, lead
with the book, and verify every number and command in it rather than
quoting this file.

Re-ran, on this machine, everything the new README asserts:

- `bun check` clean; `bun test` **36 pass, 1255 expect() calls**, 75 ms.
- `bun run book:gates` green: 12 chapters, 37 rules, 32 terms.
- `bun test tests/forgery.test.ts` **10 pass**, 33 ms.
- `bun run book/tryit/ch01.ts` prints `(fun x : Nat => (f x))` / `nodes: 5`.
- `./run.sh vendor/good/init-prelude.ndjson` silent, exit 0, 0.37 s.
- `./run.sh vendor/bad/tutorial/054_indNeg.ndjson` and
  `./run.sh book/forgeries/WF-IND-POS.ndjson` both print the positivity
  refusal and exit **1** (identical files; the forgery is that arena test).
- `bun run scripts/arena.ts` with defaults: **198/199**.
  `magma-list-deep-n36` is recorded `crashed` at 60.5 s because the
  default timeout is 60 s and run.sh sets a 16 GB worker heap.
- `bun run scripts/arena.ts --timeout 240 --jobs 6 --exclude
  magma-list-deep-n36`: **198/198** (good 126/126, bad 72/72).
  app-lam 10.0 s, magma-list-pair-n21 50.3 s, both within noise of
  2026-10-15.
- `TEAN_WORKER_HEAP_MB=48000 ./run.sh
  vendor/good/perf/magma-list-deep-n36.ndjson` under `/usr/bin/time -l`:
  **accepted, 99.39 s real, 17,292,574,720 bytes max RSS** (16.1 GiB,
  quoted as 17.3 GB decimal in the README).

Correction to the 2026-10-15 entry's shorthand. That row said "111 s with
a 48 GB Node heap (it aborts at 16 GB)", which reads as though the test
needs 48 GB. It does not. Resident usage is 17.3 GB; 48 GB is the
*ceiling* that has to be set so the collector does not abort near the
limit. So 199/199 holds, and the condition for it is one env var, not a
96 GB machine. The README states it that way.

Also measured, for positioning rather than correctness: the hosted arena
board now lists **27 checkers** (Rust, Python, Haskell, Java, Fortran,
COBOL, and others). None are in TypeScript or JavaScript. The 14 vendored
Lean kernel C++ files total **6,198 lines**; `src/` totals **5,120**.

Link check: all 18 external URLs in the new README return 200
(`curl -s -o /dev/null -w '%{http_code}' -L`), and the three relative
links resolve. The thesis repository is `digama0/lean-type-theory`;
`lean4-type-theory` 404s, so any future citation must use the former.

Meaning: the README now makes no claim this file cannot back, and the one
headline that would have drawn fire on Zulip ("faster than the official
kernel") carries its scope and its counterweight in the same table.

## Open questions

- ~~What is the arena submission interface?~~ Answered: a PR to
  leanprover/lean-kernel-arena adding `checkers/tean.yaml` that points at a
  public git revision. Exit codes: 0 accept, 1 reject, 2 decline, else bug.
  Draft in `checker.yaml`. The repository must be published first.
- ~~What do `bad/perf` tests expect?~~ Answered: a refusal. They target the
  kernel's own resource bounds (the 128 MB Nat limit), and the ported
  bounds refuse them.
- Why does magma-list-deep-n36 need more than 16 GB here and less than
  10 GB elsewhere? Suspect: bytes per expression node in JS. Measure with
  a heap profile before changing the representation.
- ~~The hosted corpora are not local.~~ Done 2026-10-16: init and std
  built and measured. init passes whole; std has one ranked open root
  (symbolic BVDecide evaluation, plus the SInt lemma family). Next
  corpora by size: con-leche (needs Lean 4.33), cedar, then mathlib.
- Why does the official kernel avoid the symbolic `DHashMap.insert`
  unfolding that costs us 13x on std? Read the C++ lazy-delta path once
  more against a captured defeq pair from the BVDecide churn.
- H8 and the "level shape in the hash" half of H2 still need measurements.
- The book's reader evidence: three to five think-aloud sessions, the
  posttest against the bar in PLAN.md, an independent fact check, and one
  non-programmer reader for chapters 1–3. None collected as of 2026-10-16.
