# First deliverable: the claim, the reader, the chapters, the gates

Date: 2026-10-15. Status: proposed. Code starts after this page, chapters start
after the record exists.

## The claim, defended

> A proof checker is small enough for one person to understand and expensive
> enough to surprise them, and you only learn the second half by building one
> and pointing it at a real library.

Seven books teach the theory. None of them keeps the measurement record: the
eleven hypotheses, the eight that were wrong, and the number that killed each
one. That record is the book. The theory is its first part, not its subject.
This defence holds only if the record is real, so the notebook rule in
`docs/NOTEBOOK.md` is the foundation of the claim, not a chore beside it.

## The reader

A second-year computer science undergraduate. They wrote a tokeniser. They
read TypeScript. They met structural induction once. They never met a proof
assistant.

## The three exit tasks

1. Read a kernel term as data and say what it means, including a de Bruijn
   index and a universe level.
2. Say which of two claims holds by computation alone, and why, for a function
   whose recursion is given.
3. Transfer: given an unseen reduction rule, say whether a kernel that lacks
   it accepts a false proof, and name the shape of the counterexample.

## The posttest for task three, fixed now

Give the reader three kernel features they have not seen in these words:

- A: zeta reduction, which unfolds a `let` during equality checking.
- B: the strict positivity check on an inductive declaration.
- C: the rule that a recursor must be derived from its inductive, not read
  from the input.

Question: for each one, a kernel lacks it. Does that kernel accept a false
proof? If yes, name the shape of the forgery. If no, say what the kernel loses
instead.

Correct answers: A no, the kernel only rejects some true proofs, because a
missing reduction loses completeness, not soundness. B yes, a negative
inductive gives a proof of `False`. C yes, a forged recursor proves `False`.

Pass bar, fixed in advance: at least two of three readers get the
soundness direction right on all three, and name a correct forgery shape for
B or C.

A fourth question, added 2026-10-17, for a rule no chapter states: the
kernel's "is this a proposition?" predicate reduces an inferred type and
looks for `Sort 0`; suppose that on a STUCK type it answers false rather
than refusing the term. Does that kernel accept a false proof? (Yes: it
walks past the proof-irrelevance guard on projections, and a data field
can be pulled out of a value treated as a proof. This was a real Lean 4
soundness fix, PR #14807, after this book's pinned githash — so it is
genuinely unseen, and the answer is not guessable from the shape of the
question.)

## The chapters, fourteen, one claim each, 250 lines of prose at most

1. **Three nodes.** The untyped lambda calculus: free and bound variables,
   capture-avoiding substitution, beta. (Reworded 2026-10-20. It was
   "A proof is data: a checker is a pure function from data to a yes or
   a no"; that framing, with declarations, the environment and the
   `check` signature, moved to chapter 3, where `Sort` exists and the
   rule that a declaration's type must be a sort can be stated without a
   forward reference. The book now opens on `x | fun x => e | e e` and
   climbs, the order the Typechecker Zoo and TAPL use.)
2. **Variables without names.** Binding is arithmetic: the de Bruijn index.
3. **Types are terms.** One grammar holds both, and Girard's paradox forces
   the universe ladder.
4. **Computation is substitution.** Type equality needs an interpreter: beta
   and `whnf`.
5. **The judge.** The whole checker is two mutually recursive functions,
   `infer_type` and `is_def_eq`.
6. **Data types are contracts.** The kernel must verify an inductive
   declaration, never accept it. Positivity and universe levels.
7. **Structures and projections.** One constructor earns field access and
   two more equalities; each is a rule that has to be right.
8. **Recursion from data.** A recursor is derived, never trusted. Iota.
9. **Two more primitives.** K-like reduction and the quotient, each safe
   only because of the check in front of it.
10. **The real input.** A real export file finds shapes nobody writes by hand.
11. **The conventions.** Agreeing with a kernel means agreeing with the
    choices it made below the level of the published theory.
12. **The cost.** Faster than the official kernel on a real library,
    catastrophic on one adversarial case; every number measured.
13. **The adversary.** A red team finds absent checks. Soundness is tested
    with forgeries.
14. **The arena.** A checker is only checked when somebody who is not its
    author checks it.

Language rules: no Lean syntax before chapter 10, no pointer at our code or
commands before chapter 10.

Content rule, added 2026-10-17: the book describes the checker as it is
and the type theory as it is. The history of how the code reached its
current state belongs in `NOTEBOOK.md`, not in a chapter.

## The gates, in CI from week one

- `bun check` passes with strict TypeScript, and `bun test` passes.
- The checker accepts every arena `good` test and refuses every arena `bad`
  test, or the failure is listed in the notebook with a reason.
- When chapters exist: every claim names a test that exists, every reference
  resolves with a wrap-aware checker, no term is used before it is defined,
  every `Try it` block runs in CI and its printed output matches the text,
  and every chapter links to the next.

## Assumptions, each with the measurement that settles it

- The seed record from the deleted build is a list of hypotheses, not facts.
  The measurement for each one is listed in `docs/NOTEBOOK.md`.
- Assumption: a TypeScript checker can pass the arena suite within its time
  budget. Settled by: a full local arena run, then a submission.
- Assumption: the reader profile is reachable in fourteen chapters. Settled by:
  the think-aloud sessions and the posttest, against the bar above.
