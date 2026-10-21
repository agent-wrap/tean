import { describe, expect, test } from "bun:test";
import { Name } from "../src/kernel/name.ts";
import { Level, levelZero } from "../src/kernel/level.ts";
import { Sort, Const, App, Lam, Pi, BVar, Lit, Proj, exprEq, instantiate1, consumeTypeAnnotations, type Expr } from "../src/kernel/expr.ts";
import { Environment } from "../src/kernel/env.ts";
import { TypeChecker } from "../src/kernel/tc.ts";
import { addInductive } from "../src/kernel/inductive.ts";

const prop = new Sort(levelZero);
const type0 = new Sort(Level.succRaw(levelZero));

function natEnv(): Environment {
  // inductive Nat | zero : Nat | succ (n : Nat) : Nat
  const env = new Environment();
  const nat = Name.simple("Nat");
  const natC = new Const(nat, []);
  addInductive(env, {
    lparams: [],
    nparams: 0,
    isUnsafe: false,
    types: [
      {
        name: nat,
        type: type0,
        ctors: [
          { name: nat.str("zero"), type: natC },
          { name: nat.str("succ"), type: new Pi(Name.simple("n"), "default", natC, natC) },
        ],
      },
    ],
  });
  return env;
}

describe("substitution", () => {
  test("instantiate replaces bvar 0", () => {
    const f = new Lam(Name.simple("x"), "default", prop, new BVar(0));
    const a = new Const(Name.simple("A"), []);
    expect(exprEq(instantiate1(f.body, a), a)).toBe(true);
  });
});

describe("basic inference", () => {
  test("Sort 0 : Sort 1", () => {
    const tc = new TypeChecker(new Environment());
    const t = tc.inferType(prop);
    expect(exprEq(t, type0)).toBe(true);
  });

  test("identity function type", () => {
    const tc = new TypeChecker(new Environment());
    // fun (A : Prop) (a : A) => a  :  (A : Prop) -> A -> A
    const id = new Lam(Name.simple("A"), "default", prop, new Lam(Name.simple("a"), "default", new BVar(0), new BVar(0)));
    const ty = tc.check(id, []);
    const expected = new Pi(Name.simple("A"), "default", prop, new Pi(Name.simple("a"), "default", new BVar(0), new BVar(1)));
    expect(exprEq(ty, expected)).toBe(true);
  });
});

describe("Nat inductive", () => {
  test("builds and gives Nat.rec", () => {
    const env = natEnv();
    const rec = env.get(Name.simple("Nat", "rec"));
    expect(rec.kind).toBe("rec");
    if (rec.kind === "rec") {
      expect(rec.numMinors).toBe(2);
      expect(rec.numMotives).toBe(1);
      expect(rec.k).toBe(false);
      expect(rec.rules.length).toBe(2);
    }
  });

  test("whnf computes 0 + succ via the recursor", () => {
    const env = natEnv();
    const tc = new TypeChecker(env);
    const nat = Name.simple("Nat");
    const natC = new Const(nat, []);
    const zero = new Const(nat.str("zero"), []);
    const succ = new Const(nat.str("succ"), []);
    // Nat.rec (motive := fun _ => Nat) zero (fun n ih => succ ih) (succ zero) ==> succ zero
    const motive = new Lam(Name.simple("t"), "default", natC, natC);
    const minorZero = zero;
    const minorSucc = new Lam(
      Name.simple("n"),
      "default",
      natC,
      new Lam(Name.simple("ih"), "default", natC, new App(succ, new BVar(0))),
    );
    const major = new App(succ, zero);
    const recApp: Expr = new App(
      new App(new App(new App(new Const(nat.str("rec"), [Level.succRaw(levelZero)]), motive), minorZero), minorSucc),
      major,
    );
    const r = tc.whnf(recApp);
    // succ (rec ... zero) reduces further to a literal via Nat.succ folding.
    expect(exprEq(r, new Lit(1n))).toBe(true);
  });

  test("literal major premise fires iota", () => {
    const env = natEnv();
    const tc = new TypeChecker(env);
    const nat = Name.simple("Nat");
    const natC = new Const(nat, []);
    const zero = new Const(nat.str("zero"), []);
    const motive = new Lam(Name.simple("t"), "default", natC, natC);
    const minorSucc = new Lam(Name.simple("n"), "default", natC, new Lam(Name.simple("ih"), "default", natC, new BVar(1)));
    const recApp: Expr = new App(
      new App(new App(new App(new Const(nat.str("rec"), [Level.succRaw(levelZero)]), motive), zero), minorSucc),
      new Lit(3n),
    );
    // rec on literal 3 gives minorSucc 2 (rec ... 2) ==> 2 as a literal.
    const r = tc.whnf(recApp);
    expect(exprEq(r, new Lit(2n))).toBe(true);
  });

  test("Nat.add on literals reduces", () => {
    const env = natEnv();
    // add is not a real definition here; test the literal path through defeq.
    const tc = new TypeChecker(env);
    expect(tc.isDefEq(new Lit(5n), new Lit(5n))).toBe(true);
    expect(tc.isDefEq(new Lit(5n), new Lit(6n))).toBe(false);
    // succ (lit 4) is defeq to lit 5 via the offset rule.
    const succ = new Const(Name.simple("Nat", "succ"), []);
    expect(tc.isDefEq(new App(succ, new Lit(4n)), new Lit(5n))).toBe(true);
  });
});

