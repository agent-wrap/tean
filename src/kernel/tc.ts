/**
 * The type checker: whnf, infer_type, is_def_eq.
 * Ported from lean4 src/kernel/type_checker.cpp and the reduction templates
 * in inductive.h and quot.h, at githash 5045d005 (Lean 4.34.1).
 */
import { Name } from "./name.ts";
import {
  Level,
  isEquivalent,
  mkSucc,
  mkIMax,
  normalizesToZero,
  getUndefParam,
} from "./level.ts";
import {
  type Expr,
  ExprKind,
  type BinderInfo,
  BVar,
  FVar,
  Sort,
  Const,
  App,
  Lam,
  Pi,
  Let,
  Lit,
  Proj,
  exprEq,
  mkAppN,
  getAppFn,
  getAppArgs,
  getAppNumArgs,
  hasLooseBVars,
  instantiate,
  instantiate1,
  instantiateRev,
  abstractFVars,
  instantiateLevelParams,
  cheapBetaReduce,
  exprToString,
} from "./expr.ts";
import { KernelError } from "./error.ts";
import {
  Environment, type Decl, type DefinitionSafety, type RecVal, type Hints, compareHints, declHasValue, declIsUnsafe, recMajorIdx, isNonRecStructure, } from "./env.ts";
import { isWeakened } from "./weaken.ts";

// ---------------------------------------------------------------------------
// Known names
// ---------------------------------------------------------------------------

const natName = Name.simple("Nat");
const boolName = Name.simple("Bool");
const stringName = Name.simple("String");
const natZero = natName.str("zero");
const natSucc = natName.str("succ");
const natAdd = natName.str("add");
const natSub = natName.str("sub");
const natMul = natName.str("mul");
const natPow = natName.str("pow");
const natGcd = natName.str("gcd");
const natMod = natName.str("mod");
const natDiv = natName.str("div");
const natBeq = natName.str("beq");
const natBle = natName.str("ble");
const natLand = natName.str("land");
const natLor = natName.str("lor");
const natXor = natName.str("xor");
const natShiftLeft = natName.str("shiftLeft");
const natShiftRight = natName.str("shiftRight");
const boolTrue = boolName.str("true");
const boolFalse = boolName.str("false");
const stringOfList = stringName.str("ofList");
const listCons = Name.simple("List", "cons");
const listNil = Name.simple("List", "nil");
const charOfNat = Name.simple("Char", "ofNat");
const charName = Name.simple("Char");
export const quotName = Name.simple("Quot");
export const quotMkName = quotName.str("mk");
export const quotLiftName = quotName.str("lift");
export const quotIndName = quotName.str("ind");

const natBinOps: ReadonlySet<Name> = new Set([
  natAdd, natSub, natMul, natPow, natGcd, natMod, natDiv,
  natLand, natLor, natXor, natShiftLeft, natShiftRight,
]);

const mkBoolTrue = () => new Const(boolTrue, []);
const mkBoolFalse = () => new Const(boolFalse, []);

/** Upper bound in bytes on Nat numerals, as in the real kernel. */
const NAT_MAX_SIZE = 128 * 1024 * 1024;

function natSizeBytes(v: bigint): number {
  if (v < 0x100000000n) return 4;
  // Base-16 conversion is linear in the size of the numeral.
  return Math.ceil(v.toString(16).length / 2);
}

function checkNatSize(numBytes: number): void {
  if (numBytes > NAT_MAX_SIZE)
    throw new KernelError("natLimit", "the kernel refused a `Nat` numeral because its size exceeds the maximum",
    );
}

function getCountArg(count: bigint, op: string): number {
  if (count > 0xffffffffn)
    throw new KernelError("natLimit", `the kernel refused to evaluate \`${op}\` because its second argument does not fit in a 32-bit unsigned integer`,
    );
  return Number(count);
}

function natLitToConstructor(v: bigint): Expr {
  if (v === 0n) return new Const(natZero, []);
  return new App(new Const(natSucc, []), new Lit(v - 1n));
}

function stringLitToConstructor(s: string): Expr {
  const charType = new Const(charName, []);
  const consC = new App(new Const(listCons, [Level.zero]), charType);
  const nilC = new App(new Const(listNil, [Level.zero]), charType);
  const ofNat = new Const(charOfNat, []);
  const cps = Array.from(s).map((c) => BigInt(c.codePointAt(0) ?? 0));
  let r: Expr = nilC;
  for (let i = cps.length - 1; i >= 0; i--) {
    r = mkAppN(consC, [new App(ofNat, new Lit(cps[i]!)), r]);
  }
  return new App(new Const(stringOfList, []), r);
}

function litType(e: Lit): Expr {
  return typeof e.val === "bigint" ? new Const(natName, []) : new Const(stringName, []);
}

// ---------------------------------------------------------------------------
// Local context
// ---------------------------------------------------------------------------

export interface LocalDecl {
  fvar: FVar;
  userName: Name;
  type: Expr;
  binderInfo: BinderInfo;
  value?: Expr;
}

export class LocalCtx {
  readonly map = new Map<number, LocalDecl>();

  mkLocalDecl(userName: Name, type: Expr, binderInfo: BinderInfo = "default", value?: Expr): FVar {
    const fvar = new FVar(userName);
    const decl: LocalDecl = { fvar, userName, type, binderInfo };
    if (value !== undefined) decl.value = value;
    this.map.set(fvar.fid, decl);
    return fvar;
  }

  find(f: FVar): LocalDecl | undefined {
    return this.map.get(f.fid);
  }

  private mkBinding(isLambda: boolean, fvars: readonly FVar[], e: Expr): Expr {
    let r = abstractFVars(e, fvars);
    for (let i = fvars.length - 1; i >= 0; i--) {
      const decl = this.map.get(fvars[i]!.fid);
      if (decl === undefined) throw new KernelError("unknownFVar", "unknown free variable in mkBinding");
      const prefix = fvars.slice(0, i);
      const ty = abstractFVars(decl.type, prefix);
      if (decl.value !== undefined) {
        const v = abstractFVars(decl.value, prefix);
        r = new Let(decl.userName, ty, v, r, false);
      } else if (isLambda) {
        r = new Lam(decl.userName, decl.binderInfo, ty, r);
      } else {
        r = new Pi(decl.userName, decl.binderInfo, ty, r);
      }
    }
    return r;
  }

  mkPi(fvars: readonly FVar[], e: Expr): Expr {
    return this.mkBinding(false, fvars, e);
  }

  mkLambda(fvars: readonly FVar[], e: Expr): Expr {
    return this.mkBinding(true, fvars, e);
  }
}

// ---------------------------------------------------------------------------
// The type checker
// ---------------------------------------------------------------------------

const Lbool = {
  False: 0,
  True: 1,
  Undef: 2,
} as const;
type Lbool = (typeof Lbool)[keyof typeof Lbool];

function toLbool(b: boolean): Lbool {
  return b ? Lbool.True : Lbool.False;
}

