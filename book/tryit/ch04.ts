// Chapter 4 — Types are terms.
// Chapter 3's checker over one grammar: a type is a term, so the same
// `infer` types both, and the universe ladder keeps that from collapsing.

type Expr =
  | { kind: "bvar"; idx: number } // #0 is the nearest binder (chapter 2)
  | { kind: "sort"; level: number } // Sort 0 is Prop, Sort 1 is Type
  | { kind: "const"; name: string } // a name the environment has checked
  | { kind: "pi"; type: Expr; body: Expr } // (x : type) -> body; body may mention #0
  | { kind: "lam"; type: Expr; body: Expr } // fun x : type => body
  | { kind: "app"; fn: Expr; arg: Expr };

const bvar = (idx: number): Expr => ({ kind: "bvar", idx });
const sort = (level: number): Expr => ({ kind: "sort", level });
const cnst = (name: string): Expr => ({ kind: "const", name });
const pi = (type: Expr, body: Expr): Expr => ({ kind: "pi", type, body });
const lam = (type: Expr, body: Expr): Expr => ({ kind: "lam", type, body });
const app = (fn: Expr, arg: Expr): Expr => ({ kind: "app", fn, arg });

// Concrete levels are enough to see the shape (the real thing also has
// level variables, max, and a normalizer). imax collapses when the right
// side is zero: a family of propositions is a proposition, however big
// the domain. Flip the switch and the rule becomes plain max.
let useMaxInstead = false;
function imax(l1: number, l2: number): number {
  if (useMaxInstead) return Math.max(l1, l2);
  return l2 === 0 ? 0 : Math.max(l1, l2);
}

// The environment: names already checked, each with its stated type.
// Eq : (A : Type) -> A -> A -> Prop. Its body mentions its first argument,
// so with indices it is pi(Type, pi(#0, pi(#1, Prop))).
const env = new Map<string, Expr>([
  ["Nat", sort(1)], // Nat : Type
  ["zero", cnst("Nat")], // zero : Nat
  ["succ", pi(cnst("Nat"), cnst("Nat"))], // succ : Nat -> Nat
  ["Eq", pi(sort(1), pi(bvar(0), pi(bvar(1), sort(0))))],
]);

// Chapter 2's two moves, with a case for each binder.
function lift(e: Expr, start: number, amount: number): Expr {
  switch (e.kind) {
    case "bvar":
      return e.idx >= start ? bvar(e.idx + amount) : e;
    case "app":
      return app(lift(e.fn, start, amount), lift(e.arg, start, amount));
    case "lam":
      return lam(lift(e.type, start, amount), lift(e.body, start + 1, amount));
    case "pi":
      return pi(lift(e.type, start, amount), lift(e.body, start + 1, amount));
    default:
      return e;
  }
}

function instantiate(e: Expr, a: Expr, depth = 0): Expr {
  switch (e.kind) {
    case "bvar":
      if (e.idx === depth) return lift(a, 0, depth);
      return e.idx > depth ? bvar(e.idx - 1) : e;
    case "app":
      return app(instantiate(e.fn, a, depth), instantiate(e.arg, a, depth));
    case "lam":
      return lam(instantiate(e.type, a, depth), instantiate(e.body, a, depth + 1));
    case "pi":
      return pi(instantiate(e.type, a, depth), instantiate(e.body, a, depth + 1));
    default:
      return e;
  }
}

function show(e: Expr): string {
  switch (e.kind) {
    case "bvar":
      return `#${e.idx}`;
    case "sort":
      return e.level === 0 ? "Prop" : e.level === 1 ? "Type" : `Sort ${e.level}`;
    case "const":
      return e.name;
    case "pi":
      return `(${show(e.type)} -> ${show(e.body)})`;
    case "lam":
      return `(fun : ${show(e.type)} => ${show(e.body)})`;
    case "app":
      return `(${show(e.fn)} ${show(e.arg)})`;
  }
}

// Chapter 3's typeEq, one case per node. Still structural: two types are
// equal when they are the same tree. Chapter 5 is about why that is not
// enough once a type can contain a program.
function typeEq(a: Expr, b: Expr): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "bvar":
      return a.idx === (b as { idx: number }).idx;
    case "sort":
      return a.level === (b as { level: number }).level;
    case "const":
      return a.name === (b as { name: string }).name;
    case "app": {
      const bb = b as { fn: Expr; arg: Expr };
      return typeEq(a.fn, bb.fn) && typeEq(a.arg, bb.arg);
    }
    case "pi":
    case "lam": {
      const bb = b as { type: Expr; body: Expr };
      return typeEq(a.type, bb.type) && typeEq(a.body, bb.body);
    }
  }
}

// ctx[i] is the type of #i, recorded at its binder: lift it past the
// i + 1 binders crossed since, because a type may now mention a variable.
type Ctx = Expr[];
type Verdict = { ok: true; type: Expr } | { ok: false; reason: string };

