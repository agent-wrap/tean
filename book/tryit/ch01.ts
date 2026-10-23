// Chapter 1 — Three nodes.
// A variable, a function, a call — and substitution is the whole meaning.
// Paste this whole file into any TypeScript playground and run it.

type Expr =
  | { kind: "var"; name: string } // x
  | { kind: "lam"; binder: string; body: Expr } // fun x => body
  | { kind: "app"; fn: Expr; arg: Expr }; // fn arg

const v = (name: string): Expr => ({ kind: "var", name });
const lam = (binder: string, body: Expr): Expr => ({ kind: "lam", binder, body });
const app = (fn: Expr, arg: Expr): Expr => ({ kind: "app", fn, arg });

function show(e: Expr): string {
  switch (e.kind) {
    case "var":
      return e.name;
    case "lam":
      return `(fun ${e.binder} => ${show(e.body)})`;
    case "app":
      return `(${show(e.fn)} ${show(e.arg)})`;
  }
}

// A variable occurrence is free when no enclosing `fun` binds its name.
function freeVars(e: Expr): Set<string> {
  switch (e.kind) {
    case "var":
      return new Set([e.name]);
    case "lam": {
      const inner = freeVars(e.body);
      inner.delete(e.binder); // the binder closes over its own name
      return inner;
    }
    case "app":
      return new Set([...freeVars(e.fn), ...freeVars(e.arg)]);
  }
}

let fresh = 0;
const freshName = (base: string): string => `${base}${++fresh}`;

// e[a/x]: replace every FREE occurrence of x in e by a.
function subst(e: Expr, x: string, a: Expr): Expr {
  switch (e.kind) {
    case "var":
      return e.name === x ? a : e;
    case "app":
      return app(subst(e.fn, x, a), subst(e.arg, x, a));
    case "lam": {
      if (e.binder === x) return e; // x is rebound here: nothing inside is free
      if (freeVars(a).has(e.binder)) {
        // The trap. `a` mentions this binder's name, so pushing `a` under
        // the binder would capture it. Rename the binder first.
        const y = freshName(e.binder);
        return lam(y, subst(subst(e.body, e.binder, v(y)), x, a));
      }
      return lam(e.binder, subst(e.body, x, a));
    }
  }
}

// Beta: apply a function by substituting the argument into its body.
function beta(e: Expr): Expr {
  if (e.kind === "app" && e.fn.kind === "lam") return subst(e.fn.body, e.fn.binder, e.arg);
  return e;
}

// One step anywhere in the term, leftmost-outermost first.
// Returns null when there is no redex left: the term is in normal form.
function step(e: Expr): Expr | null {
  switch (e.kind) {
    case "var":
      return null;
    case "lam": {
      const body = step(e.body);
      return body === null ? null : lam(e.binder, body);
    }
    case "app": {
      if (e.fn.kind === "lam") return beta(e);
      const fn = step(e.fn);
      if (fn !== null) return app(fn, e.arg);
      const arg = step(e.arg);
      return arg === null ? null : app(e.fn, arg);
    }
  }
}

// Run: step until nothing steps. A cap, because some terms never stop.
function normalize(e: Expr, cap = 1000): string {
  for (let i = 0; i < cap; i++) {
    const next = step(e);
    if (next === null) return show(e);
    e = next;
  }
  return `(still stepping after ${cap} steps)`;
}

// fun x => f x  — f is free, x is bound.
const t1 = lam("x", app(v("f"), v("x")));
console.log(`${show(t1)}   free: ${[...freeVars(t1)].join(", ")}`);

// (fun x => x) y  steps to  y
console.log(show(beta(app(lam("x", v("x")), v("y")))));

// (fun x => fun y => x) y: the constant function, applied to y. It must
// step to a function that ignores its argument and returns y.
const k = lam("x", lam("y", v("x")));
console.log(show(beta(app(k, v("y")))));

// Run a whole program: k a b, two steps, and the answer is a.
console.log(normalize(app(app(k, v("a")), v("b"))));

// A term that steps to itself forever. The cap is the only thing that
// brings this line back.
const w = lam("x", app(v("x"), v("x")));
console.log(normalize(app(w, w)));

// To break it: in subst, delete the `if (freeVars(a).has(e.binder))`
// branch and rerun. The third line becomes (fun y => y) — the identity
// function. The y that was free walked under a `fun y` and was captured.
// Nothing crashed. Chapter 2 deletes the names so the trap cannot exist.

export {}; // keeps this file a self-contained module
