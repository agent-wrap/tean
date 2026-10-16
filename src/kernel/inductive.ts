/**
 * Inductive declarations: validation, recursor construction, and the
 * elimination of nested inductive types.
 * Ported from lean4 src/kernel/inductive.cpp at githash 5045d005.
 */
import { Name } from "./name.ts";
import {
  Level,
  LevelKind,
  levelListEq,
  isEquivalent,
  isNotZero,
  normalizesToZero,
  isGeq,
} from "./level.ts";
import {
  type Expr,
  ExprKind,
  FVar,
  Sort,
  Const,
  App,
  Pi,
  Lam,
  Let,
  Proj,
  BVar,
  exprEq,
  mkAppN,
  getAppFn,
  getAppArgs,
  hasLooseBVars,
  instantiate1,
  instantiateRev,
  abstractFVars,
  instantiateLevelParams,
  consumeTypeAnnotations,
} from "./expr.ts";
import { Environment, KernelError, checkDuplicatedUnivParams, type Decl, type RecRule } from "./env.ts";
import { TypeChecker, LocalCtx } from "./tc.ts";

export interface Constructor {
  name: Name;
  type: Expr;
}

export interface InductiveType {
  name: Name;
  type: Expr;
  ctors: Constructor[];
}

export interface InductiveDecl {
  lparams: Name[];
  nparams: number;
  types: InductiveType[];
  isUnsafe: boolean;
}

const nestedPrefix = Name.simple("_nested");

export function mkRecName(I: Name): Name {
  return I.str("rec");
}

// ---------------------------------------------------------------------------
// Expression traversal helpers
// ---------------------------------------------------------------------------

/** Visit every subterm with its binder offset. Descend only when f returns true. */
function forEachExpr(e: Expr, f: (t: Expr, offset: number) => boolean): void {
  const rec = (t: Expr, offset: number): void => {
    if (!f(t, offset)) return;
    switch (t.kind) {
      case ExprKind.App:
        rec(t.fn, offset);
        rec(t.arg, offset);
        break;
      case ExprKind.Lam:
      case ExprKind.Pi:
        rec(t.type, offset);
        rec(t.body, offset + 1);
        break;
      case ExprKind.Let:
        rec(t.type, offset);
        rec(t.value, offset);
        rec(t.body, offset + 1);
        break;
      case ExprKind.Proj:
        rec(t.struct, offset);
        break;
      default:
        break;
    }
  };
  rec(e, 0);
}

