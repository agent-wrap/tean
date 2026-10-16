// Chapter 10 — The cost.
// The cache experiment: identity keys miss what reduction rebuilds.

import { Name } from "../../src/kernel/name.ts";
import { type Expr, Const, App, exprEq } from "../../src/kernel/expr.ts";

// Reduction rebuilds equal terms as FRESH objects. Simulate that:
function build(): Expr {
  const f = new Const(Name.simple("f"), []);
  const a = new Const(Name.simple("a"), []);
  let e: Expr = a;
  for (let i = 0; i < 10; i++) e = new App(f, e);
  return e;
}

const first = build();
const rebuilt = build(); // equal tree, all-new object identities
console.log(`exprEq(first, rebuilt)    : ${exprEq(first, rebuilt)}`);
console.log(`same object?              : ${first === rebuilt}`);
console.log(`hashes agree?             : ${first.hash === rebuilt.hash}`);

// Cache 1: identity-keyed, the JavaScript default.
const identityCache = new Map<Expr, string>();
identityCache.set(first, "cached result");
console.log(`identity cache hit        : ${identityCache.has(rebuilt)}`);

// Cache 2: hash buckets + structural equality, as the kernel's expr_map.
class StructuralMap {
  private buckets = new Map<number, { k: Expr; v: string }[]>();
  set(k: Expr, v: string): void {
    const b = this.buckets.get(k.hash) ?? [];
    if (b.length === 0) this.buckets.set(k.hash, b);
    b.push({ k, v });
  }
  get(k: Expr): string | undefined {
    for (const e of this.buckets.get(k.hash) ?? []) {
      if (e.k === k || exprEq(e.k, k)) return e.v;
    }
    return undefined;
  }
}
const structuralCache = new StructuralMap();
structuralCache.set(first, "cached result");
console.log(`structural cache hit      : ${structuralCache.get(rebuilt) !== undefined}`);

// The measured consequence, from docs/NOTEBOOK.md (2026-10-15): with
// identity-keyed whnf/infer/defeq caches, the arena test
// discarded-argument-match ran out of memory. With structural keys it
// finished in 1.4 seconds. Same algorithm; the only change is the line
// above that can say "yes" to an object it has never met.

// To break it: make StructuralMap.get compare with === only, and watch
// the hit turn false. Then consider the quieter failure: a hash that
// includes what equality ignores (binder names, for instance) sends
// equal terms to different buckets, and the cache silently never hits.
// The hash must forget exactly what the equality forgets.
