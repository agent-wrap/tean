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

## Hypotheses carried from the deleted build, each unverified

Each one is a hint, not a fact. Status moves only with a measurement in this
file.

| # | Hypothesis | Status | Measurement that settles it |
|---|---|---|---|
| H1 | Cache per node: loose bvar range, node count, hash | unverified | time full arena run with and without |
| H2 | Hash must ignore binder names and level shape | unverified | defeq cache hit rate and wrong-hit count |
| H3 | Proof irrelevance must be three-valued | unverified | a prelude declaration that loops with two-valued |
| H4 | Beta must discharge the whole spine in one pass | unverified | time on beta-heavy tests, one pass vs per-arg |
| H5 | Never put a constructor in the computed-ops table | unverified | a term that loops lit↔ctor |
| H6 | A recursor must be verified, or a forgery proves False | unverified | arena bad test 073_BogusRecursor |
| H7 | String in recent Lean is a byte array with a proof | unverified | grep the prelude export for String.mk |
| H8 | Cheap test before expensive test in defeq | unverified | profile of defeq on the prelude |
| H9 | Hash-consing is slower despite high duplicate rate | unverified | not planned unless perf demands it |
| H10 | Deep recursion needs a big stack; read exit code, not clock | unverified | bad/perf and good/perf tests |
| H11 | Rank failures by blocked count, not by frequency | unverified | the failure ranking tool on first prelude run |

## Open questions

- What is the arena submission interface for an external checker? The README
  mentions `checkers/*.yaml`. Read the full README before the submission.
- What do `bad/perf` tests expect: a refusal, or survival within a budget?
  Read one before the first full run.
