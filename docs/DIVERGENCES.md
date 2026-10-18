# Divergences from the C++ kernel

The book's spine is a verified correspondence: every rule in
[`book/rules.json`](../book/rules.json) names the symbol in the Lean 4
kernel (githash `5045d005`) that implements it, and CI fails when a
citation does not resolve. A correspondence is only worth something if
the places it does **not** hold are written down too.

This file is that list. A rule carrying a `divergence` entry in the
registry must appear here, and the book gates enforce it in both
directions: a divergence that is not documented fails the build, and a
heading here that names no registered rule fails it as well.

A divergence is a *deliberate* difference in behaviour, chosen and
measured. It is not a bug, not an abbreviation, and not an engineering
decision that leaves semantics alone. Streaming the input file instead
of reading it whole, running on a worker thread with a larger stack,
caching unfolds in a different data structure — none of those are
divergences, because no input changes its verdict.

---

## RED-NAT — literal arithmetic runs ungated inside lazy delta

**What the C++ kernel does.** During lazy delta reduction, before
unfolding either side, the kernel may try to evaluate a nat-literal
operation. It guards that attempt on `!has_fvar` for *both* sides: if
either term mentions a free variable, `reduce_nat` is not attempted and
the loop goes on to unfold.

**What this checker does.** It attempts `reduceNat` on both sides
unconditionally, with no `hasFVar` guard
([`src/kernel/tc.ts`](../src/kernel/tc.ts), `lazyDeltaReduction`).

**Why.** The C++ guard is a cost guard, not a soundness guard — it
exists to avoid a pointless evaluation attempt on terms that obviously
cannot be literals. But `hasFVar` is *syntactic*: a let-bound free
variable makes the flag true while the term is definitionally closed and
does reduce to a literal. On Lean's own prelude that gap is not
academic. Checking `Char.ofOrdinal._proof_3` — an arithmetic certificate
produced by a tactic — the guard sends `Nat.beq` down its unary
recursive unfolding instead of its literal fast path, measured at
roughly 4.3 × 10⁹ reduction steps descending from 2³². With the guard
removed, the same declaration checks in about five seconds.

**Why it is sound.** `reduceNat` returns `null` unless *both* arguments
reduce to literals. Attempting it on a term containing free variables
can therefore only fail; it cannot produce a different answer, only the
same answer sooner. Dropping the guard can make the checker slower on
terms that genuinely never become literals, and that cost is paid in
exchange for the case above.

**How it is checked.** The local arena suite (199 files, 127 accept /
72 refuse) passes with the guard removed, as does the whole `init`
corpus. See [`NOTEBOOK.md`](NOTEBOOK.md), 2026-10-16.

**Direction of risk.** Completeness-increasing and performance-affecting
only. A term this checker reduces to a literal is one the C++ kernel
would also reduce to that literal, had it tried.

---

## Prior art

[lean4lean](https://github.com/digama0/lean4lean), the Lean-in-Lean
reimplementation, ships a `divergences.md` listing its own deliberate
departures with the reasoning for each. The practice is worth copying:
the alternative is a correspondence claim that is quietly false in
places only its author knows about.