function natGcdFn(a: bigint, b: bigint): bigint {
  while (a !== 0n) {
    const t = b % a;
    b = a;
    a = t;
  }
  return b;
}

const ReductionStatus = {
  Continue: 0,
  DefUnknown: 1,
  DefEqual: 2,
  DefDiff: 3,
} as const;
type ReductionStatus = (typeof ReductionStatus)[keyof typeof ReductionStatus];

/**
 * A map keyed on structural equality of expressions, not object identity.
 * Reduction rebuilds equal terms as fresh objects, so an identity-keyed
 * cache misses and the work repeats. Hash buckets with an equality scan
 * mirror the expr_map of the real kernel.
 */
class ExprMap<V> {
  private buckets = new Map<number, { k: Expr; v: V }[]>();

  get(k: Expr): V | undefined {
    const b = this.buckets.get(k.hash);
    if (b === undefined) return undefined;
    for (const e of b) {
      if (e.k === k || exprEq(e.k, k)) return e.v;
    }
    return undefined;
  }

  set(k: Expr, v: V): void {
    const existing = this.buckets.get(k.hash);
    const b = existing ?? [];
    if (existing === undefined) this.buckets.set(k.hash, b);
    for (const e of b) {
      if (e.k === k || exprEq(e.k, k)) {
        e.v = v;
        return;
      }
    }
    b.push({ k, v });
  }
}

/** A set of unordered expression pairs, keyed structurally. */
class ExprPairSet {
  private buckets = new Map<number, { a: Expr; b: Expr }[]>();

  private key(a: Expr, b: Expr): number {
    // Order-free combination.
    return ((a.hash ^ b.hash) + ((a.hash & b.hash) | 0)) | 0;
  }

  has(a: Expr, b: Expr): boolean {
    const bucket = this.buckets.get(this.key(a, b));
    if (bucket === undefined) return false;
    for (const e of bucket) {
      if ((exprEq(e.a, a) && exprEq(e.b, b)) || (exprEq(e.a, b) && exprEq(e.b, a))) return true;
    }
    return false;
  }

  add(a: Expr, b: Expr): void {
    if (this.has(a, b)) return;
    const k = this.key(a, b);
    const existing = this.buckets.get(k);
    const bucket = existing ?? [];
    if (existing === undefined) this.buckets.set(k, bucket);
    bucket.push({ a, b });
  }
}

