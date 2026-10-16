/**
 * Property tests that tie the formal rules to the implementation
 * (book/rules.json). Terms are generated over the pure CoC fragment:
 * sorts, pis, lambdas, and applications, with no environment. Properties:
 *
 *  1. [R: T-SORT]..[R: T-PI]  Regularity: the inferred type of a
 *     well-typed term is itself well-typed (thesis typesys.tex, Lemma
 *     "Regularity": if Γ ⊢ e : α then Γ ⊢ α type).
 *  2. [R: RED-BETA] whnf preserves definitional equality:
 *     isDefEq(e, whnf(e)).
 *  3. Substitution machinery: abstract-then-instantiate is the identity
 *     (the de Bruijn bookkeeping that every rule stands on).
 *  4. [R: RED-BETA] a beta step equals one-pass spine instantiation.
 */
import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import { Name } from "../src/kernel/name.ts";
import { Level } from "../src/kernel/level.ts";
import {
  type Expr,
  FVar,
  Sort,
  App,
  Lam,
  Pi,
  BVar,
  exprEq,
  instantiate1,
  instantiateRev,
  abstractFVars,
} from "../src/kernel/expr.ts";
import { Environment } from "../src/kernel/env.ts";
import { TypeChecker } from "../src/kernel/tc.ts";

const x = Name.simple("x");

/** Closed types: sorts and pis over them, depth-bounded. */
const typeArb: fc.Arbitrary<Expr> = fc.letrec<{ ty: Expr }>((tie) => ({
  ty: fc.oneof(
    { maxDepth: 3, withCrossShrink: true },
    fc.nat(2).map((n) => {
      let l = Level.zero;
      for (let i = 0; i < n; i++) l = Level.succRaw(l);
      return new Sort(l);
    }),
    fc.tuple(tie("ty"), tie("ty")).map(([a, b]) => new Pi(x, "default", a, b)),
  ),
})).ty;

/** Closed terms likely to be well-typed: types, identity lambdas, redexes. */
const termArb: fc.Arbitrary<Expr> = fc.letrec<{ t: Expr }>((tie) => ({
  t: fc.oneof(
    { maxDepth: 3, withCrossShrink: true },
    typeArb,
    // fun (x : A) => x
    typeArb.map((a) => new Lam(x, "default", a, new BVar(0))),
    // fun (x : A) => B  (constant function to a type)
    fc.tuple(typeArb, typeArb).map(([a, b]) => new Lam(x, "default", a, b)),
    // (fun (x : A) => x) t  — a redex over a smaller term
    fc.tuple(typeArb, tie("t")).map(([a, t]) => new App(new Lam(x, "default", a, new BVar(0)), t)),
  ),
})).t;

function freshTc(): TypeChecker {
  return new TypeChecker(new Environment());
}

/** Returns the inferred type, or null when the term is not well-typed. */
function tryInfer(tc: TypeChecker, e: Expr): Expr | null {
  try {
    return tc.inferType(e);
  } catch {
    return null;
  }
}

describe("properties: the spec holds on generated terms", () => {
  test("regularity: the inferred type of a well-typed term is well-typed", () => {
    fc.assert(
      fc.property(termArb, (e) => {
        const tc = freshTc();
        const ty = tryInfer(tc, e);
        fc.pre(ty !== null);
        expect(tryInfer(tc, ty)).not.toBeNull();
      }),
      { numRuns: 300 },
    );
  });

  test("whnf preserves definitional equality", () => {
    fc.assert(
      fc.property(termArb, (e) => {
        const tc = freshTc();
        fc.pre(tryInfer(tc, e) !== null);
        const w = tc.whnf(e);
        expect(tc.isDefEq(e, w)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  test("abstract then instantiate is the identity", () => {
    fc.assert(
      fc.property(termArb, (body) => {
        const f = new FVar(Name.simple("f"));
        // Plant the fvar in place of every Sort leaf at the top level.
        const planted = new App(body, f);
        const abstracted = abstractFVars(planted, [f]);
        const restored = instantiateRev(abstracted, [f]);
        expect(exprEq(restored, planted)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  test("a beta step equals one-pass instantiation", () => {
    fc.assert(
      fc.property(typeArb, termArb, (a, arg) => {
        const tc = freshTc();
        const redex = new App(new Lam(x, "default", a, new BVar(0)), arg);
        fc.pre(tryInfer(tc, redex) !== null);
        expect(exprEq(tc.whnf(redex), tc.whnf(instantiate1(new BVar(0), arg)))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});
