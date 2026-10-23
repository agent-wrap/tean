// Chapter 2 — Variables without names.
// Binding is arithmetic: an index counts binders outward.

type Expr =
  | { kind: "bvar"; idx: number } // bound variable: #0 is the nearest binder
  | { kind: "fvar"; name: string } // free variable: bound by nothing in the term
  | { kind: "app"; fn: Expr; arg: Expr }
  | { kind: "lam"; body: Expr }; // the binder has no name

const bvar = (idx: number): Expr => ({ kind: "bvar", idx });
const fvar = (name: string): Expr => ({ kind: "fvar", name });
const app = (fn: Expr, arg: Expr): Expr => ({ kind: "app", fn, arg });
const lam = (body: Expr): Expr => ({ kind: "lam", body });

// Raise every loose index >= start by `amount`. A substituted term that
// crosses a binder must not capture that binder's variable.
function lift(e: Expr, start: number, amount: number): Expr {
  switch (e.kind) {
    case "bvar":
      return e.idx >= start ? bvar(e.idx + amount) : e;
    case "fvar":
      return e;
    case "app":
      return app(lift(e.fn, start, amount), lift(e.arg, start, amount));
    case "lam":
      // Inside the binder, indices shift by one: start moves with us.
      return lam(lift(e.body, start + 1, amount));
  }
}

// Replace #0 by `a` (and renumber what pointed past it).
function instantiate(e: Expr, a: Expr, depth = 0): Expr {
  switch (e.kind) {
    case "bvar":
      if (e.idx === depth) return lift(a, 0, depth);
      return e.idx > depth ? bvar(e.idx - 1) : e;
    case "fvar":
      return e;
    case "app":
      return app(instantiate(e.fn, a, depth), instantiate(e.arg, a, depth));
    case "lam":
      return lam(instantiate(e.body, a, depth + 1));
  }
}

function show(e: Expr): string {
  switch (e.kind) {
    case "bvar":
      return `#${e.idx}`;
    case "fvar":
      return e.name;
    case "app":
      return `(${show(e.fn)} ${show(e.arg)})`;
    case "lam":
      return `(fun => ${show(e.body)})`;
  }
}

// Chapter 1's interpreter, ported. Beta is now instantiate, and there is
// no freshName, no freeVars, no rename: nothing here can capture.
function step(e: Expr): Expr | null {
  switch (e.kind) {
    case "bvar":
    case "fvar":
      return null;
    case "lam": {
      const body = step(e.body);
      return body === null ? null : lam(body);
    }
    case "app": {
      if (e.fn.kind === "lam") return instantiate(e.fn.body, e.arg); // the redex
      const fn = step(e.fn);
      if (fn !== null) return app(fn, e.arg);
      const arg = step(e.arg);
      return arg === null ? null : app(e.fn, arg);
    }
  }
}

function normalize(e: Expr, cap = 1000): string {
  for (let i = 0; i < cap; i++) {
    const next = step(e);
    if (next === null) return show(e);
    e = next;
  }
  return `(still stepping after ${cap} steps)`;
}

// fun x => fun y => x y   is   fun => fun => #1 #0
const inner = lam(app(bvar(1), bvar(0)));
const twoBinders = lam(inner);
console.log(show(twoBinders));

// Open the outer binder with the free variable c: `inner` is its body,
// and the #1 inside it — one binder out — becomes c.
console.log(show(instantiate(inner, fvar("c"))));

// Chapter 1's trap, with indices: substitute (fun => #0 #1) for #0
// UNDER a binder. The inner #1 must still point outside after the move.
// The target #0 sits under that binder, so it appears as #1 there.
const needsLift = lam(app(bvar(0), bvar(1)));
console.log(show(instantiate(inner, needsLift)));

// Chapter 1's three programs, without names. Same answers, no rename.
const id = lam(bvar(0)); //                      fun x => x
const k = lam(lam(bvar(1))); //                  fun x => fun y => x
const omega = lam(app(bvar(0), bvar(0))); //     fun x => x x
console.log(normalize(app(id, fvar("a"))));
console.log(normalize(app(app(k, fvar("a")), fvar("b"))));
console.log(normalize(app(omega, omega)));

// To break it: delete the call to lift inside instantiate and rerun.
// The third line changes: the moved #1 now points at the wrong binder.
// That silent wrong answer, not a crash, is why capture is feared.

export {}; // keeps this file a self-contained module