// TEAN_DEBUG_CHURN=1: count whnfCore calls by head constant and dump the
// top counts periodically, with one sample term per head. A sync print is
// the only probe that works while a declaration blocks the event loop.
// This found the Nat.beq unary-descent hang on the init corpus
// (docs/NOTEBOOK.md 2026-10-16).
const debugChurn =
  process.env["TEAN_DEBUG_CHURN"] === "1"
    ? new (class {
        private counts = new Map<string, number>();
        private samples = new Map<string, string>();
        private n = 0;
        tick(e: Expr): void {
          const h = getAppFn(e);
          const key =
            h.kind === ExprKind.Const
              ? h.name.toString()
              : h.kind === ExprKind.Lam
                ? "(lam)"
                : h.kind === ExprKind.Proj
                  ? `proj:${h.structName.toString()}`
                  : `(kind ${h.kind})`;
          this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
          if (this.n > 30_000_000 && !this.samples.has(key)) {
            this.samples.set(key, exprToString(e).slice(0, 350));
          }
          if (++this.n % 20_000_000 === 0) {
            const top = [...this.counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
            console.error(`..churn after ${this.n} whnfCore calls:`);
            for (const [k, c] of top) {
              console.error(`    ${c} ${k}`);
              const sample = this.samples.get(k);
              if (sample !== undefined) console.error(`      sample: ${sample}`);
            }
          }
        }
      })()
    : null;

export class TypeChecker {
  readonly env: Environment;
  lctx: LocalCtx;
  private definitionSafety: DefinitionSafety;
  private lparams: Name[] | null = null;

  private inferTypeCache: [ExprMap<Expr>, ExprMap<Expr>] = [new ExprMap(), new ExprMap()];
  private whnfCoreCache = new ExprMap<Expr>();
  private whnfCache = new ExprMap<Expr>();
  private defeqSuccess = new ExprPairSet();
  private defeqFailure = new ExprPairSet();

  constructor(env: Environment, safety: DefinitionSafety = "safe", lctx?: LocalCtx) {
    this.env = env;
    this.definitionSafety = safety;
    this.lctx = lctx ?? new LocalCtx();
  }

  // -- entry points ---------------------------------------------------------

  inferType(e: Expr): Expr {
    return this.inferTypeCore(e, true);
  }

  /** Full checking: also validates universe params against `lps`. */
  check(e: Expr, lps: Name[]): Expr {
    const saved = this.lparams;
    this.lparams = lps;
    try {
      return this.inferTypeCore(e, false);
    } finally {
      this.lparams = saved;
    }
  }

  // -- small helpers --------------------------------------------------------

  ensureSortCore(e: Expr, s: Expr): Sort {
    if (e.kind === ExprKind.Sort) return e;
    const n = this.whnf(e);
    if (n.kind === ExprKind.Sort) return n;
    throw new KernelError("typeExpected", `type expected at\n  ${exprToString(s)}`);
  }

  ensurePiCore(e: Expr, s: Expr): Pi {
    if (e.kind === ExprKind.Pi) return e;
    const n = this.whnf(e);
    if (n.kind === ExprKind.Pi) return n;
    throw new KernelError("functionExpected", `function expected at\n  ${exprToString(s)}`);
  }

  ensureSort(e: Expr, s: Expr): Sort {
    return this.ensureSortCore(e, s);
  }

  /** ensure_type: the type of `e` must be a sort. */
  ensureType(e: Expr): Sort {
    return this.ensureSortCore(this.inferType(e), e);
  }

  private checkLevel(l: Level): void {
    if (this.lparams !== null) {
      const undef = getUndefParam(l, this.lparams);
      if (undef !== null)
        throw new KernelError("universe", `invalid reference to undefined universe level parameter '${undef}'`);
    }
  }

  isProp(e: Expr): boolean {
    const s = this.ensureSort(this.inferType(e), e);
    return normalizesToZero(s.level);
  }

  // -- infer ----------------------------------------------------------------

  private inferFVar(e: FVar): Expr {
    const decl = this.lctx.find(e);
    if (decl === undefined) throw new KernelError("unknownFVar", "unknown free variable");
    return decl.type;
  }

  private inferConstant(e: Const, inferOnly: boolean): Expr {
    const info = this.env.get(e.name);
    const ps = info.cv.lparams;
    const ls = e.levels;
    if (ps.length !== ls.length)
      throw new KernelError("universe", `incorrect number of universe levels parameters for '${e.name}', #${ps.length} expected, #${ls.length} provided`,
      );
    if (!inferOnly) {
      if (declIsUnsafe(info) && this.definitionSafety !== "unsafe")
        throw new KernelError("unsafe", `invalid declaration, it uses unsafe declaration '${e.name}'`);
      if (info.kind === "def" && info.safety === "partial" && this.definitionSafety === "safe")
        throw new KernelError("unsafe", `invalid declaration, safe declaration must not contain partial declaration '${e.name}'`,
        );
      for (const l of ls) this.checkLevel(l);
    }
    return instantiateLevelParams(info.cv.type, ps, ls);
  }

  private inferLambda(e0: Expr, inferOnly: boolean): Expr {
    const fvars: FVar[] = [];
    let e = e0;
    while (e.kind === ExprKind.Lam) {
      const d = instantiateRev(e.type, fvars);
      if (!inferOnly) {
        this.ensureSortCore(this.inferTypeCore(d, inferOnly), d);
      }
      fvars.push(this.lctx.mkLocalDecl(e.binderName, d, e.binderInfo));
      e = e.body;
    }
    let r = this.inferTypeCore(instantiateRev(e, fvars), inferOnly);
    r = cheapBetaReduce(r);
    return this.lctx.mkPi(fvars, r);
  }

  private inferPi(e0: Expr, inferOnly: boolean): Expr {
    const fvars: FVar[] = [];
    const us: Level[] = [];
    let e = e0;
    while (e.kind === ExprKind.Pi) {
      const d = instantiateRev(e.type, fvars);
      const t1 = this.ensureSortCore(this.inferTypeCore(d, inferOnly), d);
      us.push(t1.level);
      fvars.push(this.lctx.mkLocalDecl(e.binderName, d, e.binderInfo));
      e = e.body;
    }
    const inst = instantiateRev(e, fvars);
    const s = this.ensureSortCore(this.inferTypeCore(inst, inferOnly), inst);
    let r = s.level;
    for (let i = fvars.length - 1; i >= 0; i--) {
      r = mkIMax(us[i]!, r);
    }
    return new Sort(r);
  }

  private inferApp(e: App, inferOnly: boolean): Expr {
    if (!inferOnly) {
      const fType = this.ensurePiCore(this.inferTypeCore(e.fn, inferOnly), e);
      const aType = this.inferTypeCore(e.arg, inferOnly);
      const dType = fType.type;
      if (!this.isDefEq(aType, dType)) {
        throw new KernelError("typeMismatch", `application type mismatch at\n  ${exprToString(e)}\nargument type\n  ${exprToString(aType)}\nexpected type\n  ${exprToString(dType)}`,
        );
      }
      return instantiate1(fType.body, e.arg);
    }
    const [f, args] = getAppArgs(e);
    let fType = this.inferTypeCore(f, true);
    let j = 0;
    const n = args.length;
    for (let i = 0; i < n; i++) {
      if (fType.kind === ExprKind.Pi) {
        fType = fType.body;
      } else {
        fType = instantiateRev(fType, args.slice(j, i));
        fType = this.ensurePiCore(fType, e);
        fType = fType.body;
        j = i;
      }
    }
    return instantiateRev(fType, args.slice(j, n));
  }

  private inferLet(e0: Expr, inferOnly: boolean): Expr {
    const fvars: FVar[] = [];
    let e = e0;
    while (e.kind === ExprKind.Let) {
      const type = instantiateRev(e.type, fvars);
      const val = instantiateRev(e.value, fvars);
      if (!inferOnly) {
        this.ensureSortCore(this.inferTypeCore(type, inferOnly), type);
        const valType = this.inferTypeCore(val, inferOnly);
        if (!this.isDefEq(valType, type)) {
          throw new KernelError("typeMismatch", `type mismatch at \`let ${e.binderName}\``);
        }
      }
      fvars.push(this.lctx.mkLocalDecl(e.binderName, type, "default", val));
      e = e.body;
    }
    let r = this.inferTypeCore(instantiateRev(e, fvars), inferOnly);
    r = cheapBetaReduce(r);
    return this.lctx.mkPi(fvars, r);
  }

  private inferProj(e: Proj, inferOnly: boolean): Expr {
    const type = this.whnf(this.inferTypeCore(e.struct, inferOnly));
    if (!Number.isSafeInteger(e.idx) || e.idx < 0 || e.idx > 0xffffffff)
      throw new KernelError("invalidProjection", `invalid projection\n  ${exprToString(e)}`);
    const invalidMsg = (): string => `invalid projection\n  ${exprToString(e)}`;
    const [I, args] = getAppArgs(type);
    if (I.kind !== ExprKind.Const) throw new KernelError("invalidProjection", invalidMsg());
    if (I.name !== e.structName) throw new KernelError("invalidProjection", invalidMsg());
    const IInfo = this.env.get(I.name);
    if (IInfo.kind !== "induct") throw new KernelError("invalidProjection", invalidMsg());
    if (IInfo.ctors.length !== 1 || args.length !== IInfo.numParams + IInfo.numIndices) throw new KernelError("invalidProjection", invalidMsg());

    const cInfo = this.env.get(IInfo.ctors[0]!);
    let r = instantiateLevelParams(cInfo.cv.type, cInfo.cv.lparams, I.levels);
    for (let i = 0; i < IInfo.numParams; i++) {
      r = this.whnf(r);
      if (r.kind !== ExprKind.Pi) throw new KernelError("invalidProjection", invalidMsg());
      r = instantiate1(r.body, args[i]!);
    }
    const isPropType = this.isProp(type);
    for (let i = 0; i < e.idx; i++) {
      r = this.whnf(r);
      if (r.kind !== ExprKind.Pi) throw new KernelError("invalidProjection", invalidMsg());
      if (hasLooseBVars(r.body)) {
        if (isPropType && !this.isProp(r.type)) throw new KernelError("invalidProjection", invalidMsg());
        r = instantiate1(r.body, new Proj(I.name, i, e.struct));
      } else {
        r = r.body;
      }
    }
    r = this.whnf(r);
    if (r.kind !== ExprKind.Pi) throw new KernelError("invalidProjection", invalidMsg());
    r = r.type;
    if (isPropType && !this.isProp(r)) throw new KernelError("invalidProjection", invalidMsg());
    return r;
  }

  private inferLit(e: Lit): Expr {
    if (typeof e.val === "bigint") checkNatSize(natSizeBytes(e.val));
    return litType(e);
  }

  private inferTypeCore(e: Expr, inferOnly: boolean): Expr {
    if (hasLooseBVars(e))
      throw new KernelError("looseBVar", "type checker does not support loose bound variables");
    const cache = this.inferTypeCache[inferOnly ? 1 : 0];
    const cached = cache.get(e);
    if (cached !== undefined) return cached;

    let r: Expr;
    switch (e.kind) {
      case ExprKind.Lit:
        r = this.inferLit(e);
        break;
      case ExprKind.Proj:
        r = this.inferProj(e, inferOnly);
        break;
      case ExprKind.FVar:
        r = this.inferFVar(e);
        break;
      case ExprKind.BVar:
        throw new KernelError("unreachable", "unreachable: loose bvar in inferTypeCore");
      case ExprKind.Sort:
        if (!inferOnly) this.checkLevel(e.level);
        r = new Sort(mkSucc(e.level));
        break;
      case ExprKind.Const:
        r = this.inferConstant(e, inferOnly);
        break;
      case ExprKind.Lam:
        r = this.inferLambda(e, inferOnly);
        break;
      case ExprKind.Pi:
        r = this.inferPi(e, inferOnly);
        break;
      case ExprKind.App:
        r = this.inferApp(e, inferOnly);
        break;
      case ExprKind.Let:
        r = this.inferLet(e, inferOnly);
        break;
    }
    cache.set(e, r);
    return r;
  }

  // -- whnf -----------------------------------------------------------------

  private isLetFVar(e: FVar): boolean {
    const decl = this.lctx.find(e);
    return decl?.value !== undefined;
  }

  private whnfFVar(e: FVar, cheapRec: boolean, cheapProj: boolean): Expr {
    const decl = this.lctx.find(e);
    if (decl?.value !== undefined) {
      return this.whnfCore(decl.value, cheapRec, cheapProj);
    }
    return e;
  }

  private reduceProjCore(c0: Expr, sname: Name, idx: number): Expr | null {
    let c = c0;
    if (c.kind === ExprKind.Lit && typeof c.val === "string") {
      c = this.whnf(stringLitToConstructor(c.val));
    }
    const [mk, args] = getAppArgs(c);
    if (mk.kind !== ExprKind.Const) return null;
    const mkInfo = this.env.find(mk.name);
    if (mkInfo?.kind !== "ctor") return null;
    if (mkInfo.induct !== sname) return null;
    const nparams = mkInfo.numParams;
    if (nparams + idx < args.length) return args[nparams + idx]!;
    return null;
  }

  private reduceProj(e: Proj, cheapRec: boolean, cheapProj: boolean): Expr | null {
    if (!Number.isSafeInteger(e.idx)) return null;
    const c = cheapProj ? this.whnfCore(e.struct, cheapRec, cheapProj) : this.whnf(e.struct);
    return this.reduceProjCore(c, e.structName, e.idx);
  }

  whnfCore(e: Expr, cheapRec = false, cheapProj = false): Expr {
    if (debugChurn !== null) debugChurn.tick(e);
    switch (e.kind) {
      case ExprKind.BVar:
      case ExprKind.Sort:
      case ExprKind.Pi:
      case ExprKind.Const:
      case ExprKind.Lam:
      case ExprKind.Lit:
        return e;
      case ExprKind.FVar:
        if (!this.isLetFVar(e)) return e;
        break;
      default:
        break;
    }

    if (!cheapRec && !cheapProj) {
      const cached = this.whnfCoreCache.get(e);
      if (cached !== undefined) return cached;
    }

    let r: Expr;
    switch (e.kind) {
      case ExprKind.FVar:
        return this.whnfFVar(e, cheapRec, cheapProj);
      case ExprKind.Proj: {
        const m = this.reduceProj(e, cheapRec, cheapProj);
        r = m !== null ? this.whnfCore(m, cheapRec, cheapProj) : e;
        break;
      }
      case ExprKind.App: {
        const [f0, args] = getAppArgs(e);
        const f = this.whnfCore(f0, cheapRec, cheapProj);
        if (f.kind === ExprKind.Lam) {
          let m = 1;
          let fn: Expr = f;
          while ((fn as Lam).body.kind === ExprKind.Lam && m < args.length) {
            fn = (fn as Lam).body;
            m++;
          }
          // Discharge the whole spine in one pass: #0 gets the m-th argument.
          const subst: Expr[] = [];
          for (let i = m - 1; i >= 0; i--) subst.push(args[i]!);
          r = this.whnfCore(
            mkAppN(instantiate((fn as Lam).body, subst), args.slice(m)),
            cheapRec,
            cheapProj,
          );
        } else if (f === f0) {
          const red = this.reduceRecursor(e, cheapRec, cheapProj);
          if (red !== null) {
            return this.whnfCore(red, cheapRec, cheapProj);
          } else {
            return e;
          }
        } else {
          r = this.whnfCore(mkAppN(f, args), cheapRec, cheapProj);
        }
        break;
      }
      case ExprKind.Let:
        r = this.whnfCore(instantiate1(e.body, e.value), cheapRec, cheapProj);
        break;
      default:
        throw new KernelError("unreachable", "unreachable in whnfCore");
    }

    if (!cheapRec && !cheapProj) {
      this.whnfCoreCache.set(e, r);
    }
    return r;
  }

  private isDelta(e: Expr): Extract<Decl, { kind: "def" | "thm" | "opaque" }> | null {
    const f = getAppFn(e);
    if (f.kind !== ExprKind.Const) return null;
    const info = this.env.find(f.name);
    if (info !== undefined && declHasValue(info) && f.levels.length === info.cv.lparams.length) return info;
    return null;
  }

  private unfoldCache = new ExprMap<Expr>();

  private unfoldDefinitionCore(e: Expr): Expr | null {
    if (e.kind === ExprKind.Const) {
      const d = this.isDelta(e);
      if (d !== null) {
        // The m_unfold cache of the real kernel: level instantiation of a
        // definition value repeats for the same constant instance.
        // Measured at 24.5% of magma-list-deep-n21 before this cache.
        if (e.levels.length > 0) {
          const cached = this.unfoldCache.get(e);
          if (cached !== undefined) return cached;
          const r = instantiateLevelParams(d.value, d.cv.lparams, e.levels);
          this.unfoldCache.set(e, r);
          return r;
        }
        return instantiateLevelParams(d.value, d.cv.lparams, e.levels);
      }
    }
    return null;
  }

  private unfoldDefinition(e: Expr): Expr | null {
    if (e.kind === ExprKind.App) {
      const [f0, args] = getAppArgs(e);
      const f = this.unfoldDefinitionCore(f0);
      if (f !== null) return mkAppN(f, args);
      return null;
    }
    return this.unfoldDefinitionCore(e);
  }

  whnf(e: Expr): Expr {
    switch (e.kind) {
      case ExprKind.BVar:
      case ExprKind.Sort:
      case ExprKind.Pi:
      case ExprKind.Lit:
        return e;
      case ExprKind.FVar:
        if (!this.isLetFVar(e)) return e;
        break;
      default:
        break;
    }

    const cached = this.whnfCache.get(e);
    if (cached !== undefined) return cached;

    let t: Expr = e;
    for (;;) {
      const t1 = this.whnfCore(t);
      const v = this.reduceNat(t1);
      if (v !== null) {
        this.whnfCache.set(e, v);
        return v;
      }
      const next = this.unfoldDefinition(t1);
      if (next !== null) {
        t = next;
      } else {
        this.whnfCache.set(e, t1);
        return t1;
      }
    }
  }

  // -- Nat literal reduction ------------------------------------------------

  private isNatLitExt(e: Expr): bigint | null {
    if (e.kind === ExprKind.Const && e.name === natZero && e.levels.length === 0) return 0n;
    if (e.kind === ExprKind.Lit && typeof e.val === "bigint") return e.val;
    return null;
  }

  /** The head of a Nat-valued arithmetic application, or null. */
  private natOpHead(e: Expr): { op: Name; args: Expr[] } | null {
    if (e.kind !== ExprKind.App) return null;
    const nargs = getAppNumArgs(e);
    if (nargs === 1) {
      const f = e.fn;
      if (f.kind === ExprKind.Const && f.name === natSucc && f.levels.length === 0) {
        return { op: natSucc, args: [e.arg] };
      }
      return null;
    }
    if (nargs !== 2) return null;
    const f = (e.fn as App).fn;
    if (f.kind !== ExprKind.Const || f.levels.length !== 0) return null;
    if (natBinOps.has(f.name)) return { op: f.name, args: [(e.fn as App).arg, e.arg] };
    return null;
  }

  private applyNatOp(op: Name, a: bigint, b: bigint): bigint {
    if (op === natAdd) {
      const r = a + b;
      checkNatSize(natSizeBytes(r));
      return r;
    }
    if (op === natSub) {
      const r = a > b ? a - b : 0n;
      checkNatSize(natSizeBytes(r));
      return r;
    }
    if (op === natMul) {
      const r = a * b;
      checkNatSize(natSizeBytes(r));
      return r;
    }
    if (op === natPow) {
      const k = getCountArg(b, "Nat.pow");
      if (a > 1n && k !== 0 && natSizeBytes(a) > NAT_MAX_SIZE / k)
        throw new KernelError("natLimit", "the kernel refused to evaluate `Nat.pow` because the result would exceed the maximum numeral size");
      return a ** BigInt(k);
    }
    if (op === natGcd) return natGcdFn(a, b);
    if (op === natMod) return b === 0n ? a : a % b;
    if (op === natDiv) return b === 0n ? 0n : a / b;
    if (op === natLand) return a & b;
    if (op === natLor) return a | b;
    if (op === natXor) return a ^ b;
    if (op === natShiftLeft) {
      if (a !== 0n) {
        const k = getCountArg(b, "Nat.shiftLeft");
        checkNatSize(natSizeBytes(a) + Math.floor(k / 8) + 1);
      }
      return a << b;
    }
    if (op === natShiftRight) return b > 0xffffffffn ? 0n : a >> b;
    throw new KernelError("unreachable", "unknown Nat op in applyNatOp");
  }

  /**
   * Evaluate a Nat expression to a literal, walking nested arithmetic with
   * an explicit stack. The recursive form (reduceNat -> whnf -> reduceNat)
   * overflowed the JS stack on real input: the init corpus holds literal
   * arithmetic chains deep enough to exhaust 640k frames
   * (docs/NOTEBOOK.md 2026-10-16). Non-arithmetic subterms still go
   * through one whnf call each; only the arithmetic spine is iterative.
   */
  private natEvalToLit(e0: Expr): bigint | null {
    interface VisitFrame {
      kind: 0;
      e: Expr;
      whnfed: boolean;
    }
    interface ApplyFrame {
      kind: 1;
      op: Name;
    }
    const stack: (VisitFrame | ApplyFrame)[] = [{ kind: 0, e: e0, whnfed: false }];
    const values: bigint[] = [];
    while (stack.length > 0) {
      const f = stack.pop()!;
      if (f.kind === 1) {
        if (f.op === natSucc) {
          const a = values.pop()!;
          const r = a + 1n;
          checkNatSize(natSizeBytes(r));
          values.push(r);
        } else {
          const b = values.pop()!;
          const a = values.pop()!;
          values.push(this.applyNatOp(f.op, a, b));
        }
        continue;
      }
      const lit = this.isNatLitExt(f.e);
      if (lit !== null) {
        values.push(lit);
        continue;
      }
      const arith = this.natOpHead(f.e);
      if (arith !== null) {
        stack.push({ kind: 1, op: arith.op });
        for (let i = arith.args.length - 1; i >= 0; i--) {
          stack.push({ kind: 0, e: arith.args[i]!, whnfed: false });
        }
        continue;
      }
      if (f.whnfed) return null; // whnf made no progress toward a literal
      const w = this.whnf(f.e);
      if (w === f.e || exprEq(w, f.e)) return null;
      stack.push({ kind: 0, e: w, whnfed: true });
    }
    return values.pop() ?? null;
  }

  private reduceNat(e: Expr): Expr | null {
    const nargs = getAppNumArgs(e);
    if (nargs === 1) {
      const f = (e as App).fn;
      if (f.kind === ExprKind.Const && f.name === natSucc && f.levels.length === 0) {
        const v = this.natEvalToLit((e as App).arg);
        if (v === null) return null;
        const r = v + 1n;
        checkNatSize(natSizeBytes(r));
        return new Lit(r);
      }
      return null;
    }
    if (nargs !== 2) return null;
    const app = e as App;
    const f = (app.fn as App).fn;
    if (f.kind !== ExprKind.Const || f.levels.length !== 0) return null;
    const n = f.name;
    if (n === natBeq || n === natBle) {
      const v1 = this.natEvalToLit((app.fn as App).arg);
      if (v1 === null) return null;
      const v2 = this.natEvalToLit(app.arg);
      if (v2 === null) return null;
      const r = n === natBeq ? v1 === v2 : v1 <= v2;
      return r ? mkBoolTrue() : mkBoolFalse();
    }
    if (!natBinOps.has(n)) return null;
    const v1 = this.natEvalToLit((app.fn as App).arg);
    if (v1 === null) return null;
    const v2 = this.natEvalToLit(app.arg);
    if (v2 === null) return null;
    return new Lit(this.applyNatOp(n, v1, v2));
  }

  // -- recursor reduction (iota, quot, K) -----------------------------------

  private reduceRecursor(e: Expr, cheapRec: boolean, cheapProj: boolean): Expr | null {
    if (this.env.quotInitialized) {
      const r = this.quotReduceRec(e);
      if (r !== null) return r;
    }
    return this.inductiveReduceRec(e, cheapRec, cheapProj);
  }

  private quotReduceRec(e: Expr): Expr | null {
    const fn = getAppFn(e);
    if (fn.kind !== ExprKind.Const) return null;
    let mkPos: number;
    let argPos: number;
    if (fn.name === quotLiftName) {
      mkPos = 5;
      argPos = 3;
    } else if (fn.name === quotIndName) {
      mkPos = 4;
      argPos = 3;
    } else {
      return null;
    }
    const [, args] = getAppArgs(e);
    if (args.length <= mkPos) return null;
    const mk = this.whnf(args[mkPos]!);
    const [mkFn] = getAppArgs(mk);
    if (mkFn.kind !== ExprKind.Const || mkFn.name !== quotMkName || getAppNumArgs(mk) !== 3) return null;
    const f = args[argPos]!;
    let r: Expr = new App(f, (mk as App).arg);
    const elimArity = mkPos + 1;
    if (args.length > elimArity) r = mkAppN(r, args.slice(elimArity));
    return r;
  }

  private mkNullaryCnstr(type: Expr, numParams: number): Expr | null {
    const [d, args] = getAppArgs(type);
    if (d.kind !== ExprKind.Const) return null;
    const info = this.env.find(d.name);
    if (info?.kind !== "induct" || info.ctors.length === 0) return null;
    return mkAppN(new Const(info.ctors[0]!, d.levels), args.slice(0, numParams));
  }

  private expandEtaStruct(eType: Expr, e: Expr): Expr {
    const [I, args] = getAppArgs(eType);
    if (I.kind !== ExprKind.Const) return e;
    const IInfo = this.env.find(I.name);
    if (IInfo?.kind !== "induct" || IInfo.ctors.length === 0) return e;
    const ctorName = IInfo.ctors[0]!;
    const ctorVal = this.env.get(ctorName);
    if (ctorVal.kind !== "ctor") return e;
    let result: Expr = mkAppN(new Const(ctorName, I.levels), args.slice(0, ctorVal.numParams));
    for (let i = 0; i < ctorVal.numFields; i++) {
      result = new App(result, new Proj(I.name, i, e));
    }
    return result;
  }

  private isConstructorApp(e: Expr): boolean {
    const fn = getAppFn(e);
    if (fn.kind !== ExprKind.Const) return false;
    const info = this.env.find(fn.name);
    return info?.kind === "ctor";
  }

  private toCnstrWhenK(rval: RecVal, e: Expr, whnfFn: (x: Expr) => Expr): Expr {
    const appType = whnfFn(this.inferType(e));
    const appTypeI = getAppFn(appType);
    if (appTypeI.kind !== ExprKind.Const || appTypeI.name !== recMajorInductCached(rval)) return e;
    const newCnstrApp = this.mkNullaryCnstr(appType, rval.numParams);
    if (newCnstrApp === null) return e;
    const newType = this.inferType(newCnstrApp);
    // [R: RED-K] the guard; weakened only by the forgery gate (flag RED-K-GUARD).
    if (!isWeakened("RED-K-GUARD") && !this.isDefEq(appType, newType)) return e;
    return newCnstrApp;
  }

  private toCnstrWhenStructure(inductName: Name, e: Expr, whnfFn: (x: Expr) => Expr): Expr {
    if (!isNonRecStructure(this.env, inductName) || this.isConstructorApp(e)) return e;
    const eType = whnfFn(this.inferType(e));
    const head = getAppFn(eType);
    if (head.kind !== ExprKind.Const || head.name !== inductName) return e;
    if (this.isProp(eType)) return e;
    return this.expandEtaStruct(eType, e);
  }

  private inductiveReduceRec(e: Expr, cheapRec: boolean, cheapProj: boolean): Expr | null {
    const whnfFn = cheapRec ? (x: Expr) => this.whnfCore(x, cheapRec, cheapProj) : (x: Expr) => this.whnf(x);
    const recFn = getAppFn(e);
    if (recFn.kind !== ExprKind.Const) return null;
    const recInfo = this.env.find(recFn.name);
    if (recInfo?.kind !== "rec") return null;
    const [, recArgs] = getAppArgs(e);
    const majorIdx = recMajorIdx(recInfo);
    if (majorIdx >= recArgs.length) return null;
    let major = recArgs[majorIdx]!;
    if (recInfo.k) {
      major = this.toCnstrWhenK(recInfo, major, whnfFn);
    }
    major = whnfFn(major);
    if (major.kind === ExprKind.Lit && typeof major.val === "bigint") {
      major = natLitToConstructor(major.val);
    } else if (major.kind === ExprKind.Lit && typeof major.val === "string") {
      major = whnfFn(stringLitToConstructor(major.val));
    } else {
      major = this.toCnstrWhenStructure(recMajorInductCached(recInfo), major, whnfFn);
    }
    const majorFn = getAppFn(major);
    if (majorFn.kind !== ExprKind.Const) return null;
    const rule = recInfo.rules.find((r) => r.ctor === (majorFn).name);
    if (rule === undefined) return null;
    const [, majorArgs] = getAppArgs(major);
    if (rule.nfields > majorArgs.length) return null;
    if (recFn.levels.length !== recInfo.cv.lparams.length) return null;
    let rhs = instantiateLevelParams(rule.rhs, recInfo.cv.lparams, recFn.levels);
    rhs = mkAppN(rhs, recArgs.slice(0, recInfo.numParams + recInfo.numMotives + recInfo.numMinors));
    const nparams = majorArgs.length - rule.nfields;
    rhs = mkAppN(rhs, majorArgs.slice(nparams, nparams + rule.nfields));
    if (recArgs.length > majorIdx + 1) {
      rhs = mkAppN(rhs, recArgs.slice(majorIdx + 1));
    }
    return rhs;
  }

  // -- is_def_eq ------------------------------------------------------------

  isDefEq(t: Expr, s: Expr): boolean {
    const r = this.isDefEqCore(t, s);
    if (r) this.cacheSuccess(t, s);
    return r;
  }

  isDefEqLevels(ls1: Level[], ls2: Level[]): boolean {
    if (ls1.length !== ls2.length) return false;
    for (let i = 0; i < ls1.length; i++) {
      if (!isEquivalent(ls1[i]!, ls2[i]!)) return false;
    }
    return true;
  }

  private cacheSuccess(t: Expr, s: Expr): void {
    this.defeqSuccess.add(t, s);
  }

  private succeededBefore(t: Expr, s: Expr): boolean {
    return this.defeqSuccess.has(t, s);
  }

  private cacheFailure(t: Expr, s: Expr): void {
    this.defeqFailure.add(t, s);
  }

  private failedBefore(t: Expr, s: Expr): boolean {
    return this.defeqFailure.has(t, s);
  }

  private isDefEqBinding(t0: Expr, s0: Expr): boolean {
    const kind = t0.kind;
    let t = t0 as Lam | Pi;
    let s = s0 as Lam | Pi;
    const subst: Expr[] = [];
    const dontCare = new Const(Name.simple("dontcare"), []);
    for (;;) {
      let varSType: Expr | null = null;
      if (!exprEq(t.type, s.type)) {
        varSType = instantiateRev(s.type, subst);
        const varTType = instantiateRev(t.type, subst);
        if (!this.isDefEq(varTType, varSType)) return false;
      }
      if (t.body.looseBVarRange > 0 || s.body.looseBVarRange > 0) {
        varSType ??= instantiateRev(s.type, subst);
        subst.push(this.lctx.mkLocalDecl(s.binderName, varSType, s.binderInfo));
      } else {
        subst.push(dontCare);
      }
      const tb: Expr = t.body;
      const sb: Expr = s.body;
      if (tb.kind === kind && sb.kind === kind) {
        t = tb as Lam | Pi;
        s = sb as Lam | Pi;
      } else {
        return this.isDefEq(instantiateRev(tb, subst), instantiateRev(sb, subst));
      }
    }
  }

  private quickIsDefEq(t: Expr, s: Expr): Lbool {
    if (exprEq(t, s) || this.succeededBefore(t, s)) return Lbool.True;
    if (t.kind === s.kind) {
      switch (t.kind) {
        case ExprKind.Lam:
        case ExprKind.Pi:
          return toLbool(this.isDefEqBinding(t, s));
        case ExprKind.Sort:
          return toLbool(isEquivalent(t.level, (s as Sort).level));
        case ExprKind.Lit:
          return toLbool(t.val === (s as Lit).val);
        default:
          break;
      }
    }
    return Lbool.Undef;
  }

  private isDefEqArgs(t: Expr, s: Expr): boolean {
    while (t.kind === ExprKind.App && s.kind === ExprKind.App) {
      if (!this.isDefEq(t.arg, s.arg)) return false;
      t = t.fn;
      s = s.fn;
    }
    return t.kind !== ExprKind.App && s.kind !== ExprKind.App;
  }

  private tryEtaExpansionCore(t: Expr, s: Expr): boolean {
    if (t.kind === ExprKind.Lam && s.kind !== ExprKind.Lam) {
      const sType = this.whnf(this.inferType(s));
      if (sType.kind !== ExprKind.Pi) return false;
      const newS = new Lam(sType.binderName, sType.binderInfo, sType.type, new App(s, new BVar(0)));
      return this.isDefEq(t, newS);
    }
    return false;
  }

  private tryEtaExpansion(t: Expr, s: Expr): boolean {
    return this.tryEtaExpansionCore(t, s) || this.tryEtaExpansionCore(s, t);
  }

  private tryEtaStructCore(t: Expr, s: Expr): boolean {
    const f = getAppFn(s);
    if (f.kind !== ExprKind.Const) return false;
    const fInfo = this.env.find(f.name);
    if (fInfo?.kind !== "ctor") return false;
    if (getAppNumArgs(s) !== fInfo.numParams + fInfo.numFields) return false;
    if (!isNonRecStructure(this.env, fInfo.induct)) return false;
    if (!this.isDefEq(this.inferType(t), this.inferType(s))) return false;
    const [, sArgs] = getAppArgs(s);
    for (let i = fInfo.numParams; i < sArgs.length; i++) {
      const proj = new Proj(fInfo.induct, i - fInfo.numParams, t);
      if (!this.isDefEq(proj, sArgs[i]!)) return false;
    }
    return true;
  }

  private tryEtaStruct(t: Expr, s: Expr): boolean {
    return this.tryEtaStructCore(t, s) || this.tryEtaStructCore(s, t);
  }

  private isDefEqApp(t: Expr, s: Expr): boolean {
    if (t.kind !== ExprKind.App || s.kind !== ExprKind.App) return false;
    const [tFn, tArgs] = getAppArgs(t);
    const [sFn, sArgs] = getAppArgs(s);
    if (!this.isDefEq(tFn, sFn) || tArgs.length !== sArgs.length) return false;
    for (let i = 0; i < tArgs.length; i++) {
      if (!this.isDefEq(tArgs[i]!, sArgs[i]!)) return false;
    }
    return true;
  }

  private isDefEqProofIrrel(t: Expr, s: Expr): Lbool {
    const tType = this.inferType(t);
    if (!this.isProp(tType)) return Lbool.Undef;
    const sType = this.inferType(s);
    return toLbool(this.isDefEq(tType, sType));
  }

  private tryUnfoldProjApp(e: Expr): Expr | null {
    const f = getAppFn(e);
    if (f.kind !== ExprKind.Proj) return null;
    const eNew = this.whnfCore(e);
    return eNew !== e && !exprEq(eNew, e) ? eNew : null;
  }

  /** One lazy delta step. Returns the new pair plus a status. */
  private lazyDeltaReductionStep(tn: Expr, sn: Expr): { t: Expr; s: Expr; status: ReductionStatus } {
    const dT = this.isDelta(tn);
    const dS = this.isDelta(sn);
    if (dT === null && dS === null) {
      return { t: tn, s: sn, status: ReductionStatus.DefUnknown };
    } else if (dT !== null && dS === null) {
      const snNew = this.tryUnfoldProjApp(sn);
      if (snNew !== null) sn = snNew;
      else tn = this.whnfCore(this.unfoldDefinition(tn)!, false, true);
    } else if (dT === null && dS !== null) {
      const tnNew = this.tryUnfoldProjApp(tn);
      if (tnNew !== null) tn = tnNew;
      else sn = this.whnfCore(this.unfoldDefinition(sn)!, false, true);
    } else {
      const hT = (dT as { hints?: Hints }).hints ?? ({ kind: "opaque" });
      const hS = (dS as { hints?: Hints }).hints ?? ({ kind: "opaque" });
      const c = compareHints(hT, hS);
      if (c < 0) {
        tn = this.whnfCore(this.unfoldDefinition(tn)!, false, true);
      } else if (c > 0) {
        sn = this.whnfCore(this.unfoldDefinition(sn)!, false, true);
      } else {
        if (
          tn.kind === ExprKind.App &&
          sn.kind === ExprKind.App &&
          dT === dS &&
          hT.kind === "regular"
        ) {
          if (!this.failedBefore(tn, sn)) {
            const tFn = getAppFn(tn) as Const;
            const sFn = getAppFn(sn) as Const;
            if (this.isDefEqLevels(tFn.levels, sFn.levels) && this.isDefEqArgs(tn, sn)) {
              return { t: tn, s: sn, status: ReductionStatus.DefEqual };
            }
            this.cacheFailure(tn, sn);
          }
        }
        tn = this.whnfCore(this.unfoldDefinition(tn)!, false, true);
        sn = this.whnfCore(this.unfoldDefinition(sn)!, false, true);
      }
    }
    switch (this.quickIsDefEq(tn, sn)) {
      case Lbool.True:
        return { t: tn, s: sn, status: ReductionStatus.DefEqual };
      case Lbool.False:
        return { t: tn, s: sn, status: ReductionStatus.DefDiff };
      case Lbool.Undef:
        return { t: tn, s: sn, status: ReductionStatus.Continue };
    }
  }

  private isNatZeroExpr(t: Expr): boolean {
    if (t.kind === ExprKind.Const && t.name === natZero && t.levels.length === 0) return true;
    return t.kind === ExprKind.Lit && t.val === 0n;
  }

  private isNatSuccExpr(t: Expr): Expr | null {
    if (t.kind === ExprKind.Lit && typeof t.val === "bigint" && t.val !== 0n) {
      return new Lit(t.val - 1n);
    }
    const fn = getAppFn(t);
    if (fn.kind === ExprKind.Const && fn.name === natSucc && getAppNumArgs(t) === 1) {
      return (t as App).arg;
    }
    return null;
  }

  private isDefEqOffset(t: Expr, s: Expr): Lbool {
    if (this.isNatZeroExpr(t) && this.isNatZeroExpr(s)) return Lbool.True;
    const predT = this.isNatSuccExpr(t);
    const predS = this.isNatSuccExpr(s);
    if (predT !== null && predS !== null) return toLbool(this.isDefEqCore(predT, predS));
    return Lbool.Undef;
  }

  private lazyDeltaReduction(tn0: Expr, sn0: Expr): { t: Expr; s: Expr; result: Lbool } {
    let tn = tn0;
    let sn = sn0;
    for (;;) {
      const r = this.isDefEqOffset(tn, sn);
      if (r !== Lbool.Undef) return { t: tn, s: sn, result: r };

      // DIVERGENCE [R: RED-NAT]: the C++ kernel gates this on `!has_fvar`
      // for both sides, as a cost guard. That gate is SYNTACTIC: a
      // let-bound fvar makes hasFVar true while the term is definitionally
      // closed, and skipping reduceNat here sends `Nat.beq` into its unary
      // `._f` form — measured at ~4.3e9 reduction steps on
      // Char.ofOrdinal._proof_3 in the real `init` corpus. We run it
      // ungated; it returns null unless both arguments whnf to literals,
      // so it can only fail sooner, never answer differently.
      // Full reasoning and evidence: docs/DIVERGENCES.md.
      {
        const tV = this.reduceNat(tn);
        if (tV !== null) return { t: tn, s: sn, result: toLbool(this.isDefEqCore(tV, sn)) };
        const sV = this.reduceNat(sn);
        if (sV !== null) return { t: tn, s: sn, result: toLbool(this.isDefEqCore(tn, sV)) };
      }

      const step = this.lazyDeltaReductionStep(tn, sn);
      tn = step.t;
      sn = step.s;
      switch (step.status) {
        case ReductionStatus.Continue:
          break;
        case ReductionStatus.DefUnknown:
          return { t: tn, s: sn, result: Lbool.Undef };
        case ReductionStatus.DefEqual:
          return { t: tn, s: sn, result: Lbool.True };
        case ReductionStatus.DefDiff:
          return { t: tn, s: sn, result: Lbool.False };
      }
    }
  }

  private lazyDeltaProjReduction(tn: Expr, sn: Expr, sname: Name, idx: number): boolean {
    for (;;) {
      const step = this.lazyDeltaReductionStep(tn, sn);
      tn = step.t;
      sn = step.s;
      switch (step.status) {
        case ReductionStatus.Continue:
          break;
        case ReductionStatus.DefEqual:
          return true;
        case ReductionStatus.DefUnknown:
        case ReductionStatus.DefDiff: {
          const t = this.reduceProjCore(tn, sname, idx);
          if (t !== null) {
            const s = this.reduceProjCore(sn, sname, idx);
            if (s !== null) return this.isDefEqCore(t, s);
          }
          return this.isDefEqCore(tn, sn);
        }
      }
    }
  }

  private tryStringLitExpansionCore(t: Expr, s: Expr): Lbool {
    if (
      t.kind === ExprKind.Lit &&
      typeof t.val === "string" &&
      s.kind === ExprKind.App &&
      s.fn.kind === ExprKind.Const &&
      s.fn.name === stringOfList &&
      s.fn.levels.length === 0
    ) {
      return toLbool(this.isDefEqCore(this.whnf(stringLitToConstructor(t.val)), s));
    }
    return Lbool.Undef;
  }

  private tryStringLitExpansion(t: Expr, s: Expr): Lbool {
    const r = this.tryStringLitExpansionCore(t, s);
    if (r !== Lbool.Undef) return r;
    return this.tryStringLitExpansionCore(s, t);
  }

  private isDefEqUnitLike(t: Expr, s: Expr): boolean {
    const tType = this.whnf(this.inferType(t));
    const I = getAppFn(tType);
    if (I.kind !== ExprKind.Const || !isNonRecStructure(this.env, I.name)) return false;
    const IInfo = this.env.get(I.name);
    if (IInfo.kind !== "induct") return false;
    const ctorVal = this.env.get(IInfo.ctors[0]!);
    if (ctorVal.kind !== "ctor" || ctorVal.numFields !== 0) return false;
    return this.isDefEqCore(tType, this.inferType(s));
  }

  private isDefEqCore(t: Expr, s: Expr): boolean {
    let r = this.quickIsDefEq(t, s);
    if (r !== Lbool.Undef) return r === Lbool.True;

    // Basic support for proofs by reflection: fully reduce against Bool.true.
    if (!t.hasFVar && s.kind === ExprKind.Const && (s).name === boolTrue) {
      const w = this.whnf(t);
      if (w.kind === ExprKind.Const && (w).name === boolTrue) return true;
    }

    let tn = this.whnfCore(t, false, true);
    let sn = this.whnfCore(s, false, true);

    if (tn !== t || sn !== s) {
      r = this.quickIsDefEq(tn, sn);
      if (r !== Lbool.Undef) return r === Lbool.True;
    }

    r = this.isDefEqProofIrrel(tn, sn);
    if (r !== Lbool.Undef) return r === Lbool.True;

    const lazy = this.lazyDeltaReduction(tn, sn);
    tn = lazy.t;
    sn = lazy.s;
    if (lazy.result !== Lbool.Undef) return lazy.result === Lbool.True;

    if (tn.kind === ExprKind.Const && sn.kind === ExprKind.Const) {
      if (tn.name === (sn).name && this.isDefEqLevels(tn.levels, (sn).levels)) return true;
    }

    if (tn.kind === ExprKind.FVar && sn.kind === ExprKind.FVar && tn.fid === (sn).fid) return true;

    if (
      tn.kind === ExprKind.Proj &&
      sn.kind === ExprKind.Proj &&
      tn.structName === (sn).structName &&
      tn.idx === (sn).idx
    ) {
      if (this.lazyDeltaProjReduction(tn.struct, (sn).struct, tn.structName, tn.idx)) return true;
    }

    const tnn = this.whnfCore(tn);
    const snn = this.whnfCore(sn);
    if (tnn !== tn || snn !== sn) return this.isDefEqCore(tnn, snn);

    if (this.isDefEqApp(tn, sn)) return true;
    if (this.tryEtaExpansion(tn, sn)) return true;
    if (this.tryEtaStruct(tn, sn)) return true;
    r = this.tryStringLitExpansion(tn, sn);
    if (r !== Lbool.Undef) return r === Lbool.True;
    if (this.isDefEqUnitLike(tn, sn)) return true;
    return false;
  }
}

// Cache the major induct per recursor value, since it walks the type.
const majorInductCache = new WeakMap<RecVal, Name>();
function recMajorInductCached(r: RecVal): Name {
  let n = majorInductCache.get(r);
  if (n === undefined) {
    n = recMajorInductFromType(r);
    majorInductCache.set(r, n);
  }
  return n;
}

function recMajorInductFromType(r: RecVal): Name {
  const nmajor = recMajorIdx(r);
  let t: Expr = r.cv.type;
  for (let i = 0; i < nmajor; i++) {
    if (t.kind !== ExprKind.Pi) throw new KernelError("recursor", `recursor '${r.cv.name}' type has too few binders`);
    t = t.body;
  }
  if (t.kind !== ExprKind.Pi) throw new KernelError("recursor", `recursor '${r.cv.name}' type has no major premise`);
  const head = getAppFn(t.type);
  if (head.kind !== ExprKind.Const)
    throw new KernelError("recursor", `recursor '${r.cv.name}' major premise is not an inductive application`);
  return head.name;
}