/** Return true when some subterm satisfies `p`. */
function findExpr(e: Expr, p: (t: Expr) => boolean): boolean {
  let found = false;
  forEachExpr(e, (t) => {
    if (found) return false;
    if (p(t)) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

/** Top-down replace: when f returns an expression, use it and do not descend. */
function replaceExpr(e: Expr, f: (t: Expr) => Expr | null): Expr {
  const rec = (t: Expr): Expr => {
    const r = f(t);
    if (r !== null) return r;
    switch (t.kind) {
      case ExprKind.App: {
        const fn = rec(t.fn);
        const arg = rec(t.arg);
        return fn === t.fn && arg === t.arg ? t : new App(fn, arg);
      }
      case ExprKind.Lam: {
        const ty = rec(t.type);
        const body = rec(t.body);
        return ty === t.type && body === t.body ? t : new Lam(t.binderName, t.binderInfo, ty, body);
      }
      case ExprKind.Pi: {
        const ty = rec(t.type);
        const body = rec(t.body);
        return ty === t.type && body === t.body ? t : new Pi(t.binderName, t.binderInfo, ty, body);
      }
      case ExprKind.Let: {
        const ty = rec(t.type);
        const v = rec(t.value);
        const body = rec(t.body);
        return ty === t.type && v === t.value && body === t.body ? t : new Let(t.binderName, ty, v, body, t.nondep);
      }
      case ExprKind.Proj: {
        const st = rec(t.struct);
        return st === t.struct ? t : new Proj(t.structName, t.idx, st);
      }
      default:
        return t;
    }
  };
  return rec(e);
}

// ---------------------------------------------------------------------------
// Pre-checks
// ---------------------------------------------------------------------------

function checkNoNestedAux(n: Name, e: Expr): void {
  if (
    findExpr(
      e,
      (t) =>
        (t.kind === ExprKind.Const && nestedPrefix.isPrefixOf(t.name)) ||
        (t.kind === ExprKind.Proj && nestedPrefix.isPrefixOf(t.structName)),
    )
  ) {
    throw new KernelError(`invalid declaration '${n}', it uses the reserved prefix '${nestedPrefix}'`);
  }
}

/** Every occurrence of a datatype being declared must be applied to the
 *  declaration's parameters and universe levels. */
function checkUniformIndOccs(d: InductiveDecl): void {
  const nparams = d.nparams;
  const lvls = d.lparams.map((p) => Level.param(p));
  const indNames = d.types.map((t) => t.name);
  for (const indType of d.types) {
    for (const cnstr of indType.ctors) {
      forEachExpr(cnstr.type, (t, offset) => {
        const [fn, args] = getAppArgs(t);
        if (fn.kind !== ExprKind.Const || !indNames.includes(fn.name)) return true;
        if (args.length > nparams) return true;
        let ok = args.length === nparams && offset >= nparams && levelListEq(fn.levels, lvls);
        for (let i = 0; ok && i < nparams; i++) {
          const a = args[i]!;
          ok = a.kind === ExprKind.BVar && a.idx === offset - 1 - i;
        }
        if (!ok)
          throw new KernelError(
            `invalid occurrence of datatype '${fn.name}' being declared: it must be applied to the parameters and universe levels of the mutual declaration`,
          );
        return false;
      });
    }
  }
}

// ---------------------------------------------------------------------------
// add_inductive_fn
// ---------------------------------------------------------------------------

interface RecInfo {
  C: FVar;
  minors: FVar[];
  indices: FVar[];
  major: FVar;
}

class AddInductiveFn {
  private env: Environment;
  private lctx = new LocalCtx();
  private lparams: Name[];
  private nparams: number;
  private isUnsafe: boolean;
  private indTypes: InductiveType[];
  private nindices: number[] = [];
  private resultLevel: Level = Level.zero;
  private levels: Level[] = [];
  private isNotZeroFlag = false;
  private params: FVar[] = [];
  private indCnsts: Const[] = [];
  private elimLevel: Level = Level.zero;
  private kTarget = false;
  private nnested: number;
  private recInfos: RecInfo[] = [];

  constructor(env: Environment, decl: InductiveDecl, nnested: number) {
    this.env = env;
    this.lparams = decl.lparams;
    this.isUnsafe = decl.isUnsafe;
    this.nparams = decl.nparams;
    this.indTypes = decl.types;
    this.nnested = nnested;
  }

  private tc(): TypeChecker {
    return new TypeChecker(this.env, this.isUnsafe ? "unsafe" : "safe", this.lctx);
  }

  private getParamType(i: number): Expr {
    return this.lctx.find(this.params[i]!)!.type;
  }

  /** All locals in add_inductive_fn go through consume_type_annotations,
   *  as mk_local_decl in inductive.cpp does. Checked against real export
   *  bytes: HAdd.rec strips the outParam wrapper from the third binder. */
  private mkLocal(n: Name, t: Expr, bi: "default" | "implicit" | "strictImplicit" | "instImplicit" = "default"): FVar {
    return this.lctx.mkLocalDecl(n, consumeTypeAnnotations(t), bi);
  }

  private mkLocalDeclFor(t: Pi): FVar {
    return this.mkLocal(t.binderName, t.type, t.binderInfo);
  }

  private whnf(t: Expr): Expr {
    return this.tc().whnf(t);
  }

  private inferType(t: Expr): Expr {
    return this.tc().inferType(t);
  }

  private isDefEq(a: Expr, b: Expr): boolean {
    return this.tc().isDefEq(a, b);
  }

  private checkInductiveTypes(): void {
    this.levels = this.lparams.map((p) => Level.param(p));
    let first = true;
    for (const indType of this.indTypes) {
      let type = indType.type;
      this.env.checkName(indType.name);
      this.env.checkName(mkRecName(indType.name));
      this.tc().check(type, this.lparams);
      this.nindices.push(0);
      let i = 0;
      type = this.whnf(type);
      while (type.kind === ExprKind.Pi) {
        if (i < this.nparams) {
          if (first) {
            const param = this.mkLocalDeclFor(type);
            this.params.push(param);
            type = instantiate1(type.body, param);
          } else {
            if (!this.isDefEq(type.type, this.getParamType(i)))
              throw new KernelError("parameters of all inductive datatypes must match");
            type = instantiate1(type.body, this.params[i]!);
          }
          i++;
        } else {
          const local = this.mkLocalDeclFor(type);
          type = instantiate1(type.body, local);
          this.nindices[this.nindices.length - 1]!++;
        }
        type = this.whnf(type);
      }
      if (i !== this.nparams)
        throw new KernelError("number of parameters mismatch in inductive datatype declaration");

      const sort = this.tc().ensureSort(type, type);

      if (first) {
        this.resultLevel = sort.level;
        this.isNotZeroFlag = isNotZero(this.resultLevel);
      } else if (!isEquivalent(sort.level, this.resultLevel)) {
        throw new KernelError("mutually inductive types must live in the same universe");
      }

      this.indCnsts.push(new Const(indType.name, this.levels));
      first = false;
    }
  }

  private isRec(): boolean {
    for (const indType of this.indTypes) {
      for (const cnstr of indType.ctors) {
        let t = cnstr.type;
        while (t.kind === ExprKind.Pi) {
          const domain = t.type;
          if (
            findExpr(domain, (e) => e.kind === ExprKind.Const && this.indCnsts.some((c) => c.name === (e as Const).name))
          ) {
            return true;
          }
          t = t.body;
        }
      }
    }
    return false;
  }

  private hasIndOcc(t: Expr): boolean {
    return findExpr(t, (e) => e.kind === ExprKind.Const && this.indCnsts.some((c) => c.name === (e as Const).name));
  }

  private isReflexive(): boolean {
    for (const indType of this.indTypes) {
      for (const cnstr of indType.ctors) {
        let t: Expr = cnstr.type;
        while (t.kind === ExprKind.Pi) {
          const argType = t.type;
          if (argType.kind === ExprKind.Pi && this.hasIndOcc(argType)) return true;
          const local = this.mkLocalDeclFor(t);
          t = instantiate1(t.body, local);
        }
      }
    }
    return false;
  }

  private allNames(): Name[] {
    return this.indTypes.map((t) => t.name);
  }

  private declareInductiveTypes(): void {
    const rec = this.isRec();
    const reflexive = this.isReflexive();
    const all = this.allNames();
    for (let idx = 0; idx < this.indTypes.length; idx++) {
      const indType = this.indTypes[idx]!;
      this.env.checkName(indType.name);
      this.env.addCore({
        kind: "induct",
        cv: { name: indType.name, lparams: this.lparams, type: indType.type },
        numParams: this.nparams,
        numIndices: this.nindices[idx]!,
        all,
        ctors: indType.ctors.map((c) => c.name),
        numNested: this.nnested,
        isRec: rec,
        isUnsafe: this.isUnsafe,
        isReflexive: reflexive,
      });
    }
  }

  private isValidIndAppIdx(t: Expr, i: number): boolean {
    const [I, args] = getAppArgs(t);
    if (!exprEq(I, this.indCnsts[i]!) || args.length !== this.nparams + this.nindices[i]!) return false;
    for (let j = 0; j < this.nparams; j++) {
      if (args[j] !== this.params[j] && !exprEq(args[j]!, this.params[j]!)) return false;
    }
    // Indices must not contain the datatypes being declared (lean4 issue #2125).
    for (let j = this.nparams; j < args.length; j++) {
      if (this.hasIndOcc(args[j]!)) return false;
    }
    return true;
  }

  private isValidIndApp(t: Expr): number | null {
    for (let i = 0; i < this.indTypes.length; i++) {
      if (this.isValidIndAppIdx(t, i)) return i;
    }
    return null;
  }

  private isRecArgument(t0: Expr): number | null {
    let t = this.whnf(t0);
    while (t.kind === ExprKind.Pi) {
      const local = this.mkLocalDeclFor(t);
      t = this.whnf(instantiate1(t.body, local));
    }
    return this.isValidIndApp(t);
  }

  private checkPositivity(t0: Expr, cnstrName: Name, argIdx: number): void {
    const t = this.whnf(t0);
    if (!this.hasIndOcc(t)) {
      // nonrecursive argument
    } else if (t.kind === ExprKind.Pi) {
      if (this.hasIndOcc(t.type))
        throw new KernelError(
          `arg #${argIdx + 1} of '${cnstrName}' has a non positive occurrence of the datatypes being declared`,
        );
      const local = this.mkLocalDeclFor(t);
      this.checkPositivity(instantiate1(t.body, local), cnstrName, argIdx);
    } else if (this.isValidIndApp(t) !== null) {
      // recursive argument
    } else {
      throw new KernelError(
        `arg #${argIdx + 1} of '${cnstrName}' contains a non valid occurrence of the datatypes being declared`,
      );
    }
  }

  private checkConstructors(): void {
    for (let idx = 0; idx < this.indTypes.length; idx++) {
      const indType = this.indTypes[idx]!;
      const found = new Set<number>();
      for (const cnstr of indType.ctors) {
        const n = cnstr.name;
        if (found.has(n.id)) throw new KernelError(`duplicate constructor name '${n}'`);
        found.add(n.id);
        let t = cnstr.type;
        this.env.checkName(n);
        this.tc().check(t, this.lparams);
        let i = 0;
        while (t.kind === ExprKind.Pi) {
          if (i < this.nparams) {
            if (!this.isDefEq(t.type, this.getParamType(i)))
              throw new KernelError(`arg #${i + 1} of '${n}' does not match inductive datatypes parameters'`);
            t = instantiate1(t.body, this.params[i]!);
          } else {
            const s = this.tc().ensureType(t.type);
            if (!(isGeq(this.resultLevel, s.level) || normalizesToZero(this.resultLevel))) {
              throw new KernelError(
                `universe level of type_of(arg #${i + 1}) of '${n}' is too big for the corresponding inductive datatype`,
              );
            }
            if (!this.isUnsafe) this.checkPositivity(t.type, n, i);
            const local = this.mkLocalDeclFor(t);
            t = instantiate1(t.body, local);
          }
          i++;
        }
        if (!this.isValidIndAppIdx(t, idx)) throw new KernelError(`invalid return type for '${n}'`);
      }
    }
  }

  private declareConstructors(): void {
    for (let idx = 0; idx < this.indTypes.length; idx++) {
      const indType = this.indTypes[idx]!;
      let cidx = 0;
      for (const cnstr of indType.ctors) {
        let arity = 0;
        let it = cnstr.type;
        while (it.kind === ExprKind.Pi) {
          it = it.body;
          arity++;
        }
        const nfields = arity - this.nparams;
        this.env.checkName(cnstr.name);
        this.env.addCore({
          kind: "ctor",
          cv: { name: cnstr.name, lparams: this.lparams, type: cnstr.type },
          induct: indType.name,
          cidx,
          numParams: this.nparams,
          numFields: nfields,
          isUnsafe: this.isUnsafe,
        });
        cidx++;
      }
    }
  }

  private elimOnlyAtUniverseZero(): boolean {
    if (this.isNotZeroFlag) return false;
    if (this.indTypes.length > 1) return true;
    const numIntros = this.indTypes[0]!.ctors.length;
    if (numIntros > 1) return true;
    if (numIntros === 0) return false;

    const cnstr = this.indTypes[0]!.ctors[0]!;
    let type = cnstr.type;
    let i = 0;
    const toCheck: FVar[] = [];
    while (type.kind === ExprKind.Pi) {
      const fvar = this.mkLocalDeclFor(type);
      if (i >= this.nparams) {
        const s = this.tc().ensureType(type.type);
        if (!normalizesToZero(s.level)) {
          toCheck.push(fvar);
        }
      }
      type = instantiate1(type.body, fvar);
      i++;
    }
    const [, resultArgs] = getAppArgs(type);
    for (const arg of toCheck) {
      if (!resultArgs.some((a) => a === arg)) return true;
    }
    return false;
  }

  private initElimLevel(): void {
    if (this.elimOnlyAtUniverseZero()) {
      this.elimLevel = Level.zero;
    } else {
      let u = Name.simple("u");
      let i = 1;
      while (this.lparams.includes(u)) {
        u = Name.simple("u").appendAfter(i);
        i++;
      }
      this.elimLevel = Level.param(u);
    }
  }

  private initKTarget(): void {
    this.kTarget =
      this.indTypes.length === 1 &&
      normalizesToZero(this.resultLevel) &&
      this.indTypes[0]!.ctors.length === 1;
    if (!this.kTarget) return;
    let it = this.indTypes[0]!.ctors[0]!.type;
    let i = 0;
    while (it.kind === ExprKind.Pi) {
      if (i < this.nparams) {
        it = it.body;
      } else {
        this.kTarget = false;
        break;
      }
      i++;
    }
  }

  private getIIndices(t: Expr, indices: Expr[]): number {
    const r = this.isValidIndApp(t);
    if (r === null) throw new KernelError("ill-formed inductive datatype");
    const [, allArgs] = getAppArgs(t);
    for (let i = this.nparams; i < allArgs.length; i++) indices.push(allArgs[i]!);
    return r;
  }

  private mkRecInfos(): void {
    let dIdx = 0;
    for (const indType of this.indTypes) {
      const indices: FVar[] = [];
      let t = this.whnf(indType.type);
      let i = 0;
      while (t.kind === ExprKind.Pi) {
        if (i < this.nparams) {
          t = instantiate1(t.body, this.params[i]!);
        } else {
          const idx = this.mkLocalDeclFor(t);
          indices.push(idx);
          t = instantiate1(t.body, idx);
        }
        i++;
        t = this.whnf(t);
      }
      const major = this.mkLocal(Name.simple("t"), mkAppN(mkAppN(this.indCnsts[dIdx]!, this.params), indices));
      let CTy: Expr = this.lctx.mkPi([major], new Sort(this.elimLevel));
      CTy = this.lctx.mkPi(indices, CTy);
      let CName = Name.simple("motive");
      if (this.indTypes.length > 1) CName = CName.appendAfter(dIdx + 1);
      const C = this.mkLocal(CName, CTy);
      this.recInfos.push({ C, minors: [], indices, major });
      dIdx++;
    }
    dIdx = 0;
    for (const indType of this.indTypes) {
      const indTypeName = indType.name;
      for (const cnstr of indType.ctors) {
        const bU: FVar[] = [];
        const u: FVar[] = [];
        const v: FVar[] = [];
        let t = cnstr.type;
        let i = 0;
        while (t.kind === ExprKind.Pi) {
          if (i < this.nparams) {
            t = instantiate1(t.body, this.params[i]!);
          } else {
            const l = this.mkLocalDeclFor(t);
            bU.push(l);
            if (this.isRecArgument(t.type) !== null) u.push(l);
            t = instantiate1(t.body, l);
          }
          i++;
        }
        const itIndices: Expr[] = [];
        const itIdx = this.getIIndices(t, itIndices);
        let CApp = mkAppN(this.recInfos[itIdx]!.C, itIndices);
        const introApp = mkAppN(mkAppN(new Const(cnstr.name, this.levels), this.params), bU);
        CApp = new App(CApp, introApp);
        for (let j = 0; j < u.length; j++) {
          const uJ = u[j]!;
          let uJTy = this.whnf(this.inferType(uJ));
          const xs: FVar[] = [];
          while (uJTy.kind === ExprKind.Pi) {
            const x = this.mkLocalDeclFor(uJTy);
            xs.push(x);
            uJTy = this.whnf(instantiate1(uJTy.body, x));
          }
          const itIndices2: Expr[] = [];
          const itIdx2 = this.getIIndices(uJTy, itIndices2);
          let CApp2 = mkAppN(this.recInfos[itIdx2]!.C, itIndices2);
          const uApp = mkAppN(uJ, xs);
          CApp2 = new App(CApp2, uApp);
          const vJTy = this.lctx.mkPi(xs, CApp2);
          const uJDecl = this.lctx.find(uJ)!;
          const vJ = this.mkLocal(appendSuffix(uJDecl.userName, "_ih"), vJTy);
          v.push(vJ);
        }
        const minorTy = this.lctx.mkPi(bU, this.lctx.mkPi(v, CApp));
        const minorName = cnstr.name.replacePrefix(indTypeName, Name.anonymous) ?? cnstr.name;
        const minor = this.mkLocal(minorName, minorTy);
        this.recInfos[dIdx]!.minors.push(minor);
      }
      dIdx++;
    }
  }

  private getRecLevels(): Level[] {
    if (this.elimLevel.kind === LevelKind.Param) return [this.elimLevel, ...this.levels];
    return this.levels;
  }

  private getRecLparams(): Name[] {
    if (this.elimLevel.kind === LevelKind.Param) return [this.elimLevel.name!, ...this.lparams];
    return this.lparams;
  }

  private collectCs(): FVar[] {
    return this.recInfos.map((r) => r.C);
  }

  private collectMinors(): FVar[] {
    const ms: FVar[] = [];
    for (const r of this.recInfos) ms.push(...r.minors);
    return ms;
  }

  private mkRecRules(dIdx: number, Cs: FVar[], minors: FVar[], minorIdxRef: { i: number }): RecRule[] {
    const d = this.indTypes[dIdx]!;
    const lvls = this.getRecLevels();
    const rules: RecRule[] = [];
    for (const cnstr of d.ctors) {
      const bU: FVar[] = [];
      const u: FVar[] = [];
      let t = cnstr.type;
      let i = 0;
      while (t.kind === ExprKind.Pi) {
        if (i < this.nparams) {
          t = instantiate1(t.body, this.params[i]!);
        } else {
          const l = this.mkLocalDeclFor(t);
          bU.push(l);
          if (this.isRecArgument(t.type) !== null) u.push(l);
          t = instantiate1(t.body, l);
        }
        i++;
      }
      const v: Expr[] = [];
      for (let j = 0; j < u.length; j++) {
        const uJ = u[j]!;
        let uJTy = this.whnf(this.inferType(uJ));
        const xs: FVar[] = [];
        while (uJTy.kind === ExprKind.Pi) {
          const x = this.mkLocalDeclFor(uJTy);
          xs.push(x);
          uJTy = this.whnf(instantiate1(uJTy.body, x));
        }
        const itIndices: Expr[] = [];
        const itIdx = this.getIIndices(uJTy, itIndices);
        const recName = mkRecName(this.indTypes[itIdx]!.name);
        let recApp: Expr = new Const(recName, lvls);
        recApp = new App(
          mkAppN(mkAppN(mkAppN(mkAppN(recApp, this.params), Cs), minors), itIndices),
          mkAppN(uJ, xs),
        );
        v.push(this.lctx.mkLambda(xs, recApp));
      }
      const eApp = mkAppN(mkAppN(minors[minorIdxRef.i]!, bU), v);
      const compRhs = this.lctx.mkLambda(
        this.params,
        this.lctx.mkLambda(Cs, this.lctx.mkLambda(minors, this.lctx.mkLambda(bU, eApp))),
      );
      rules.push({ ctor: cnstr.name, nfields: bU.length, rhs: compRhs });
      minorIdxRef.i++;
    }
    return rules;
  }

  private declareRecursors(): void {
    const Cs = this.collectCs();
    const minors = this.collectMinors();
    const nminors = minors.length;
    const nmotives = Cs.length;
    const all = this.allNames();
    const minorIdxRef = { i: 0 };
    for (let dIdx = 0; dIdx < this.indTypes.length; dIdx++) {
      const info = this.recInfos[dIdx]!;
      const CApp = new App(mkAppN(info.C, info.indices), info.major);
      let recTy = this.lctx.mkPi([info.major], CApp);
      recTy = this.lctx.mkPi(info.indices, recTy);
      recTy = this.lctx.mkPi(minors, recTy);
      recTy = this.lctx.mkPi(Cs, recTy);
      recTy = this.lctx.mkPi(this.params, recTy);
      const rules = this.mkRecRules(dIdx, Cs, minors, minorIdxRef);
      const recName = mkRecName(this.indTypes[dIdx]!.name);
      const recLparams = this.getRecLparams();
      this.env.checkName(recName);
      this.env.addCore({
        kind: "rec",
        cv: { name: recName, lparams: recLparams, type: recTy },
        all,
        numParams: this.nparams,
        numIndices: this.nindices[dIdx]!,
        numMotives: nmotives,
        numMinors: nminors,
        rules,
        k: this.kTarget,
        isUnsafe: this.isUnsafe,
      });
    }
  }

  /** Defensively type-check the generated recursors: the type must be well
   *  typed, and each computation rule must preserve types. */
  private checkRecursors(): void {
    const Cs = this.collectCs();
    const minors = this.collectMinors();
    for (let dIdx = 0; dIdx < this.indTypes.length; dIdx++) {
      const recName = mkRecName(this.indTypes[dIdx]!.name);
      const recCi = this.env.get(recName);
      this.tc().check(recCi.cv.type, this.getRecLparams());
      const recPre = mkAppN(mkAppN(mkAppN(new Const(recName, this.getRecLevels()), this.params), Cs), minors);
      for (const cnstr of this.indTypes[dIdx]!.ctors) {
        const bU: FVar[] = [];
        let t = cnstr.type;
        let i = 0;
        while (t.kind === ExprKind.Pi) {
          if (i < this.nparams) {
            t = instantiate1(t.body, this.params[i]!);
          } else {
            const l = this.mkLocalDeclFor(t);
            bU.push(l);
            t = instantiate1(t.body, l);
          }
          i++;
        }
        const itIndices: Expr[] = [];
        this.getIIndices(t, itIndices);
        const introApp = mkAppN(mkAppN(new Const(cnstr.name, this.levels), this.params), bU);
        const lhs = new App(mkAppN(recPre, itIndices), introApp);
        const tcheck = this.tc();
        const expected = tcheck.inferType(lhs);
        const reduct = tcheck.whnf(lhs);
        const actual = tcheck.inferType(reduct);
        if (!tcheck.isDefEq(actual, expected))
          throw new KernelError(
            `generated recursor computation rule for '${cnstr.name}' is not type-preserving`,
          );
      }
    }
  }

  run(): void {
    checkDuplicatedUnivParams(this.lparams);
    this.checkInductiveTypes();
    this.declareInductiveTypes();
    this.checkConstructors();
    this.declareConstructors();
    this.initElimLevel();
    this.initKTarget();
    this.mkRecInfos();
    this.declareRecursors();
    this.checkRecursors();
  }
}

// ---------------------------------------------------------------------------
// Nested inductive elimination
// ---------------------------------------------------------------------------

interface ElimNestedResult {
  params: FVar[];
  paramsLctx: LocalCtx;
  aux2nested: Map<number, Expr>; // aux type name id -> nested occurrence `I Ds`
  auxDecl: InductiveDecl;
}

class ElimNestedFn {
  private env: Environment;
  private d: InductiveDecl;
  private paramsLctx = new LocalCtx();
  private params: FVar[] = [];
  private nestedAux: Array<{ nested: Expr; auxName: Name }> = [];
  private lvls: Level[];
  private newTypes: InductiveType[] = [];
  private nextIdx = 1;

  constructor(env: Environment, d: InductiveDecl) {
    this.env = env;
    this.d = d;
    this.lvls = d.lparams.map((p) => Level.param(p));
  }

  private mkUniqueName(n: Name): Name {
    for (;;) {
      const r = n.appendAfter(this.nextIdx);
      this.nextIdx++;
      if (this.env.find(r) === undefined) return r;
    }
  }

  private illFormed(): never {
    throw new KernelError("invalid nested inductive datatype, ill-formed declaration");
  }

  private replaceParams(e: Expr, As: FVar[]): Expr {
    return instantiateRev(abstractFVars(e, As), this.params);
  }

  private isNestedInductiveApp(e: Expr): Extract<Decl, { kind: "induct" }> | null {
    if (e.kind !== ExprKind.App) return null;
    const fn = getAppFn(e);
    if (fn.kind !== ExprKind.Const) return null;
    const info = this.env.find(fn.name);
    if (info === undefined || info.kind !== "induct") return null;
    const [, args] = getAppArgs(e);
    const nparams = info.numParams;
    if (nparams > args.length) return null;
    let isNested = false;
    let looseBVars = false;
    for (let i = 0; i < nparams; i++) {
      const a = args[i]!;
      if (hasLooseBVars(a)) looseBVars = true;
      if (findExpr(a, (t) => t.kind === ExprKind.Const && this.newTypes.some((nt) => nt.name === (t as Const).name)))
        isNested = true;
    }
    if (!isNested) return null;
    if (looseBVars)
      throw new KernelError(
        `invalid nested inductive datatype '${fn.name}', nested inductive datatypes parameters cannot contain local variables.`,
      );
    return info;
  }

  private instantiatePiParams(e: Expr, nparams: number, params: Expr[]): Expr {
    let cur = e;
    for (let i = 0; i < nparams; i++) {
      if (cur.kind !== ExprKind.Pi) this.illFormed();
      cur = cur.body;
    }
    return instantiateRev(cur, params);
  }

  private replaceIfNested(As: FVar[], e: Expr): Expr | null {
    const IVal = this.isNestedInductiveApp(e);
    if (IVal === null) return null;
    const [fn, args] = getAppArgs(e);
    const IName = (fn as Const).name;
    const ILvls = (fn as Const).levels;
    const INparams = IVal.numParams;
    const IAs = mkAppN(fn, args.slice(0, INparams));
    let auxIName: Name | null = null;
    const IParams = this.replaceParams(IAs, As);
    for (const p of this.nestedAux) {
      if (exprEq(p.nested, IParams)) {
        auxIName = p.auxName;
        break;
      }
    }
    if (auxIName !== null) {
      let auxI: Expr = new Const(auxIName, this.lvls);
      auxI = mkAppN(auxI, As);
      return mkAppN(auxI, args.slice(INparams));
    }
    let result: Expr | null = null;
    for (const JName of IVal.all) {
      const JInfo = this.env.get(JName);
      if (JInfo.kind !== "induct") this.illFormed();
      const J = new Const(JName, ILvls);
      const JAs = mkAppN(J, args.slice(0, INparams));
      const auxJName = this.mkUniqueName(appendName(nestedPrefix, JName));
      let auxJType = instantiateLevelParams(JInfo.cv.type, JInfo.cv.lparams, ILvls);
      auxJType = this.instantiatePiParams(auxJType, INparams, args.slice(0, INparams));
      auxJType = this.paramsLctxPi(As, auxJType);
      this.nestedAux.push({ nested: this.replaceParams(JAs, As), auxName: auxJName });
      if (JName === IName) {
        let auxI: Expr = new Const(auxJName, this.lvls);
        auxI = mkAppN(auxI, As);
        result = mkAppN(auxI, args.slice(INparams));
      }
      const auxJCtors: Constructor[] = [];
      for (const JCtorName of JInfo.ctors) {
        const JCtorInfo = this.env.get(JCtorName);
        const auxJCtorName = JCtorName.replacePrefix(JName, auxJName);
        if (auxJCtorName === null) this.illFormed();
        let auxJCtorType = instantiateLevelParams(JCtorInfo.cv.type, JCtorInfo.cv.lparams, ILvls);
        auxJCtorType = this.instantiatePiParams(auxJCtorType, INparams, args.slice(0, INparams));
        auxJCtorType = this.paramsLctxPi(As, auxJCtorType);
        auxJCtors.push({ name: auxJCtorName, type: auxJCtorType });
      }
      this.newTypes.push({ name: auxJName, type: auxJType, ctors: auxJCtors });
    }
    if (result === null) this.illFormed();
    return result;
  }

  /** mk_pi over the constructor-local parameter fvars, which live in ctorLctx. */
  private ctorLctx: LocalCtx | null = null;
  private paramsLctxPi(As: FVar[], e: Expr): Expr {
    const lctx = this.ctorLctx ?? this.paramsLctx;
    return lctx.mkPi(As, e);
  }

  private replaceAllNested(As: FVar[], e: Expr): Expr {
    return replaceExpr(e, (t) => this.replaceIfNested(As, t));
  }

  private getParams(type: Expr, nparams: number, lctx: LocalCtx, params: FVar[]): Expr {
    let cur = type;
    for (let i = 0; i < nparams; i++) {
      if (cur.kind !== ExprKind.Pi)
        throw new KernelError("invalid inductive datatype declaration, incorrect number of parameters");
      params.push(lctx.mkLocalDecl(cur.binderName, cur.type, cur.binderInfo));
      cur = instantiate1(cur.body, params[params.length - 1]!);
    }
    return cur;
  }

  run(): ElimNestedResult {
    const dNparams = this.d.nparams;
    this.newTypes = [...this.d.types];
    if (this.newTypes.length === 0)
      throw new KernelError(
        "invalid empty (mutual) inductive datatype declaration, it must contain at least one inductive type.",
      );
    this.getParams(this.newTypes[0]!.type, dNparams, this.paramsLctx, this.params);
    let qhead = 0;
    while (qhead < this.newTypes.length) {
      const indType = this.newTypes[qhead]!;
      const newCtors: Constructor[] = [];
      for (const cnstr of indType.ctors) {
        let ctorType = cnstr.type;
        const lctx = new LocalCtx();
        const As: FVar[] = [];
        ctorType = this.getParams(ctorType, dNparams, lctx, As);
        this.ctorLctx = lctx;
        const newCtorType0 = this.replaceAllNested(As, ctorType);
        this.ctorLctx = null;
        const newCtorType = lctx.mkPi(As, newCtorType0);
        newCtors.push({ name: cnstr.name, type: newCtorType });
      }
      this.newTypes[qhead] = { name: indType.name, type: indType.type, ctors: newCtors };
      qhead++;
    }
    const aux2nested = new Map<number, Expr>();
    for (const p of this.nestedAux) aux2nested.set(p.auxName.id, p.nested);
    return {
      params: this.params,
      paramsLctx: this.paramsLctx,
      aux2nested,
      auxDecl: {
        lparams: this.d.lparams,
        nparams: this.d.nparams,
        types: this.newTypes,
        isUnsafe: this.d.isUnsafe,
      },
    };
  }
}

function appendName(pre: Name, n: Name): Name {
  // `_nested` + J_name: concatenate the parts of n under pre.
  if (n.isAnonymous()) return pre;
  const parent = appendName(pre, n.parent ?? Name.anonymous);
  return typeof n.part === "string" ? Name.str(parent, n.part) : Name.num(parent, n.part);
}

// ---------------------------------------------------------------------------
// Restoring nested inductives
// ---------------------------------------------------------------------------

class RestoreCtx {
  readonly res: ElimNestedResult;
  readonly auxEnv: Environment;
  constructor(res: ElimNestedResult, auxEnv: Environment) {
    this.res = res;
    this.auxEnv = auxEnv;
  }

  getNestedIfAuxConstructor(c: Name): { nested: Expr; auxIName: Name } | null {
    const info = this.auxEnv.find(c);
    if (info === undefined || info.kind !== "ctor") return null;
    const auxIName = info.induct;
    const nested = this.res.aux2nested.get(auxIName.id);
    if (nested === undefined) return null;
    return { nested, auxIName };
  }

  restoreConstructorName(cnstrName: Name): Name {
    const p = this.getNestedIfAuxConstructor(cnstrName);
    if (p === null)
      throw new KernelError(
        `failed to restore nested inductive types, '${cnstrName}' is not a constructor of an auxiliary type`,
      );
    const I = getAppFn(p.nested);
    if (I.kind !== ExprKind.Const)
      throw new KernelError(
        "failed to restore nested inductive types, nested occurrence is not an inductive type application",
      );
    const r = cnstrName.replacePrefix(p.auxIName, I.name);
    if (r === null) throw new KernelError("failed to restore nested inductive constructor name");
    return r;
  }

  restoreNested(e0: Expr, auxRecNameMap?: Map<number, Name>): Expr {
    const res = this.res;
    const lctx = new LocalCtx();
    const As: FVar[] = [];
    let e = e0;
    const pi = e.kind === ExprKind.Pi;
    for (let i = 0; i < res.params.length; i++) {
      if (e.kind !== ExprKind.Pi && e.kind !== ExprKind.Lam)
        throw new KernelError("failed to restore nested inductive types, fewer binders than parameters");
      As.push(lctx.mkLocalDecl(e.binderName, e.type, e.binderInfo));
      e = instantiate1(e.body, As[As.length - 1]!);
    }
    e = replaceExpr(e, (t) => {
      if (t.kind === ExprKind.Const && auxRecNameMap !== undefined) {
        const recName = auxRecNameMap.get(t.name.id);
        if (recName !== undefined) return new Const(recName, t.levels);
      }
      const fn = getAppFn(t);
      if (fn.kind === ExprKind.Const) {
        const nested = res.aux2nested.get(fn.name.id);
        if (nested !== undefined) {
          const [, args] = getAppArgs(t);
          if (args.length < res.params.length)
            throw new KernelError(
              "failed to restore nested inductive types, auxiliary type is not applied to all parameters",
            );
          const newT = instantiateRev(abstractFVars(nested, res.params), As);
          return mkAppN(newT, args.slice(res.params.length));
        }
        const r = this.getNestedIfAuxConstructor(fn.name);
        if (r !== null) {
          const [, args] = getAppArgs(t);
          if (args.length < res.params.length)
            throw new KernelError(
              "failed to restore nested inductive types, auxiliary constructor is not applied to all parameters",
            );
          const newNested = instantiateRev(abstractFVars(r.nested, res.params), As);
          const [I, IArgs] = getAppArgs(newNested);
          if (I.kind !== ExprKind.Const)
            throw new KernelError(
              "failed to restore nested inductive types, nested occurrence is not an inductive type application",
            );
          const newFnName = fn.name.replacePrefix(r.auxIName, I.name);
          if (newFnName === null) throw new KernelError("failed to restore nested constructor name");
          const newFn = new Const(newFnName, I.levels);
          return mkAppN(mkAppN(newFn, IArgs), args.slice(res.params.length));
        }
      }
      return null;
    });
    return pi ? lctx.mkPi(As, e) : lctx.mkLambda(As, e);
  }
}

// ---------------------------------------------------------------------------
// Top level: environment.add_inductive
// ---------------------------------------------------------------------------

function mkAuxRecNameMap(
  auxEnv: Environment,
  d: InductiveDecl,
): { auxRecNames: Name[]; recMap: Map<number, Name> } {
  const ntypes = d.types.length;
  const mainName = d.types[0]!.name;
  const mainInfo = auxEnv.get(mainName);
  if (mainInfo.kind !== "induct") throw new KernelError("unreachable in mkAuxRecNameMap");
  const allNames = mainInfo.all;
  const auxRecNames: Name[] = [];
  const recMap = new Map<number, Name>();
  let i = 0;
  let nextIdx = 1;
  for (const indName of allNames) {
    if (i >= ntypes) {
      const oldRec = mkRecName(indName);
      auxRecNames.push(oldRec);
      const newRecName = mkRecName(mainName).appendAfter(nextIdx);
      nextIdx++;
      recMap.set(oldRec.id, newRecName);
    }
    i++;
  }
  return { auxRecNames, recMap };
}

/** Add a (mutual, possibly nested) inductive declaration to `env` in place. */
export function addInductive(env: Environment, d: InductiveDecl): void {
  for (const indType of d.types) {
    checkNoNestedAux(indType.name, indType.type);
    for (const c of indType.ctors) checkNoNestedAux(c.name, c.type);
  }
  checkUniformIndOccs(d);
  const elim = new ElimNestedFn(env, d);
  const res = elim.run();
  const nnested = res.aux2nested.size;
  const auxEnv = env.clone();
  new AddInductiveFn(auxEnv, res.auxDecl, nnested).run();
  if (nnested === 0) {
    for (const indType of res.auxDecl.types) {
      env.addCore(auxEnv.get(indType.name));
      for (const c of indType.ctors) env.addCore(auxEnv.get(c.name));
      env.addCore(auxEnv.get(mkRecName(indType.name)));
    }
    return;
  }

  // Restore nested inductives.
  const restore = new RestoreCtx(res, auxEnv);
  const allIndNames = d.types.map((t) => t.name);
  const { auxRecNames, recMap } = mkAuxRecNameMap(auxEnv, d);
  const newRecNames: Name[] = [];

  const processRec = (recName: Name): void => {
    let newRecName = recName;
    const mapped = recMap.get(recName.id);
    if (mapped !== undefined) newRecName = mapped;
    const recInfo = auxEnv.get(recName);
    if (recInfo.kind !== "rec") throw new KernelError("unreachable: expected recursor");
    const newRecType = restore.restoreNested(recInfo.cv.type, recMap);
    const newRules: RecRule[] = [];
    for (const rule of recInfo.rules) {
      const newRhs = restore.restoreNested(rule.rhs, recMap);
      let newCnstrName = rule.ctor;
      if (newRecName !== recName) {
        newCnstrName = restore.restoreConstructorName(rule.ctor);
      }
      newRules.push({ ctor: newCnstrName, nfields: rule.nfields, rhs: newRhs });
    }
    env.checkName(newRecName);
    env.addCore({
      kind: "rec",
      cv: { name: newRecName, lparams: recInfo.cv.lparams, type: newRecType },
      all: allIndNames,
      numParams: recInfo.numParams,
      numIndices: recInfo.numIndices,
      numMotives: recInfo.numMotives,
      numMinors: recInfo.numMinors,
      rules: newRules,
      k: recInfo.k,
      isUnsafe: recInfo.isUnsafe,
    });
    newRecNames.push(newRecName);
  };

  for (const indType of d.types) {
    const indInfo = auxEnv.get(indType.name);
    if (indInfo.kind !== "induct") throw new KernelError("unreachable: expected inductive");
    env.checkName(indInfo.cv.name);
    env.addCore({ ...indInfo, all: allIndNames });
    for (const cnstrName of indInfo.ctors) {
      const cnstrInfo = auxEnv.get(cnstrName);
      if (cnstrInfo.kind !== "ctor") throw new KernelError("unreachable: expected constructor");
      const newType = restore.restoreNested(cnstrInfo.cv.type);
      env.checkName(cnstrInfo.cv.name);
      env.addCore({ ...cnstrInfo, cv: { ...cnstrInfo.cv, type: newType } });
    }
    processRec(mkRecName(indType.name));
  }
  for (const auxRec of auxRecNames) processRec(auxRec);

  // Type check the nested inductive applications `I Ds` that were replaced.
  {
    const tc = new TypeChecker(env, d.isUnsafe ? "unsafe" : "safe", res.paramsLctx);
    for (const nested of res.aux2nested.values()) {
      tc.check(nested, d.lparams);
    }
  }
  // Re-check everything restore_nested rewrote.
  {
    const tc = new TypeChecker(env, d.isUnsafe ? "unsafe" : "safe");
    for (const indType of d.types) {
      for (const cnstr of indType.ctors) {
        const info = env.get(cnstr.name);
        tc.check(info.cv.type, d.lparams);
      }
    }
    for (const recName of newRecNames) {
      const recInfo = env.get(recName);
      if (recInfo.kind !== "rec") continue;
      tc.check(recInfo.cv.type, recInfo.cv.lparams);
      for (const rule of recInfo.rules) {
        tc.check(rule.rhs, recInfo.cv.lparams);
      }
    }
  }
}

/** Name helper used by mkRecInfos for `<field>_ih` names. */
function appendSuffix(n: Name, suffix: string): Name {
  if (typeof n.part === "string" && n.parent !== null) {
    return Name.str(n.parent, n.part + suffix);
  }
  return Name.str(n, suffix);
}