// A one-constructor, non-recursive type: a structure. It earns field
// access, a reduction rule for it, and two extra definitional
// equalities (book chapter 8).
function pairEnv(): Environment {
  const env = natEnv();
  const natC = new Const(Name.simple("Nat"), []);
  const pair = Name.simple("Pair");
  addInductive(env, {
    lparams: [],
    nparams: 0,
    isUnsafe: false,
    types: [
      {
        name: pair,
        type: type0,
        ctors: [
          {
            name: pair.str("mk"),
            type: new Pi(
              Name.simple("fst"),
              "default",
              natC,
              new Pi(Name.simple("snd"), "default", natC, new Const(pair, [])),
            ),
          },
        ],
      },
    ],
  });
  return env;
}

describe("structures and projections", () => {
  test("a projection reduces against a constructor application", () => {
    const tc = new TypeChecker(pairEnv());
    const pair = Name.simple("Pair");
    const value = new App(new App(new Const(pair.str("mk"), []), new Lit(1n)), new Lit(2n));
    expect(exprEq(tc.whnf(new Proj(pair, 0, value)), new Lit(1n))).toBe(true);
    expect(exprEq(tc.whnf(new Proj(pair, 1, value)), new Lit(2n))).toBe(true);
  });

  test("a projection against a variable is stuck, and typed by the telescope", () => {
    const tc = new TypeChecker(pairEnv());
    const pair = Name.simple("Pair");
    const p = tc.lctx.mkLocalDecl(Name.simple("p"), new Const(pair, []));
    const field = new Proj(pair, 1, p);
    expect(exprEq(tc.whnf(field), field)).toBe(true);
    expect(exprEq(tc.inferType(field), new Const(Name.simple("Nat"), []))).toBe(true);
  });

  test("structure eta: a value equals its own field-by-field copy", () => {
    const tc = new TypeChecker(pairEnv());
    const pair = Name.simple("Pair");
    const p = tc.lctx.mkLocalDecl(Name.simple("p"), new Const(pair, []));
    const copy = new App(
      new App(new Const(pair.str("mk"), []), new Proj(pair, 0, p)),
      new Proj(pair, 1, p),
    );
    expect(tc.isDefEq(p, copy)).toBe(true);
  });
});

// Conventions the kernel fixes below the level of the published theory,
// and that a derive-and-compare checker must reproduce (book chapter 12).
describe("kernel naming conventions", () => {
  test("appendAfter inserts an underscore: u becomes u_1, not u1", () => {
    expect(Name.simple("u").appendAfter(1).toString()).toBe("u_1");
    expect(Name.simple("u").appendAfter(2).toString()).toBe("u_2");
  });

  test("binder type annotations are stripped before locals are made", () => {
    const nat = new Const(Name.simple("Nat"), []);
    for (const wrapper of ["outParam", "semiOutParam"]) {
      const wrapped = new App(new Const(Name.simple(wrapper), []), nat);
      expect(exprEq(consumeTypeAnnotations(wrapped), nat)).toBe(true);
    }
    for (const wrapper of ["optParam", "autoParam"]) {
      const wrapped = new App(new App(new Const(Name.simple(wrapper), []), nat), nat);
      expect(exprEq(consumeTypeAnnotations(wrapped), nat)).toBe(true);
    }
    expect(exprEq(consumeTypeAnnotations(nat), nat)).toBe(true);
  });
});
