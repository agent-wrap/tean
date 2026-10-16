/**
 * Quotient types, ported from lean4 src/kernel/quot.cpp.
 * The checker never trusts the exported quotient types: it constructs the
 * canonical four declarations itself and compares.
 */
import { Name } from "./name.ts";
import { Level } from "./level.ts";
import { type Expr, Sort, Const, App, Pi, mkAppN, exprEq } from "./expr.ts";
import { Environment, KernelError, type Decl } from "./env.ts";
import { LocalCtx } from "./tc.ts";
import { quotName, quotMkName, quotLiftName, quotIndName } from "./tc.ts";

const eqName = Name.simple("Eq");

function mkArrow(a: Expr, b: Expr): Expr {
  return new Pi(Name.anonymous, "default", a, b);
}

function checkEqType(env: Environment): void {
  const eqInfo = env.find(eqName);
  if (eqInfo === undefined || eqInfo.kind !== "induct")
    throw new KernelError("failed to initialize quot module, environment does not have 'Eq' type");
  if (eqInfo.cv.lparams.length !== 1)
    throw new KernelError("failed to initialize quot module, unexpected number of universe params at 'Eq' type");
  if (eqInfo.ctors.length !== 1)
    throw new KernelError("failed to initialize quot module, unexpected number of constructors for 'Eq' type");
  const lctx = new LocalCtx();
  {
    const u = Level.param(eqInfo.cv.lparams[0]!);
    const alpha = lctx.mkLocalDecl(Name.simple("α"), new Sort(u), "implicit");
    const expectedEqType = lctx.mkPi([alpha], mkArrow(alpha, mkArrow(alpha, new Sort(Level.zero))));
    if (!exprEq(expectedEqType, eqInfo.cv.type))
      throw new KernelError("failed to initialize quot module, 'Eq' has an unexpected type");
  }
  {
    const eqReflInfo = env.get(eqInfo.ctors[0]!);
    const u = Level.param(eqReflInfo.cv.lparams[0]!);
    const alpha = lctx.mkLocalDecl(Name.simple("α"), new Sort(u), "implicit");
    const a = lctx.mkLocalDecl(Name.simple("a"), alpha);
    const expectedReflType = lctx.mkPi([alpha, a], mkAppN(new Const(eqName, [u]), [alpha, a, a]));
    if (!exprEq(eqReflInfo.cv.type, expectedReflType))
      throw new KernelError("failed to initialize quot module, unexpected type for 'Eq' type constructor");
  }
}