// A level, or the reason the term is not a type.
function ensureSort(v: Verdict): { ok: true; level: number } | { ok: false; reason: string } {
  if (!v.ok) return v;
  if (v.type.kind !== "sort") return { ok: false, reason: `${show(v.type)} is not a sort, so this is not a type` };
  return { ok: true, level: v.type.level };
}

function infer(ctx: Ctx, e: Expr): Verdict {
  switch (e.kind) {
    case "bvar": {
      // T-VAR, as in chapter 3, plus the lift.
      const t = ctx[e.idx];
      return t === undefined ? { ok: false, reason: `#${e.idx} is not in scope` } : { ok: true, type: lift(t, 0, e.idx + 1) };
    }
    case "sort":
      // T-SORT: the ladder. Sort l : Sort (l + 1).
      return { ok: true, type: sort(e.level + 1) };
    case "const": {
      // T-CONST: a lookup in the environment.
      const t = env.get(e.name);
      return t === undefined ? { ok: false, reason: `${e.name} is not in the environment` } : { ok: true, type: t };
    }
    case "pi": {
      // T-PI: both halves must be types, and the result lives at imax.
      const l1 = ensureSort(infer(ctx, e.type));
      if (!l1.ok) return l1;
      const l2 = ensureSort(infer([e.type, ...ctx], e.body));
      if (!l2.ok) return l2;
      return { ok: true, type: sort(imax(l1.level, l2.level)) };
    }
    case "lam": {
      // T-LAM, as in chapter 3, but the domain must be a type, and the
      // result is a pi, because the body's type may mention the argument.
      const dom = ensureSort(infer(ctx, e.type));
      if (!dom.ok) return dom;
      const body = infer([e.type, ...ctx], e.body);
      return body.ok ? { ok: true, type: pi(e.type, body.type) } : body;
    }
    case "app": {
      // T-APP, as in chapter 3, and then the one new move: the result is
      // the pi's body with the argument substituted in. That is dependency.
      const f = infer(ctx, e.fn);
      if (!f.ok) return f;
      if (f.type.kind !== "pi") return { ok: false, reason: `${show(f.type)} is not a function type` };
      const a = infer(ctx, e.arg);
      if (!a.ok) return a;
      if (!typeEq(f.type.type, a.type)) {
        return { ok: false, reason: `argument has type ${show(a.type)}, function wants ${show(f.type.type)}` };
      }
      return { ok: true, type: instantiate(f.type.body, e.arg) };
    }
  }
}

function report(label: string, e: Expr): void {
  const v = infer([], e);
  console.log(`${label.padEnd(34)} : ${v.ok ? show(v.type) : `refused — ${v.reason}`}`);
}

const Nat = cnst("Nat");
const Eq = cnst("Eq");

// The everyday case: a statement about numbers must still be a statement.
// Nat : Type, so the domain sits at level 1; the body is a Prop, level 0.
report("(n : Nat) -> Eq Nat n n", pi(Nat, app(app(app(Eq, Nat), bvar(0)), bvar(0))));

// Quantifying over ALL propositions lands back in Prop: impredicativity.
report("(p : Prop) -> p", pi(sort(0), bvar(0)));

// A quantifier over Type climbs: the domain is at level 2, the body at 1.
report("(A : Type) -> A", pi(sort(1), bvar(0)));

// A term whose type is a dependent pi: the identity for every type at once.
report("fun A : Type => fun x : A => x", lam(sort(1), lam(bvar(0), bvar(0))));

// The three programs, now typed. The judge of chapter 6 will agree.
report("fun x : Nat => x", lam(Nat, bvar(0)));
report("fun x : Nat => fun y : Nat => x", lam(Nat, lam(Nat, bvar(1))));
report("K zero (succ zero)", app(app(lam(Nat, lam(Nat, bvar(1))), cnst("zero")), app(cnst("succ"), cnst("zero"))));
report("fun x : Nat => x x", lam(Nat, app(bvar(0), bvar(0))));

// With max instead of imax, Prop stops absorbing:
useMaxInstead = true;
report("(n : Nat) -> Eq Nat n n, with max", pi(Nat, app(app(app(Eq, Nat), bvar(0)), bvar(0))));

// To break it: that last line IS the break. A kernel whose pi rule uses
// max instead of imax says that a theorem about numbers lives in Type,
// not Prop — every theorem that quantifies over a data type stops being
// a proposition, and the chapter 6 rule that makes any two proofs of a
// proposition interchangeable no longer applies to any of them.
// The dual mistake — letting Sort l : Sort l — accepts everything,
// including a proof of False, by Girard's paradox. The ladder is not
// decoration; it is the wall between those two failures.

export {}; // keeps this file a self-contained module
