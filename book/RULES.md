# The rules, in plain English

<!-- Generated from rules.json by scripts/gen-rules-appendix.ts. -->
<!-- Do not edit by hand: the book gates compare this file against a -->
<!-- fresh generation and fail CI on any difference. -->

Every `[R: …]` tag in the chapters lands here. Each entry gives the
rule's meaning, its formal statement, and the three places the build
verifies it against: Carneiro's thesis (*The Type Theory of Lean*),
the Lean 4 kernel at githash `5045d005`, and this
checker's source. Soundness rules also carry a forgery: an input the
normal kernel refuses and a kernel with exactly that rule disabled
accepts. A rule where this checker deliberately does not match the
C++ kernel carries a **Divergence** line pointing at
[docs/DIVERGENCES.md](../docs/DIVERGENCES.md).

| Rule | Name | Kind |
|---|---|---|
| [T-SORT](#t-sort) | the sort rule | typing |
| [T-VAR](#t-var) | the variable rule | typing |
| [T-CONST](#t-const) | the constant rule | typing |
| [T-APP](#t-app) | the application rule | typing |
| [T-LAM](#t-lam) | the lambda rule | typing |
| [T-PI](#t-pi) | the pi rule | typing |
| [T-LET](#t-let) | the let rule | typing |
| [T-PROJ](#t-proj) | the projection typing rule | typing |
| [T-LIT](#t-lit) | the literal typing rule | typing |
| [LVL-LEQ](#lvl-leq) | level inequality | level |
| [LVL-NORM](#lvl-norm) | level equality by normalization | level |
| [LVL-IMAX](#lvl-imax) | the imax collapse rule | level |
| [RED-BETA](#red-beta) | beta reduction | reduction |
| [RED-ZETA](#red-zeta) | zeta reduction | reduction |
| [RED-DELTA](#red-delta) | delta reduction | reduction |
| [RED-IOTA](#red-iota) | iota reduction | reduction |
| [RED-K](#red-k) | K-like reduction | reduction |
| [RED-QUOT](#red-quot) | quotient reduction | reduction |
| [RED-NAT](#red-nat) | literal arithmetic | reduction |
| [RED-PROJ](#red-proj) | projection reduction | reduction |
| [DEFEQ-BINDING](#defeq-binding) | congruence under binders | defeq |
| [DEFEQ-ARGS](#defeq-args) | spine congruence | defeq |
| [DEFEQ-ETA](#defeq-eta) | eta equality | defeq |
| [DEFEQ-ETA-STRUCT](#defeq-eta-struct) | structure eta | defeq |
| [DEFEQ-PROOF-IRREL](#defeq-proof-irrel) | proof irrelevance | defeq |
| [DEFEQ-UNIT-LIKE](#defeq-unit-like) | unit-like equality | defeq |
| [DEFEQ-STRING](#defeq-string) | string literal expansion | defeq |
| [WF-DECL-TYPE](#wf-decl-type) | declaration type well-formedness | wellformedness |
| [WF-DEF-VAL](#wf-def-val) | the definition value check | wellformedness |
| [WF-THM-PROP](#wf-thm-prop) | theorems prove propositions | wellformedness |
| [WF-NAME-FRESH](#wf-name-fresh) | name freshness | wellformedness |
| [WF-IND-SPEC](#wf-ind-spec) | the constructor shape rules | wellformedness |
| [WF-IND-POS](#wf-ind-pos) | strict positivity | wellformedness |
| [WF-IND-UNIV](#wf-ind-univ) | the universe bound | wellformedness |
| [WF-LARGE-ELIM](#wf-large-elim) | large elimination | wellformedness |
| [WF-REC-DERIVE](#wf-rec-derive) | recursor derivation | wellformedness |
| [WF-QUOT](#wf-quot) | quotient construction | wellformedness |

## Typing

<a id="t-sort"></a>

### T-SORT — the sort rule

The type of a universe is the next universe. This ladder has no top; chapter 3 shows why it cannot have one.

> `|- Sort l : Sort (l+1)`

- Thesis: [axioms.tex, at `subsection{Typing}`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`infer_type_core` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`inferTypeCore` in src/kernel/tc.ts](../src/kernel/tc.ts)

<a id="t-var"></a>

### T-VAR — the variable rule

A variable has the type its binder gave it. The checker replaces a bound variable with a free variable before it looks the type up. The thesis states the rule for the last binder plus weakening; the derived form that reads the type out of the context appears in its regularity section.

> `G |- A : Sort l  =>  G, x:A |- x : A, and with weakening, (x : A) in G  =>  G |- x : A`

- Thesis: [axioms.tex, at `subsection{Typing}`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`infer_fvar` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`inferFVar` in src/kernel/tc.ts](../src/kernel/tc.ts)

<a id="t-const"></a>

### T-CONST — the constant rule

A constant's type comes from the environment, with its universe parameters instantiated by the levels at the use site.

> `|- c.{ls} : type(c)[ls/us]`

- Thesis: [axioms.tex, at `Definitions ($\delta$ reduction)`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`infer_constant` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`inferConstant` in src/kernel/tc.ts](../src/kernel/tc.ts)

<a id="t-app"></a>

### T-APP — the application rule

Application checks the argument type against the domain up to definitional equality, then substitutes. This is where the conversion rule does its work: the thesis states application and conversion as two separate rules, and the kernel fuses them here.

> `G |- f : forall x:A. B   G |- a : A'   G |- A' == A  =>  G |- f a : B[a/x]`

- Thesis: [axioms.tex, at `subsection{Typing}`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`infer_app` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`inferApp` in src/kernel/tc.ts](../src/kernel/tc.ts)

<a id="t-lam"></a>

### T-LAM — the lambda rule

A lambda gets a pi type. The checker opens the binder with a free variable, infers the body, and closes the result.

> `G, x:A |- e : B  =>  G |- (fun x:A => e) : forall x:A. B`

- Thesis: [axioms.tex, at `subsection{Typing}`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`infer_lambda` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`inferLambda` in src/kernel/tc.ts](../src/kernel/tc.ts)

<a id="t-pi"></a>

### T-PI — the pi rule

A pi type lives in the imax of its parts. imax, not max: a function into a proposition is itself a proposition.

> `G |- A : Sort l1   G, x:A |- B : Sort l2  =>  G |- (forall x:A. B) : Sort (imax l1 l2)`

- Thesis: [axioms.tex, at `subsection{Typing}`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`infer_pi` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`inferPi` in src/kernel/tc.ts](../src/kernel/tc.ts)

<a id="t-let"></a>

### T-LET — the let rule

A let body may use the definitional equality x == v, so the checker records the value in the local context instead of forgetting it.

> `G |- v : A   G |- e[v/x] : B  =>  G |- (let x : A := v; e) : B`

- Thesis: [axioms.tex, at `binders ($\zeta$ reduction)`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`infer_let` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`inferLet` in src/kernel/tc.ts](../src/kernel/tc.ts)

<a id="t-proj"></a>

### T-PROJ — the projection typing rule

A projection types each field by walking the constructor type, substituting earlier projections for earlier fields. Prop-valued structures may only project Prop fields.

> `G |- s : S ps   S a one-constructor type  =>  G |- s.i : type of field i`

- Thesis: not modeled — The thesis's term language has no projections (Lean 3 defined them via recursors); the Lean 4 kernel types them directly as a primitive.
- Lean 4 kernel: [`infer_proj` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`inferProj` in src/kernel/tc.ts](../src/kernel/tc.ts)

<a id="t-lit"></a>

### T-LIT — the literal typing rule

Literals are a kernel extension for efficiency: a number is one node, not a tower of Nat.succ. The kernel bounds their size.

> `|- natLit n : Nat    |- strLit s : String`

- Thesis: not modeled — Kernel extension, newer than the thesis. The size bound is LEAN_NAT_MAX_SIZE in the C++ kernel.
- Lean 4 kernel: [`infer_lit` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`inferLit` in src/kernel/tc.ts](../src/kernel/tc.ts)

## Levels

<a id="lvl-leq"></a>

### LVL-LEQ — level inequality

Level inequality, decided syntactically on normalized levels. The thesis derives level equality from two-way inequality; the kernel decides equality by LVL-NORM instead and uses this test only for the universe bound on data declarations (WF-IND-UNIV). Skipping the case split refuses some true inequalities and accepts no false ones.

> `l >= l', by a syntactic descent through max, imax and numeric offsets. The thesis states the judgment l <= l' + n, including a case split on u := 0 and u := S u, which the kernel does not implement`

- Thesis: [axioms.tex, at `subsection{Definitional equality}`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`is_geq` in src/kernel/level.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/level.cpp)
- This checker: [`isGeq` in src/kernel/level.ts](../src/kernel/level.ts)

<a id="lvl-norm"></a>

### LVL-NORM — level equality by normalization

The thesis specifies level equality as two-way inequality. The kernel decides the same relation by normalize-then-compare: flatten maxes, sort, drop dominated entries. The normalization procedure itself is kernel implementation; the thesis does not model it.

> `l == l'  iff  l <= l' and l' <= l, decided as normalize(l) = normalize(l')`

- Thesis: [axioms.tex, at `subsection{Definitional equality}`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`is_equivalent` in src/kernel/level.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/level.cpp)
- This checker: [`isEquivalent` in src/kernel/level.ts](../src/kernel/level.ts)

<a id="lvl-imax"></a>

### LVL-IMAX — the imax collapse rule

imax collapses to zero when its right side is zero. This one function makes impredicative Prop and predicative Type coexist.

> `imax(l, 0) = 0    imax(l, S m) = max(l, S m)`

- Thesis: [axioms.tex, at `subsection{Definitional equality}`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`mk_imax` in src/kernel/level.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/level.cpp)
- This checker: [`mkIMax` in src/kernel/level.ts](../src/kernel/level.ts)

## Reduction

<a id="red-beta"></a>

### RED-BETA — beta reduction

Beta is the engine of computation. The implementation discharges a whole application spine in one substitution pass; one argument at a time is quadratic.

> `(fun x:A => e) a ~> e[a/x]`

- Thesis: [axioms.tex, at `subsection{Reduction}`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`whnf_core` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`whnfCore` in src/kernel/tc.ts](../src/kernel/tc.ts)

<a id="red-zeta"></a>

### RED-ZETA — zeta reduction

Zeta unfolds a let. There are no congruence rules for let: the kernel unfolds it whenever it must look inside.

> `(let x : A := v; e) ~> e[v/x]`

- Thesis: [axioms.tex, at `binders ($\zeta$ reduction)`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`whnf_core` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`whnfCore` in src/kernel/tc.ts](../src/kernel/tc.ts)

<a id="red-delta"></a>

### RED-DELTA — delta reduction

Delta unfolds a definition. Unfolding is lazy and height-directed: compare heights, unfold the taller side first, and try a cheap congruence before unfolding both.

> `c.{ls} ~> value(c)[ls/us]`

- Thesis: [axioms.tex, at `Definitions ($\delta$ reduction)`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`lazy_delta_reduction_step` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`lazyDeltaReductionStep` in src/kernel/tc.ts](../src/kernel/tc.ts)

<a id="red-iota"></a>

### RED-IOTA — iota reduction

Iota fires a recursor on a constructor: pick the rule for that constructor, apply it to the fields, and recurse through v.

> `rec C e p (ctor b) ~> e_ctor b v`

- Thesis: [axioms.tex, at `The computation rule ($\iota$ reduction)`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`inductive_reduce_rec` in src/kernel/inductive.h](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/inductive.h)
- This checker: [`inductiveReduceRec` in src/kernel/tc.ts](../src/kernel/tc.ts)

<a id="red-k"></a>

### RED-K — K-like reduction

K-like reduction is proof irrelevance fused with iota: replace the major premise by the unique constructor without looking at it. The defeq guard on the types is load-bearing.

> `For a subsingleton eliminator: rec C e p h ~> e_ctor b v, for ANY proof h, when the types agree`

- Thesis: [axioms.tex, at `K-like reduction`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`to_cnstr_when_K` in src/kernel/inductive.h](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/inductive.h)
- This checker: [`toCnstrWhenK` in src/kernel/tc.ts](../src/kernel/tc.ts)
- Forgery (soundness): flag `RED-K-GUARD`, [artifact](forgeries/RED-K-GUARD.ndjson), run in [tests/forgery.test.ts](../tests/forgery.test.ts)

<a id="red-quot"></a>

### RED-QUOT — quotient reduction

The quotient computation rule. The thesis calls quotient types a semi-builtin axiom because of exactly this rule: a computational rule rather than a constant, with only Quot.sound counted as the axiom proper.

> `Quot.lift f h (Quot.mk r a) ~> f a, and likewise Quot.ind`

- Thesis: [axioms.tex, at `subsubsection{Quotient types}`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`quot_reduce_rec` in src/kernel/quot.h](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/quot.h)
- This checker: [`quotReduceRec` in src/kernel/tc.ts](../src/kernel/tc.ts)

<a id="red-nat"></a>

### RED-NAT — literal arithmetic

Literal arithmetic is a kernel extension: evaluate on big integers instead of unary towers. The size-increasing operations (add, sub, mul, pow, shiftLeft) are bounded, and those bounds are themselves refusal rules.

> `Nat.succ (lit a) ~> lit (a+1), Nat.add (lit a) (lit b) ~> lit (a+b), and likewise for sub, mul, pow, gcd, mod, div, beq, ble, and the bit operations`

- Thesis: not modeled — Kernel extension, newer than the thesis. The size bound is LEAN_NAT_MAX_SIZE in the C++ kernel; gcd, mod, div and the bitwise operations are left unbounded because their result cannot outgrow their input. No test in the local arena suite targets the bounds: the one nat-literal forgery there attacks the arithmetic itself.
- Lean 4 kernel: [`reduce_nat` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`reduceNat` in src/kernel/tc.ts](../src/kernel/tc.ts)
- **Divergence**: reduceNat runs ungated inside the lazy-delta loop; the C++ kernel gates it on !has_fvar for both sides. Cost-only, completeness-increasing, sound because reduceNat fails unless both arguments evaluate to literals. See [docs/DIVERGENCES.md](../docs/DIVERGENCES.md).

<a id="red-proj"></a>

### RED-PROJ — projection reduction

Projecting a field out of a literal constructor application returns that field.

> `(ctor ps fs).i ~> fs[i]`

- Thesis: not modeled — The thesis's term language has no projections; the kernel reduces them directly.
- Lean 4 kernel: [`reduce_proj` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`reduceProj` in src/kernel/tc.ts](../src/kernel/tc.ts)

## Definitional equality

<a id="defeq-binding"></a>

### DEFEQ-BINDING — congruence under binders

Congruence under a binder. Binder names and binder infos do not participate: equality ignores them, so the hash must too.

> `A == A'   e == e' under x:A  =>  (fun x:A => e) == (fun x:A' => e'), and likewise for forall`

- Thesis: [axioms.tex, at `subsection{Definitional equality}`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`is_def_eq_binding` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`isDefEqBinding` in src/kernel/tc.ts](../src/kernel/tc.ts)

<a id="defeq-args"></a>

### DEFEQ-ARGS — spine congruence

Congruence on application spines, argument by argument. This is the cheap test that runs before expensive unfolding: lazy delta tries it on two applications of the same constant and skips the unfold when it succeeds. The separate congruence fallback at the end of the equality chain (is_def_eq_app) runs only after unfolding has failed.

> `f == f'   a_i == a'_i  =>  f as == f' as'  (algorithmic form; the thesis's congruence rule adds a typing premise)`

- Thesis: [axioms.tex, at `subsection{Definitional equality}`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`is_def_eq_args` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`isDefEqArgs` in src/kernel/tc.ts](../src/kernel/tc.ts)

<a id="defeq-eta"></a>

### DEFEQ-ETA — eta equality

Eta: a function equals its own one-step wrapper. The kernel implements it by expanding the non-lambda side.

> `(fun x:A => f x) == f`

- Thesis: [axioms.tex, at `subsection{Definitional equality}`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`try_eta_expansion_core` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`tryEtaExpansion` in src/kernel/tc.ts](../src/kernel/tc.ts)

<a id="defeq-eta-struct"></a>

### DEFEQ-ETA-STRUCT — structure eta

Structure eta: an element of a structure equals the constructor applied to its own projections. It fires only when one side is already a saturated constructor application, and only when the two sides' types agree definitionally.

> `s == ctor ps s.0 ... s.(n-1), for a one-constructor, non-recursive, index-free structure`

- Thesis: not modeled — Added to Lean after the thesis. Arena tests 112 and 113 target its edge cases.
- Lean 4 kernel: [`try_eta_struct_core` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`tryEtaStruct` in src/kernel/tc.ts](../src/kernel/tc.ts)

<a id="defeq-proof-irrel"></a>

### DEFEQ-PROOF-IRREL — proof irrelevance

Any two proofs of one proposition are equal. This single rule makes algorithmic equality non-transitive and ideal equality undecidable.

> `G |- p : Prop   G |- h : p   G |- h' : p  =>  G |- h == h'`

- Thesis: [axioms.tex, at `subsection{Definitional equality}`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`is_def_eq_proof_irrel` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`isDefEqProofIrrel` in src/kernel/tc.ts](../src/kernel/tc.ts)

<a id="defeq-unit-like"></a>

### DEFEQ-UNIT-LIKE — unit-like equality

Unit-like definitional equality: a structure with no fields has one element up to defeq.

> `t == s when both inhabit the same one-constructor, zero-field, index-free structure type`

- Thesis: not modeled — Kernel extension. A corollary of structure eta, but a separate rule: eta needs one side to be a constructor application, and this rule fires when neither is. Arena tests 108-111.
- Lean 4 kernel: [`is_def_eq_unit_like` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`isDefEqUnitLike` in src/kernel/tc.ts](../src/kernel/tc.ts)

<a id="defeq-string"></a>

### DEFEQ-STRING — string literal expansion

A string literal equals its constructor form. The rule targets String.ofList. The C++ variable holding that constant is still named g_string_mk, after the constructor an older kernel used; the value it is initialized with is String.ofList.

> `strLit s == String.ofList [chars of s]`

- Thesis: not modeled — Kernel extension; the thesis does not model string literals.
- Lean 4 kernel: [`try_string_lit_expansion` in src/kernel/type_checker.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/type_checker.cpp)
- This checker: [`tryStringLitExpansion` in src/kernel/tc.ts](../src/kernel/tc.ts)

## Well-formedness

<a id="wf-decl-type"></a>

### WF-DECL-TYPE — declaration type well-formedness

Before a name enters the environment, its stated type is checked. A type whose type is not a sort is data, not a type.

> `A declaration's type must itself check, with a sort as its type, using only the declared universe parameters; the kernel additionally requires the parameter list be duplicate-free`

- Thesis: [axioms.tex, at `Definitions ($\delta$ reduction)`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`check_constant_val` in src/kernel/environment.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/environment.cpp)
- This checker: [`checkConstantVal` in src/checker.ts](../src/checker.ts)

<a id="wf-def-val"></a>

### WF-DEF-VAL — the definition value check

A definition's value must have the declared type, up to definitional equality. The profiles of chapter 10 land inside the equality work this check drives.

> `def c : A := e is admissible when |- e : A' and A' == A`

- Thesis: [axioms.tex, at `Definitions ($\delta$ reduction)`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`add_definition` in src/kernel/environment.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/environment.cpp)
- This checker: [`addDecl` in src/checker.ts](../src/checker.ts)

<a id="wf-thm-prop"></a>

### WF-THM-PROP — theorems prove propositions

A theorem's type must be a proposition. This is hygiene, not soundness: the value is still checked, so no forgery follows from dropping it. The forgery gate shows the weakened kernel accepting the file; chapter 11 argues why nothing false follows.

> `thm c : A := e is admissible only when A : Prop`

- Thesis: not modeled — Not in the thesis, which has only definitions and primitive constants. It is a Lean convention: a theorem's value is a proof, so the elaborator may check it asynchronously and the compiler erases it. The kernel itself still stores and unfolds that value.
- Lean 4 kernel: [`add_theorem` in src/kernel/environment.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/environment.cpp)
- This checker: [`addDecl` in src/checker.ts](../src/checker.ts)
- Forgery (hygiene): flag `WF-THM-PROP`, [artifact](forgeries/WF-THM-PROP.ndjson), run in [tests/forgery.test.ts](../tests/forgery.test.ts)

<a id="wf-name-fresh"></a>

### WF-NAME-FRESH — name freshness

Redeclaration is refused. Several arena forgeries are nothing but a second declaration of one name: a definition given the name reserved for a recursor, or a constructor and a recursor sharing one.

> `A declared name must not already be in the environment`

- Thesis: not modeled — Implicit in the thesis, which requires a constant declaration to introduce a new name; it never models an environment explicitly.
- Lean 4 kernel: [`check_name` in src/kernel/environment.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/environment.cpp)
- This checker: [`checkName` in src/kernel/env.ts](../src/kernel/env.ts)

<a id="wf-ind-spec"></a>

### WF-IND-SPEC — the constructor shape rules

The shape rules for the constructors of an inductive declaration: each one returns the type being declared, with the parameters passed through untouched. The sibling check over the declaration's types enforces the whole-block rules — parameters agree across a mutual block, and all of its types share one universe.

> `Each constructor is a telescope of arguments ending in the inductive type applied to the declaration's parameters, unchanged, and to indices that may not mention the types being declared`

- Thesis: [axioms.tex, at `subsubsection{Inductive specifications}`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`check_constructors` in src/kernel/inductive.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/inductive.cpp)
- This checker: [`checkConstructors` in src/kernel/inductive.ts](../src/kernel/inductive.ts)

<a id="wf-ind-pos"></a>

### WF-IND-POS — strict positivity

Strict positivity. A constructor argument that consumes the type being declared lets one element encode a function out of the whole type, and Cantor refuses.

> `A recursive argument must have the form forall z::g. t e, with t never to the left of an arrow`

- Thesis: [axioms.tex, at `subsubsection{Inductive specifications}`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`check_positivity` in src/kernel/inductive.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/inductive.cpp)
- This checker: [`checkPositivity` in src/kernel/inductive.ts](../src/kernel/inductive.ts)
- Forgery (soundness): flag `WF-IND-POS`, [artifact](forgeries/WF-IND-POS.ndjson), run in [tests/forgery.test.ts](../tests/forgery.test.ts)

<a id="wf-ind-univ"></a>

### WF-IND-UNIV — the universe bound

A constructor may not smuggle a bigger universe into a smaller type. This is the rule that stands between Lean and Girard's paradox.

> `For each constructor argument of type b : Sort l', require imax(l', l) <= l, where Sort l is the result`

- Thesis: [axioms.tex, at `subsubsection{Inductive specifications}`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`check_constructors` in src/kernel/inductive.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/inductive.cpp)
- This checker: [`checkConstructors` in src/kernel/inductive.ts](../src/kernel/inductive.ts)
- Forgery (soundness): flag `WF-IND-UNIV`, [artifact](forgeries/WF-IND-UNIV.ndjson), run in [tests/forgery.test.ts](../tests/forgery.test.ts)

<a id="wf-large-elim"></a>

### WF-LARGE-ELIM — large elimination

Large elimination. A proposition with two constructors must not compute data, or Bool-valued proofs distinguish proofs that irrelevance says are equal.

> `The motive may range over Sort u only when the type is not a proposition, or is a subsingleton`

- Thesis: [axioms.tex, at `subsubsection{Large elimination}`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`elim_only_at_universe_zero` in src/kernel/inductive.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/inductive.cpp)
- This checker: [`elimOnlyAtUniverseZero` in src/kernel/inductive.ts](../src/kernel/inductive.ts)

<a id="wf-rec-derive"></a>

### WF-REC-DERIVE — recursor derivation

A recursor is not an axiom. The checker derives its own and compares the export against it; a forged recursor proves False in one line.

> `The recursor's type and computation rules are DERIVED from the inductive declaration, never read from the input (the thesis gives the type here and the iota rules in the following subsubsection)`

- Thesis: [axioms.tex, at `subsubsection{The recursor}`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`declare_recursors` in src/kernel/inductive.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/inductive.cpp)
- This checker: [`declareRecursors` in src/kernel/inductive.ts](../src/kernel/inductive.ts)
- Forgery (soundness): flag `WF-REC-DERIVE`, [artifact](forgeries/WF-REC-DERIVE.ndjson), run in [tests/forgery.test.ts](../tests/forgery.test.ts)

<a id="wf-quot"></a>

### WF-QUOT — quotient construction

Exported quotient types are decoration: the checker constructs the canonical four and compares. The thesis's fourth constant is Quot.sound, which reaches the kernel as an ordinary axiom instead.

> `The four quotient primitives — Quot, Quot.mk, Quot.lift, Quot.ind — are built by the kernel itself, after checking that Eq has its canonical form`

- Thesis: [axioms.tex, at `subsubsection{Quotient types}`](https://github.com/digama0/lean-type-theory/blob/0ba178704380d2fad751f020d461b293f47e36d5/axioms.tex) · [PDF (release v1.0)](https://github.com/digama0/lean-type-theory/releases/tag/v1.0)
- Lean 4 kernel: [`add_quot` in src/kernel/quot.cpp](https://github.com/leanprover/lean4/blob/5045d0056413266e57c625dcd7c365b10e377c52/src/kernel/quot.cpp)
- This checker: [`addQuot` in src/kernel/quot.ts](../src/kernel/quot.ts)