/** Build the four canonical quotient declarations and add them to env. */
export function addQuot(env: Environment): void {
  if (env.quotInitialized) return;
  checkEqType(env);
  env.checkName(quotName);
  env.checkName(quotMkName);
  env.checkName(quotLiftName);
  env.checkName(quotIndName);
  const uName = Name.simple("u");
  const u = Level.param(uName);
  const sortU = new Sort(u);
  const prop = new Sort(Level.zero);
  const lctx = new LocalCtx();

  let alpha = lctx.mkLocalDecl(Name.simple("α"), sortU, "implicit");
  let r = lctx.mkLocalDecl(Name.simple("r"), mkArrow(alpha, mkArrow(alpha, prop)));
  // Quot.{u} {α : Sort u} (r : α → α → Prop) : Sort u
  env.addCore({
    kind: "quot",
    cv: { name: quotName, lparams: [uName], type: lctx.mkPi([alpha, r], sortU) },
    quotKind: "type",
  });
  let quotR: Expr = mkAppN(new Const(quotName, [u]), [alpha, r]);
  let a = lctx.mkLocalDecl(Name.simple("a"), alpha);
  // Quot.mk.{u} {α : Sort u} (r : α → α → Prop) (a : α) : @Quot.{u} α r
  env.addCore({
    kind: "quot",
    cv: { name: quotMkName, lparams: [uName], type: lctx.mkPi([alpha, r, a], quotR) },
    quotKind: "ctor",
  });
  // Make r implicit.
  const lctx2 = new LocalCtx();
  alpha = lctx2.mkLocalDecl(Name.simple("α"), sortU, "implicit");
  r = lctx2.mkLocalDecl(Name.simple("r"), mkArrow(alpha, mkArrow(alpha, prop)), "implicit");
  quotR = mkAppN(new Const(quotName, [u]), [alpha, r]);
  a = lctx2.mkLocalDecl(Name.simple("a"), alpha);
  const vName = Name.simple("v");
  const v = Level.param(vName);
  const sortV = new Sort(v);
  let beta = lctx2.mkLocalDecl(Name.simple("β"), sortV, "implicit");
  const f = lctx2.mkLocalDecl(Name.simple("f"), mkArrow(alpha, beta));
  const b = lctx2.mkLocalDecl(Name.simple("b"), alpha);
  const rab = mkAppN(r, [a, b]);
  const faEqFb = mkAppN(new Const(eqName, [v]), [beta, new App(f, a), new App(f, b)]);
  const sanity = lctx2.mkPi([a, b], mkArrow(rab, faEqFb));
  // Quot.lift.{u v} {α : Sort u} {r : α → α → Prop} {β : Sort v} (f : α → β)
  //   : (∀ a b : α, r a b → f a = f b) → @Quot.{u} α r → β
  env.addCore({
    kind: "quot",
    cv: {
      name: quotLiftName,
      lparams: [uName, vName],
      type: lctx2.mkPi([alpha, r, beta, f], mkArrow(sanity, mkArrow(quotR, beta))),
    },
    quotKind: "lift",
  });
  // {β : @Quot.{u} α r → Prop}
  beta = lctx2.mkLocalDecl(Name.simple("β"), mkArrow(quotR, prop), "implicit");
  const quotMkA = mkAppN(new Const(quotMkName, [u]), [alpha, r, a]);
  const allQuot = lctx2.mkPi([a], new App(beta, quotMkA));
  const q = lctx2.mkLocalDecl(Name.simple("q"), quotR);
  const betaQ = new App(beta, q);
  // Quot.ind.{u} {α : Sort u} {r : α → α → Prop} {β : @Quot.{u} α r → Prop}
  //   : (∀ a : α, β (@Quot.mk.{u} α r a)) → ∀ q : @Quot.{u} α r, β q
  env.addCore({
    kind: "quot",
    cv: {
      name: quotIndName,
      lparams: [uName],
      type: lctx2.mkPi([alpha, r, beta], new Pi(Name.simple("mk"), "default", allQuot, lctx2.mkPi([q], betaQ))),
    },
    quotKind: "ind",
  });
  env.quotInitialized = true;
}

/** Validate one exported quot declaration against the canonical one. */
export function checkExportedQuot(env: Environment, exported: Extract<Decl, { kind: "quot" }>): void {
  const installed = env.find(exported.cv.name);
  if (installed === undefined || installed.kind !== "quot")
    throw new KernelError(`exported quotient declaration '${exported.cv.name}' is not a quotient primitive`);
  if (installed.quotKind !== exported.quotKind)
    throw new KernelError(`exported quotient declaration '${exported.cv.name}' has the wrong kind`);
  if (
    installed.cv.lparams.length !== exported.cv.lparams.length ||
    !exprEq(
      installed.cv.type,
      // Rename the exported level params to the canonical ones before comparing.
      renameLevelParams(exported.cv.type, exported.cv.lparams, installed.cv.lparams),
    )
  )
    throw new KernelError(`exported quotient declaration '${exported.cv.name}' has the wrong type`);
}

import { instantiateLevelParams } from "./expr.ts";
function renameLevelParams(e: Expr, from: Name[], to: Name[]): Expr {
  return instantiateLevelParams(
    e,
    from,
    to.map((n) => Level.param(n)),
  );
}
