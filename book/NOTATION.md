# The notation card

<!-- Generated from terms.json by scripts/gen-notation-card.ts. -->
<!-- Do not edit by hand: the book gates compare this file against a -->
<!-- fresh generation and fail CI on any difference. -->

One page to keep open while reading. Every symbol and every piece of
jargon the book uses, how to say it out loud, what it means, and the
chapter that earns it. Nothing here is a prerequisite — each entry is
explained properly where it first appears.

## Symbols

| Notation | Say it | What it means | Ch. |
|---|---|---|---|
| e[a/x] | e with a for x | Replace every free occurrence of x in e by a, capturing nothing: by renaming binders with names, by renumbering with indices. | [1](ch01.md) |
| #0, #1, #2 | bee-var zero, bee-var one | A variable written as the number of binders between it and the binder it belongs to. #0 is the nearest. | [2](ch02.md) |
| Γ ⊢ e : α | in context gamma, e has type alpha | The judgment the whole book computes. Γ (gamma) lists the free variables in scope with their types; ⊢ is called a turnstile. | [3](ch03.md) |
| T -> U | T to U | The type of a function that takes a T and returns a U. From chapter 4 on, the pi type whose result does not mention the argument. | [3](ch03.md) |
| Sort 0, Sort 1, … | sort zero, sort one | The tower of universes. Sort 0 is Prop (propositions); Sort 1 is Type (data types); Sort (l+1) holds Sort l. | [4](ch04.md) |
| imax(l₁, l₂) | eye-max of ell-one and ell-two | The level of a function type. Collapses to 0 when the result is a proposition, however large the domain. | [4](ch04.md) |
| e ⇝ e′ | e reduces to e-prime | One computation step. The rules are beta, zeta, delta, iota, and the primitives of chapters 10 and 11. | [5](ch05.md) |
| a == b | a is definitionally equal to b | Equal up to computation. This is structural typing with programs inside the shapes, so deciding it means running them. | [6](ch06.md) |
| s.i | s dot i | Field i of a structure value. Typed by walking the constructor's telescope; reduces only against a literal constructor application. | [8](ch08.md) |
| C | the motive | What the recursor is proving or building, as a family over the type and its indices. | [9](ch09.md) |
| Quot r | quote r | The type where r-related elements are identified. Four kernel-built constants and one computation rule. | [10](ch10.md) |

## Words

| Term | Say it | What it means | Ch. |
|---|---|---|---|
| **kernel** | kernel | The small component that checks proofs. The only part of a proof assistant that has to be correct. | [1](ch01.md) |
| **bound variable** | bound variable | A variable occurrence that belongs to an enclosing binder. From chapter 2 on, written as an index, never as a name. | [1](ch01.md) |
| **free variable** | free variable | A variable occurrence bound by nothing in the term. In the checker, a serial-numbered stand-in used while working under a binder; its type lives in a side table. | [1](ch01.md) |
| **alpha-equivalence** | alpha-equivalence | Sameness up to renaming bound variables. With indices instead of names it costs nothing: equal terms are equal trees. | [1](ch01.md) |
| **capture** | capture | A substituted term walks under a binder that uses one of its free names, and that name changes owner. The term changes meaning and nothing crashes. | [1](ch01.md) |
| **beta** | beta | Apply a function: substitute the argument into the body. | [1](ch01.md) |
| **derivation** | derivation | A tree of judgments, each the conclusion of a rule whose premises sit above it. The checker's recursion is one of these written as a call stack. | [3](ch03.md) |
| **environment** | environment | The map from names to already-checked declarations. It only ever grows, and a name may enter it once. | [4](ch04.md) |
| **declaration** | declaration | What the kernel is handed: a name, a stated type, and — for a definition — a value. | [4](ch04.md) |
| **Curry–Howard** | curry howard | Propositions are types and proofs are terms, so a proof checker is a type checker. Not a metaphor: proof irrelevance is a rule about terms. | [4](ch04.md) |
| **impredicativ** | impredicativity | A proposition may quantify over all propositions and stay a proposition. True of Prop only; the data rungs are predicative. | [4](ch04.md) |
| **weak head normal form** | weak head normal form | Reduce at the head until the head is a binder, a sort, or stuck — and stop. Never under a binder, never an argument. | [5](ch05.md) |
| **whnf** | double-you-h-n-f | The usual abbreviation for weak head normal form, and the name of the function that computes it. | [5](ch05.md) |
| **delta** | delta | Unfold a constant that has a definition, substituting the use site's universe levels into its value. | [5](ch05.md) |
| **zeta** | zeta | Inline a let-bound name. A let is shared text, not an abstraction barrier. | [5](ch05.md) |
| **definitional equality** | definitional equality | The relation above, as a noun. Sound but incomplete, and — because of proof irrelevance — not transitive. | [6](ch06.md) |
| **proof irrelevance** | proof irrelevance | Any two proofs of one proposition are definitionally equal. The source of both warts in the line above. | [6](ch06.md) |
| **conversion rule** | the conversion rule | The typing rule that calls definitional equality: an argument's type must match the function's domain up to computation. | [6](ch06.md) |
| **eta** | eta | A function equals its own one-step wrapper: f == fun x => f x. Chapter 8 adds the version for records. | [6](ch06.md) |
| **inductive type** | inductive type | A data type declared by the input file: a name, some constructors, their types. The kernel reviews it before accepting. | [7](ch07.md) |
| **telescope** | telescope | A chain of binders where each type may mention the variables before it. A constructor's type is one. | [7](ch07.md) |
| **parameter** | parameter | An argument of the declared type that is fixed across every constructor — a list's element type, for instance. | [7](ch07.md) |
| **positivity** | strict positivity | The declared type may appear as the result of a constructor argument's type, never to the left of an arrow inside it. | [7](ch07.md) |
| **subsingleton** | subsingleton | A proposition with one constructor whose every field is forced by the result type. Nothing about it can vary. | [7](ch07.md) |
| **structure** | structure | A data type with exactly one constructor. Earns field access and two extra definitional equalities. | [8](ch08.md) |
| **recursor** | recursor | The constant the kernel gives back for a data type: `reduce` for that type, whose type is its induction principle. | [9](ch09.md) |
| **minor premise** | minor premise | One per constructor: show the motive holds there, given it holds for every recursive argument. | [9](ch09.md) |
| **major premise** | major premise | The value actually being destructed — the last argument of the recursor. | [9](ch09.md) |
| **iota** | iota | The recursor's computation rule: applied to a constructor, select that constructor's minor premise and recurse. | [9](ch09.md) |
| **K-like** | K-like reduction | Fire iota on a subsingleton proof without inspecting it — guarded by a definitional-equality check that is itself a soundness rule. | [10](ch10.md) |
| **NDJSON** | en-dee JSON | Newline-delimited JSON: the export format, one object per line, with growing tables of names, levels and expressions. | [11](ch11.md) |
| **lean4export** | lean-four-export | The tool that writes a checked Lean library out in that format, including the githash of the kernel that checked it. | [11](ch11.md) |

## Two conventions worth stating once

**The inference bar.** A rule written as a fraction —
premises above a horizontal line, conclusion below — reads "if
everything above the line holds, then the thing below it holds".
Chapter 3 is the first to use one.

**Rule tags.** `[R: T-APP]` in a chapter is a citation into
[the rules appendix](RULES.md), where every rule of the type theory is
given in plain English with links to the published theory, the Lean 4
kernel source, and this checker. On a first read they are footnotes.
