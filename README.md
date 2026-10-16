# tean

A Lean 4 proof checker in TypeScript.

It reads a `lean4export` NDJSON file, re-checks every declaration against
the rules of Lean's type theory, and derives inductive recursors itself
rather than trust the ones in the file. The port follows the real kernel
sources at Lean 4.34.1, githash 5045d005.

## Run

```sh
devbox shell          # provides bun, node, elan

bun check             # typecheck (tsc, strict, erasable-only syntax)
bun test              # unit tests
./run.sh <file.ndjson>            # check one export file
bun run scripts/arena.ts          # the full local arena suite
```

The checker is one code base for two engines. `bun` runs the tests and the
typecheck. The arena runner executes the same files under Node with
`--stack-size` raised, because reduction depth on real proofs exceeds the
fixed 8 MB stack that Bun provides. The numbers are in `docs/NOTEBOOK.md`.

## Status

Against the Lean Kernel Arena local test suite (127 good, 72 bad):
see the latest entry in `docs/NOTEBOOK.md` and
`docs/measurements/`. Every `bad` test is refused.

## Layout

- `src/kernel/` — names, levels, expressions, environment, type checker,
  inductive validation, quotients
- `src/export/` — the NDJSON parser
- `src/checker.ts`, `src/main.ts` — declaration admission and the CLI
- `docs/NOTEBOOK.md` — the measurement record. Every number in any
  document traces to an entry here, with the command that produced it.
- `docs/PLAN.md` — the book plan: claim, reader, exit tasks, chapters,
  gates
- `checker.yaml` — the draft arena submission

## The book

The project carries a second deliverable: a book on building a Lean proof
checker from scratch, written from the notebook once the record exists.
The plan and the gates are in `docs/PLAN.md`. Chapters do not exist yet,
on purpose: the rule is that no chapter describes work that has not
happened.
