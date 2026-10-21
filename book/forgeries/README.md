# Forgery artifacts

Each file is named for the rule it attacks (see `../rules.json`) and is
exercised both ways by `../../tests/forgery.test.ts`: refused by the
normal kernel, accepted by a kernel with that one rule disabled
(`src/kernel/weaken.ts`).

Provenance: all five files come unmodified from the Lean Kernel Arena
test suite (<https://arena.lean-lang.org/>, Apache-2.0), downloaded
2026-10-15; see `docs/NOTEBOOK.md` for the download record.

| artifact | arena source | normal refusal |
|---|---|---|
| `WF-IND-POS.ndjson` | `bad/tutorial/054_indNeg.ndjson` | `inductive` (positivity) |
| `WF-IND-UNIV.ndjson` | `bad/tutorial/061_typeWithTooHighTypeField.mk.ndjson` | `universe` |
| `WF-REC-DERIVE.ndjson` | `bad/tutorial/073_BogusRecursor.ndjson` | `exportMismatch` |
| `RED-K-GUARD.ndjson` | `bad/tutorial/100_ruleKbad.ndjson` | `typeMismatch` |
| `WF-THM-PROP.ndjson` | `bad/tutorial/012_nonPropThm.ndjson` | `typeMismatch` |

`WF-THM-PROP` is the deliberate odd one out: a hygiene rule, not a
soundness rule. Its weakened acceptance proves nothing false, and
chapter 14 explains why the difference matters.

Honesty note: this checker refuses the inductive-family forgeries twice
over — once by the named rule, once by derive-and-compare. The weakened
runs for those also set `WF-REC-DERIVE` (trust the export), as the
historical attacks assumed. The test file documents this inline.
