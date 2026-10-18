// Chapter 1 — A proof is data.
// A term is a tree. A checker is a function over that tree.
// Paste this whole file into any TypeScript playground and run it.

type Expr =
  | { kind: "sort"; level: number } // a universe: Sort 0, Sort 1, ...
  | { kind: "const"; name: string } // a reference to the environment
  | { kind: "app"; fn: Expr; arg: Expr } // f a
  | { kind: "lam"; binder: string; type: Expr; body: Expr } // fun x : T => b
  | { kind: "pi"; binder: string; type: Expr; body: Expr }; // (x : T) -> B

// One declaration: a name, a stated type, and (for a definition) a value.
interface Declaration {
  name: string;
  type: Expr;
  value?: Expr;
}

// The environment is everything checked so far.
type Environment = Map<string, Declaration>;

// The whole trade in one signature. No I/O, no state, no trust:
// data goes in, a verdict comes out.
type Verdict = { ok: true } | { ok: false; reason: string };
declare function check(env: Environment, d: Declaration): Verdict;

// A term is just a value. Here is `fun x : Nat => f x` as data:
const sample: Expr = {
  kind: "lam",
  binder: "x",
  type: { kind: "const", name: "Nat" },
  body: {
    kind: "app",
    fn: { kind: "const", name: "f" },
    // CHEATING, and worth noticing: `x` here is a variable bound by the
    // `fun` above, but the grammar has no node for one, so it is written
    // as a const — which the chapter defines as a lookup in the
    // environment. It is not. Chapter 2 is about why the right node for
    // a variable is a number.
    arg: { kind: "const", name: "x" },
  },
};

function size(e: Expr): number {
  switch (e.kind) {
    case "sort":
    case "const":
      return 1;
    case "app":
      return 1 + size(e.fn) + size(e.arg);
    case "lam":
    case "pi":
      return 1 + size(e.type) + size(e.body);
  }
}

function show(e: Expr): string {
  switch (e.kind) {
    case "sort":
      return `Sort ${e.level}`;
    case "const":
      return e.name;
    case "app":
      return `(${show(e.fn)} ${show(e.arg)})`;
    case "lam":
      return `(fun ${e.binder} : ${show(e.type)} => ${show(e.body)})`;
    case "pi":
      return `((${e.binder} : ${show(e.type)}) -> ${show(e.body)})`;
  }
}

console.log(show(sample));
console.log(`nodes: ${size(sample)}`);

// To break it: add a new kind to Expr, say `lit`. The two switch
// statements stop compiling until you handle it. That compile error is
// the chapter's claim in miniature: a checker is total over its syntax,
// and the type system refuses a checker that forgot a case.

export {}; // keeps this file a self-contained module
