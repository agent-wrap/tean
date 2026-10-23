// Chapter 3 — The arrow.
// Three rules type three nodes, and only the rule for a call can say no.

type Type =
  | { kind: "base"; name: string } // A, B: a type we do not look inside
  | { kind: "arrow"; from: Type; to: Type }; // T -> U

type Expr =
  | { kind: "bvar"; idx: number } // #0 is the nearest binder (chapter 2)
  | { kind: "lam"; type: Type; body: Expr } // fun : T => body
  | { kind: "app"; fn: Expr; arg: Expr };

const base = (name: string): Type => ({ kind: "base", name });
const arrow = (from: Type, to: Type): Type => ({ kind: "arrow", from, to });
const bvar = (idx: number): Expr => ({ kind: "bvar", idx });
const lam = (type: Type, body: Expr): Expr => ({ kind: "lam", type, body });
const app = (fn: Expr, arg: Expr): Expr => ({ kind: "app", fn, arg });

function showT(t: Type): string {
  return t.kind === "base" ? t.name : `(${showT(t.from)} -> ${showT(t.to)})`;
}
function show(e: Expr): string {
  switch (e.kind) {
    case "bvar":
      return `#${e.idx}`;
    case "lam":
      return `(fun : ${showT(e.type)} => ${show(e.body)})`;
    case "app":
      return `(${show(e.fn)} ${show(e.arg)})`;
  }
}

// Two types are equal when they have the same shape. Chapter 6 replaces
// this one function with the half of the kernel that runs programs.
function typeEq(a: Type, b: Type): boolean {
  if (a.kind === "base" && b.kind === "base") return a.name === b.name;
  if (a.kind === "arrow" && b.kind === "arrow") return typeEq(a.from, b.from) && typeEq(a.to, b.to);
  return false;
}

// The context is a stack of types: ctx[0] is the type of #0.
type Ctx = Type[];
type Verdict = { ok: true; type: Type } | { ok: false; reason: string };

function infer(ctx: Ctx, e: Expr): Verdict {
  switch (e.kind) {
    case "bvar": {
      // T-VAR: look the index up.
      const t = ctx[e.idx];
      return t === undefined ? { ok: false, reason: `#${e.idx} is not in scope` } : { ok: true, type: t };
    }
    case "lam": {
      // T-LAM: type the body with the argument pushed, then wrap.
      const body = infer([e.type, ...ctx], e.body);
      return body.ok ? { ok: true, type: arrow(e.type, body.type) } : body;
    }
    case "app": {
      // T-APP: the function must be an arrow, and its domain must match the argument.
      const f = infer(ctx, e.fn);
      if (!f.ok) return f;
      if (f.type.kind !== "arrow") return { ok: false, reason: `${showT(f.type)} is not a function type` };
      const a = infer(ctx, e.arg);
      if (!a.ok) return a;
      if (!typeEq(f.type.from, a.type)) {
        return { ok: false, reason: `argument has type ${showT(a.type)}, function wants ${showT(f.type.from)}` };
      }
      return { ok: true, type: f.type.to };
    }
  }
}

function report(ctx: Ctx, e: Expr): void {
  const v = infer(ctx, e);
  console.log(`${show(e)}  :  ${v.ok ? showT(v.type) : `refused — ${v.reason}`}`);
}

const A = base("A");
const B = base("B");

// fun f : A -> B => fun x : A => f x — the derivation the chapter worked.
report([], lam(arrow(A, B), lam(A, app(bvar(1), bvar(0)))));

// (fun x : A => x) y, with y : B in scope as #0. Only T-APP can refuse.
report([B], app(lam(A, bvar(0)), bvar(0)));

// Chapter 2's three programs, with a type on each binder. The first two
// are accepted. The third is the term that never stopped: for `x x` to
// type, x would need to be an arrow and its own domain at once, and no
// type is. The first program a type takes away is the one that loops.
report([], lam(A, bvar(0)));
report([], lam(A, lam(B, bvar(1))));
report([], lam(A, app(bvar(0), bvar(0))));

// To break it: delete the typeEq test in the app case and rerun. The
// refused line now prints a type for a term that hands a B to a function
// wanting an A. The checker did not crash; it lied. Every rule the rest
// of the book adds is one more place where exactly this can go wrong.

export {}; // keeps this file a self-contained module
