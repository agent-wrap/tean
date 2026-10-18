// Chapter 4 — Computation is substitution.
// whnf: reduce the head until it stops, and not one node more.

type Expr =
  | { kind: "bvar"; idx: number }
  | { kind: "const"; name: string }
  | { kind: "app"; fn: Expr; arg: Expr }
  | { kind: "lam"; type: Expr; body: Expr };

const bvar = (idx: number): Expr => ({ kind: "bvar", idx });
const app = (fn: Expr, arg: Expr): Expr => ({ kind: "app", fn, arg });
const lam = (type: Expr, body: Expr): Expr => ({ kind: "lam", type, body });
const cnst = (name: string): Expr => ({ kind: "const", name });

function lift(e: Expr, start: number, amount: number): Expr {
  switch (e.kind) {
    case "bvar":
      return e.idx >= start ? bvar(e.idx + amount) : e;
    case "const":
      return e;
    case "app":
      return app(lift(e.fn, start, amount), lift(e.arg, start, amount));
    case "lam":
      return lam(lift(e.type, start, amount), lift(e.body, start + 1, amount));
  }
}

function instantiate(e: Expr, a: Expr, depth = 0): Expr {
  switch (e.kind) {
    case "bvar":
      if (e.idx === depth) return lift(a, 0, depth);
      return e.idx > depth ? bvar(e.idx - 1) : e;
    case "const":
      return e;
    case "app":
      return app(instantiate(e.fn, a, depth), instantiate(e.arg, a, depth));
    case "lam":
      return lam(instantiate(e.type, a, depth), instantiate(e.body, a, depth + 1));
  }
}

// Definitions the head may unfold (delta).
const env = new Map<string, Expr>();

// Weak head normal form, with a step log.
// NOTE: this sketch substitutes ONE argument per beta step, because that
// is the short way to write it. The real checker collects the whole
// application spine first and instantiates all of its arguments in a
// single pass over the body — see the chapter's rule 1. One at a time
// re-walks the body once per argument, which is quadratic in the spine.
function whnf(e: Expr, log: string[]): Expr {
  if (e.kind === "app" && e.fn.kind === "lam") {
    log.push("beta");
    return whnf(instantiate(e.fn.body, e.arg), log);
  }
  if (e.kind === "app" && e.fn.kind === "app") {
    const fn = whnf(e.fn, log);
    return fn === e.fn ? e : whnf(app(fn, e.arg), log);
  }
  const head = e.kind === "app" ? e.fn : e;
  if (head.kind === "const" && env.has(head.name)) {
    log.push(`delta: ${head.name}`);
    const v = env.get(head.name);
    if (v !== undefined) return whnf(e.kind === "app" ? app(v, e.arg) : v, log);
  }
  return e; // a lam, a bare const, or a stuck application: weak head stops.
}

function show(e: Expr): string {
  switch (e.kind) {
    case "bvar":
      return `#${e.idx}`;
    case "const":
      return e.name;
    case "app":
      return `(${show(e.fn)} ${show(e.arg)})`;
    case "lam":
      return `(fun => ${show(e.body)})`;
  }
}

function run(label: string, e: Expr): void {
  const log: string[] = [];
  const r = whnf(e, log);
  console.log(`${label}  ~>  ${show(r)}   [${log.join(", ")}]`);
}

const T = cnst("T");
// two = fun f => fun x => f (f x)
const two = lam(T, lam(T, app(bvar(1), app(bvar(1), bvar(0)))));
env.set("two", two);

run("two g", app(cnst("two"), cnst("g")));
// The body of a lambda is NOT reduced: weak head normal form stops at
// the first binder. The redex (two g) inside survives untouched.
run("fun => (two g)", lam(T, app(cnst("two"), cnst("g"))));
// Head redexes chain: ((fun => #0) two) g needs beta, delta, beta.
run("((fun => #0) two) g", app(app(lam(T, bvar(0)), cnst("two")), cnst("g")));

// To break it: make whnf reduce inside lam bodies too (full
// normalization). Every answer stays "the same" up to computation — and
// chapter 12 measures the price: real proofs reach reduction depths in
// the tens of thousands, and eager reduction does all of that work even
// when the first head symbol already decides the comparison.

export {}; // keeps this file a self-contained module
