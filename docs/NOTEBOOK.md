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
- The hosted corpora (init, std, mathlib) are not local. Build the export
  of `std` with elan + lean4export, measure, and rank what fails.
- H8 and the "level shape in the hash" half of H2 still need measurements.
