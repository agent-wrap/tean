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
| Γ ⊢ e : α | in context gamma, e has type alpha | The judgment the whole book computes. Γ (gamma) lists the variables in scope with their types; ⊢ is called a turnstile. | [1](ch01.md) |
| #0, #1, #2 | bee-var zero, bee-var one | A variable written as the number of binders between it and the binder it belongs to. #0 is the nearest. | [2](ch02.md) |
| e[a/x] | e with a for x | Replace the variable x by the term a throughout e, renumbering indices so nothing is captured. | [2](ch02.md) |
| Sort 0, Sort 1, … | sort zero, sort one | The tower of universes. Sort 0 is Prop (propositions); Sort 1 is Type (data types); Sort (l+1) holds Sort l. | [3](ch03.md) |
| imax(l₁, l₂) | eye-max of ell-one and ell-two | The level of a function type. Collapses to 0 when the result is a proposition, however large the domain. | [3](ch03.md) |
| e ⇝ e′ | e reduces to e-prime | One computation step. The rules are beta, zeta, delta, iota, and the primitives of chapters 9 and 10. | [4](ch04.md) |
| a == b | a is definitionally equal to b | Equal up to computation. This is structural typing with programs inside the shapes, so deciding it means running them. | [5](ch05.md) |
| s.i | s dot i | Field i of a structure value. Typed by walking the constructor's telescope; reduces only against a literal constructor application. | [7](ch07.md) |
| C | the motive | What the recursor is proving or building, as a family over the type and its indices. | [8](ch08.md) |
| Quot r | quote r | The type where r-related elements are identified. Four kernel-built constants and one computation rule. | [9](ch09.md) |

## Words

| Term | Say it | What it means | Ch. |
|---|---|---|---|
| **kernel** | kernel | The small component that checks proofs. The only part of a proof assistant that has to be correct. | [1](ch01.md) |
| **environment** | environment | The map from names to already-checked declarations. It only ever grows, and a name may enter it once. | [1](ch01.md) |
| **declaration** | declaration | What the kernel is handed: a name, a stated type, and — for a definition — a value. | [1](ch01.md) |
| **bound variable** | bound variable | A variable introduced by a binder inside the term. Written as an index, never as a name. | [2](ch02.md) |
| **free variable** | free variable | A serial-numbered stand-in used while the checker works under a binder. Its type lives in a side table. | [2](ch02.md) |
| **alpha-equivalence** | alpha-equivalence | Sameness up to renaming bound variables. With indices instead of names it costs nothing: equal terms are equal trees. | [2](ch02.md) |
| **impredicativ** | impredicativity | A proposition may quantify over all propositions and stay a proposition. True of Prop only; the data rungs are predicative. | [3](ch03.md) |
| **weak head normal form** | weak head normal form | Reduce at the head until the head is a binder, a sort, or stuck — and stop. Never under a binder, never an argument. | [4](ch04.md) |
| **whnf** | double-you-h-n-f | The usual abbreviation for weak head normal form, and the name of the function that computes it. | [4](ch04.md) |
| **beta** | beta | Apply a function: substitute the argument into the body. | [4](ch04.md) |
| **delta** | delta | Unfold a constant that has a definition, substituting the use site's universe levels into its value. | [4](ch04.md) |
| **zeta** | zeta | Inline a let-bound name. A let is shared text, not an abstraction barrier. | [4](ch04.md) |
| **definitional equality** | definitional equality | The relation above, as a noun. Sound but incomplete, and — because of proof irrelevance — not transitive. | [5](ch05.md) |
| **proof irrelevance** | proof irrelevance | Any two proofs of one proposition are definitionally equal. The source of both warts in the line above. | [5](ch05.md) |
| **conversion rule** | the conversion rule | The typing rule that calls definitional equality: an argument's type must match the function's domain up to computation. | [5](ch05.md) |
| **eta** | eta | A function equals its own one-step wrapper: f == fun x => f x. Chapter 7 adds the version for records. | [5](ch05.md) |
| **inductive type** | inductive type | A data type declared by the input file: a name, some constructors, their types. The kernel reviews it before accepting. | [6](ch06.md) |
| **telescope** | telescope | A chain of binders where each type may mention the variables before it. A constructor's type is one. | [6](ch06.md) |
| **parameter** | parameter | An argument of the declared type that is fixed across every constructor — a list's element type, for instance. | [6](ch06.md) |
| **positivity** | strict positivity | The declared type may appear as the result of a constructor argument's type, never to the left of an arrow inside it. | [6](ch06.md) |
| **subsingleton** | subsingleton | A proposition with one constructor whose every field is forced by the result type. Nothing about it can vary. | [6](ch06.md) |
| **structure** | structure | A data type with exactly one constructor. Earns field access and two extra definitional equalities. | [7](ch07.md) |
| **recursor** | recursor | The constant the kernel gives back for a data type: `reduce` for that type, whose type is its induction principle. | [8](ch08.md) |
| **minor premise** | minor premise | One per constructor: show the motive holds there, given it holds for every recursive argument. | [8](ch08.md) |
| **major premise** | major premise | The value actually being destructed — the last argument of the recursor. | [8](ch08.md) |
| **iota** | iota | The recursor's computation rule: applied to a constructor, select that constructor's minor premise and recurse. | [8](ch08.md) |
| **K-like** | K-like reduction | Fire iota on a subsingleton proof without inspecting it — guarded by a definitional-equality check that is itself a soundness rule. | [9](ch09.md) |
| **NDJSON** | en-dee JSON | Newline-delimited JSON: the export format, one object per line, with growing tables of names, levels and expressions. | [10](ch10.md) |
| **lean4export** | lean-four-export | The tool that writes a checked Lean library out in that format, including the githash of the kernel that checked it. | [10](ch10.md) |

## Two conventions worth stating once

**The inference bar.** A rule written as a fraction —
premises above a horizontal line, conclusion below — reads "if
everything above the line holds, then the thing below it holds".
Chapter 3 is the first to use one.

**Rule tags.** `[R: T-APP]` in a chapter is a citation into
[the rules appendix](RULES.md), where every rule of the type theory is
given in plain English with links to the published theory, the Lean 4
kernel source, and this checker. On a first read they are footnotes.
