// Chapter 6 — The judge.
// The whole checker is two mutually recursive functions:
// infer (what type does this term have?) and defEq (are these equal?).

type Expr =
  | { kind: "sort"; level: number }
  | { kind: "bvar"; idx: number }
  | { kind: "const"; name: string }
  | { kind: "app"; fn: Expr; arg: Expr }
  | { kind: "lam"; type: Expr; body: Expr }
  | { kind: "pi"; type: Expr; body: Expr };

const sort = (level: number): Expr => ({ kind: "sort", level });
const bvar = (idx: number): Expr => ({ kind: "bvar", idx });
const cnst = (name: string): Expr => ({ kind: "const", name });
const app = (fn: Expr, arg: Expr): Expr => ({ kind: "app", fn, arg });
const lam = (type: Expr, body: Expr): Expr => ({ kind: "lam", type, body });
const pi = (type: Expr, body: Expr): Expr => ({ kind: "pi", type, body });

// Constants with declared types: a two-line environment.
const env = new Map<string, Expr>([
  ["P", sort(0)], // P : Prop
  ["h1", cnst("P")], // h1 : P   (a proof)
  ["h2", cnst("P")], // h2 : P   (another proof)
  ["T", sort(1)], // T : Type
  ["c1", cnst("T")], // c1 : T   (data)
  ["c2", cnst("T")], // c2 : T   (different data)
]);

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

function whnf(e: Expr): Expr {
  if (e.kind === "app") {
    const fn = whnf(e.fn);
    if (fn.kind === "lam") return whnf(instantiate(fn.body, e.arg));
    if (fn !== e.fn) return app(fn, e.arg);
  }
  return e;
}

const imax = (l1: number, l2: number): number => (l2 === 0 ? 0 : Math.max(l1, l2));

// ctx[i] is bvar #i's type at its binder; lift it past binders crossed since.
function infer(e: Expr, ctx: Expr[]): Expr {
  switch (e.kind) {
    case "sort":
      return sort(e.level + 1);
    case "bvar": {
      const t = ctx[e.idx];
      if (t === undefined) throw new Error("loose variable");
      return lift(t, 0, e.idx + 1);
    }
    case "const": {
      const t = env.get(e.name);
      if (t === undefined) throw new Error(`unknown constant ${e.name}`);
      return t;
    }
    case "lam": {
      ensureSort(infer(e.type, ctx));
      const bodyType = infer(e.body, [e.type, ...ctx]);
      return pi(e.type, bodyType);
    }
    case "pi": {
      const l1 = ensureSort(infer(e.type, ctx));
      const l2 = ensureSort(infer(e.body, [e.type, ...ctx]));
      return sort(imax(l1, l2));
    }
    case "app": {
      const fnType = whnf(infer(e.fn, ctx));
      if (fnType.kind !== "pi") throw new Error("function expected");
      const argType = infer(e.arg, ctx);
      if (!defEq(argType, fnType.type, ctx)) throw new Error("type mismatch");
      return instantiate(fnType.body, e.arg); // conversion happened above
    }
  }
}

function ensureSort(e: Expr): number {
  const w = whnf(e);
  if (w.kind !== "sort") throw new Error("sort expected");
  return w.level;
}

function isProof(e: Expr, ctx: Expr[]): boolean {
  // e is a proof when the type of its type is Prop (Sort 0).
  return ensureSort(infer(infer(e, ctx), ctx)) === 0;
}

// The cheap attempt: structure only, no reduction, no inference.
// It is THREE-valued. `undefined` means "not settled" — two constants
// with different names may still unfold to the same thing, so a mismatch
// here is a reason to reduce, never a reason to answer false.
function quickDefEq(a: Expr, b: Expr, ctx: Expr[]): boolean | undefined {
  if (a === b) return true; // the same object: free
  if (a.kind !== b.kind) return undefined; // one side may yet reduce
  switch (a.kind) {
    case "sort":
      return a.level === (b as { level: number }).level;
    case "bvar":
      return a.idx === (b as { idx: number }).idx;
    case "const":
      return a.name === (b as { name: string }).name ? true : undefined;
    case "lam":
    case "pi": {
      // Congruence under binders: compare domains, then bodies with the
      // domain pushed onto the context.
      const bb = b as { type: Expr; body: Expr };
      return defEq(a.type, bb.type, ctx) && defEq(a.body, bb.body, [a.type, ...ctx]);
    }
    default:
      return undefined; // an application spine is not a cheap question
  }
}

// The chain of attempts, cheap before expensive — the order IS the
// algorithm, and it is the order the real kernel uses.
function defEq(a0: Expr, b0: Expr, ctx: Expr[]): boolean {
  // 1. Structural, with nothing reduced yet.
  const quick = quickDefEq(a0, b0, ctx);
  if (quick !== undefined) return quick;

  // 2. Reduce both heads, then ask the cheap question again.
  const a = whnf(a0);
  const b = whnf(b0);
  if (a !== a0 || b !== b0) {
    const again = quickDefEq(a, b, ctx);
    if (again !== undefined) return again;
  }

  // 3. Proof irrelevance, LAST of the single-step attempts because it is
  // the dearest: two infer calls and a recursive defEq on their results.
  // Two proofs of one proposition are equal, period.
  if (isProof(a, ctx) && isProof(b, ctx) && defEq(infer(a, ctx), infer(b, ctx), ctx)) return true;

  // 4. Congruence on an application spine.
  if (a.kind === "app" && b.kind === "app") {
    return defEq(a.fn, b.fn, ctx) && defEq(a.arg, b.arg, ctx);
  }
  return false;
}

function show(e: Expr): string {
  switch (e.kind) {
    case "sort":
      return e.level === 0 ? "Prop" : e.level === 1 ? "Type" : `Sort ${e.level}`;
    case "bvar":
      return `#${e.idx}`;
    case "const":
      return e.name;
    case "app":
      return `(${show(e.fn)} ${show(e.arg)})`;
    case "lam":
      return `(fun : ${show(e.type)} => ${show(e.body)})`;
    case "pi":
      return `(${show(e.type)} -> ${show(e.body)})`;
  }
}

// The identity function on propositions, and its inferred type.
const idProp = lam(sort(0), bvar(0));
console.log(`infer(fun : Prop => #0)       = ${show(infer(idProp, []))}`);
// Applying it: conversion checks the argument type against the domain.
console.log(`infer((fun : Prop => #0) P)   = ${show(infer(app(idProp, cnst("P")), []))}`);
// defEq computes: a beta redex equals its result.
console.log(`(fun : Type => #0) T == T     : ${defEq(app(lam(sort(1), bvar(0)), cnst("T")), cnst("T"), [])}`);
// Proof irrelevance: two different proofs of P are equal...
console.log(`h1 == h2 (proofs of P)        : ${defEq(cnst("h1"), cnst("h2"), [])}`);
// ...but two different pieces of data of type T are not.
console.log(`c1 == c2 (data in T)          : ${defEq(cnst("c1"), cnst("c2"), [])}`);

// To break it: remove step 3 from defEq. h1 == h2 turns false — no false
// proof is accepted, but real libraries stop checking, because dependent
// types compare proofs inside types all the time. The rule is
// load-bearing for completeness, not for soundness. Chapter 14 makes
// that distinction into a test you can run.
// Then break it the other way: move step 3 above step 1, and every
// comparison in the program — including `#0` against `#0` — pays for two
// type inferences before anyone looks at the two trees.

export {}; // keeps this file a self-contained module
