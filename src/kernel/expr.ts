/**
 * Kernel expressions with de Bruijn indices.
 *
 * Every node caches four values computed in O(1) from its children:
 * a hash, the loose bound-variable range, a free-variable flag, and a
 * level-parameter flag. The hash must ignore exactly what the structural
 * equality ignores: binder names and binder infos (see expr_eq_fn<false>
 * in lean4 src/kernel/expr_eq_fn.cpp).
 */
import { Name } from "./name.ts";
import { Level, levelEq, levelListEq, instLevel } from "./level.ts";

export const ExprKind = {
  BVar: 0,
  FVar: 1,
  Sort: 2,
  Const: 3,
  App: 4,
  Lam: 5,
  Pi: 6,
  Let: 7,
  Lit: 8,
  Proj: 9,
} as const;
export type ExprKind = (typeof ExprKind)[keyof typeof ExprKind];

export type BinderInfo = "default" | "implicit" | "strictImplicit" | "instImplicit";

function mix(h1: number, h2: number): number {
  let h = (h1 * 0x9e3779b1) | 0;
  h = (h ^ h2) | 0;
  h = (h * 0x85ebca6b) | 0;
  return (h ^ (h >>> 13)) | 0;
}

let nextExprId = 0;

abstract class ExprBase {
  readonly id: number = nextExprId++;
  abstract readonly kind: ExprKind;
  abstract readonly hash: number;
  /** Smallest `n` such that all loose bvars have index < n. */
  abstract readonly looseBVarRange: number;
  abstract readonly hasFVar: boolean;
  abstract readonly hasLevelParam: boolean;
}

export class BVar extends ExprBase {
  override readonly kind = ExprKind.BVar;
  override readonly hash: number;
  override readonly looseBVarRange: number;
  override readonly hasFVar = false;
  override readonly hasLevelParam = false;
  readonly idx: number;
  constructor(idx: number) {
    super();
    this.idx = idx;
    this.hash = mix(3, idx);
    this.looseBVarRange = idx + 1;
  }
}

export class FVar extends ExprBase {
  private static nextFid = 0;
  override readonly kind = ExprKind.FVar;
  override readonly hash: number;
  override readonly looseBVarRange = 0;
  override readonly hasFVar = true;
  override readonly hasLevelParam = false;
  readonly fid: number;
  /** User-facing name, for error messages only. */
  readonly userName: Name;
  constructor(userName: Name) {
    super();
    this.fid = FVar.nextFid++;
    this.userName = userName;
    this.hash = mix(5, this.fid);
  }
}

export class Sort extends ExprBase {
  override readonly kind = ExprKind.Sort;
  override readonly hash: number;
  override readonly looseBVarRange = 0;
  override readonly hasFVar = false;
  override readonly hasLevelParam: boolean;
  readonly level: Level;
  constructor(level: Level) {
    super();
    this.level = level;
    this.hash = mix(7, level.hash);
    this.hasLevelParam = level.hasParam;
  }
}

export class Const extends ExprBase {
  override readonly kind = ExprKind.Const;
  override readonly hash: number;
  override readonly looseBVarRange = 0;
  override readonly hasFVar = false;
  override readonly hasLevelParam: boolean;
  readonly name: Name;
  readonly levels: Level[];
  constructor(name: Name, levels: Level[]) {
    super();
    this.name = name;
    this.levels = levels;
    let h = mix(11, name.hash);
    let hasParam = false;
    for (const l of levels) {
      h = mix(h, l.hash);
      if (l.hasParam) hasParam = true;
    }
    this.hash = h;
    this.hasLevelParam = hasParam;
  }
}

export class App extends ExprBase {
  override readonly kind = ExprKind.App;
  override readonly hash: number;
  override readonly looseBVarRange: number;
  override readonly hasFVar: boolean;
  override readonly hasLevelParam: boolean;
  readonly fn: Expr;
  readonly arg: Expr;
  constructor(fn: Expr, arg: Expr) {
    super();
    this.fn = fn;
    this.arg = arg;
    this.hash = mix(13, mix(fn.hash, arg.hash));
    this.looseBVarRange = Math.max(fn.looseBVarRange, arg.looseBVarRange);
    this.hasFVar = fn.hasFVar || arg.hasFVar;
    this.hasLevelParam = fn.hasLevelParam || arg.hasLevelParam;
  }
}

abstract class Binding extends ExprBase {
  override readonly hash: number;
  override readonly looseBVarRange: number;
  override readonly hasFVar: boolean;
  override readonly hasLevelParam: boolean;
  readonly binderName: Name;
  readonly binderInfo: BinderInfo;
  readonly type: Expr;
  readonly body: Expr;
  constructor(seed: number, binderName: Name, binderInfo: BinderInfo, type: Expr, body: Expr) {
    super();
    this.binderName = binderName;
    this.binderInfo = binderInfo;
    this.type = type;
    this.body = body;
    // The hash ignores the binder name and the binder info, as equality does.
    this.hash = mix(seed, mix(type.hash, body.hash));
    this.looseBVarRange = Math.max(type.looseBVarRange, body.looseBVarRange - 1);
    this.hasFVar = type.hasFVar || body.hasFVar;
    this.hasLevelParam = type.hasLevelParam || body.hasLevelParam;
  }
}

export class Lam extends Binding {
  override readonly kind = ExprKind.Lam;
  constructor(binderName: Name, binderInfo: BinderInfo, type: Expr, body: Expr) {
    super(17, binderName, binderInfo, type, body);
  }
}

export class Pi extends Binding {
  override readonly kind = ExprKind.Pi;
  constructor(binderName: Name, binderInfo: BinderInfo, type: Expr, body: Expr) {
    super(19, binderName, binderInfo, type, body);
  }
}

export class Let extends ExprBase {
  override readonly kind = ExprKind.Let;
  override readonly hash: number;
  override readonly looseBVarRange: number;
  override readonly hasFVar: boolean;
  override readonly hasLevelParam: boolean;
  readonly binderName: Name;
  readonly type: Expr;
  readonly value: Expr;
  readonly body: Expr;
  readonly nondep: boolean;
  constructor(binderName: Name, type: Expr, value: Expr, body: Expr, nondep: boolean) {
    super();
    this.binderName = binderName;
    this.type = type;
    this.value = value;
    this.body = body;
    this.nondep = nondep;
    this.hash = mix(23, mix(type.hash, mix(value.hash, mix(body.hash, nondep ? 1 : 0))));
    this.looseBVarRange = Math.max(type.looseBVarRange, value.looseBVarRange, body.looseBVarRange - 1);
    this.hasFVar = type.hasFVar || value.hasFVar || body.hasFVar;
    this.hasLevelParam = type.hasLevelParam || value.hasLevelParam || body.hasLevelParam;
  }
}

export class Lit extends ExprBase {
  override readonly kind = ExprKind.Lit;
  override readonly hash: number;
  override readonly looseBVarRange = 0;
  override readonly hasFVar = false;
  override readonly hasLevelParam = false;
  readonly val: bigint | string;
  constructor(val: bigint | string) {
    super();
    this.val = val;
    this.hash =
      typeof val === "bigint"
        ? mix(29, Number(val % 1000000007n))
        : mix(31, [...val].reduce((h, c) => mix(h, c.codePointAt(0)!), 0));
  }
}

export class Proj extends ExprBase {
  override readonly kind = ExprKind.Proj;
  override readonly hash: number;
  override readonly looseBVarRange: number;
  override readonly hasFVar: boolean;
  override readonly hasLevelParam: boolean;
  readonly structName: Name;
  readonly idx: number;
  readonly struct: Expr;
  constructor(structName: Name, idx: number, struct: Expr) {
    super();
    this.structName = structName;
    this.idx = idx;
    this.struct = struct;
    this.hash = mix(37, mix(structName.hash, mix(idx, struct.hash)));
    this.looseBVarRange = struct.looseBVarRange;
    this.hasFVar = struct.hasFVar;
    this.hasLevelParam = struct.hasLevelParam;
  }
}

export type Expr = BVar | FVar | Sort | Const | App | Lam | Pi | Let | Lit | Proj;

export function hasLooseBVars(e: Expr): boolean {
  return e.looseBVarRange > 0;
}

/**
 * Structural equality. Ignores binder names and binder infos.
 * Mirrors expr_eq_fn<false> in the real kernel, including the app-spine loop.
 */
export function exprEq(a: Expr, b: Expr): boolean {
  if (a === b) return true;
  if (a.hash !== b.hash || a.kind !== b.kind) return false;
  switch (a.kind) {
    case ExprKind.BVar:
      return a.idx === (b as BVar).idx;
    case ExprKind.FVar:
      return a.fid === (b as FVar).fid;
    case ExprKind.Lit:
      return a.val === (b as Lit).val;
    case ExprKind.Sort:
      return levelEq(a.level, (b as Sort).level);
    case ExprKind.Const: {
      const bc = b as Const;
      return a.name === bc.name && levelListEq(a.levels, bc.levels);
    }
    case ExprKind.App: {
      let ca: Expr = a;
      let cb: Expr = b;
      while (ca.kind === ExprKind.App && cb.kind === ExprKind.App) {
        if (!exprEq(ca.arg, cb.arg)) return false;
        ca = ca.fn;
        cb = cb.fn;
      }
      if (ca.kind === ExprKind.App || cb.kind === ExprKind.App) return false;
      return exprEq(ca, cb);
    }
    case ExprKind.Lam:
    case ExprKind.Pi: {
      const bb = b as Lam | Pi;
      return exprEq(a.type, bb.type) && exprEq(a.body, bb.body);
    }
    case ExprKind.Let: {
      const bl = b as Let;
      return a.nondep === bl.nondep && exprEq(a.type, bl.type) && exprEq(a.value, bl.value) && exprEq(a.body, bl.body);
    }
    case ExprKind.Proj: {
      const bp = b as Proj;
      return a.structName === bp.structName && a.idx === bp.idx && exprEq(a.struct, bp.struct);
    }
  }
}

// ---------------------------------------------------------------------------
// App spine helpers
// ---------------------------------------------------------------------------

export function mkAppN(fn: Expr, args: readonly Expr[]): Expr {
  let r = fn;
  for (const a of args) r = new App(r, a);
  return r;
}

export function getAppFn(e: Expr): Expr {
  while (e.kind === ExprKind.App) e = e.fn;
  return e;
}

export function getAppNumArgs(e: Expr): number {
  let n = 0;
  while (e.kind === ExprKind.App) {
    n++;
    e = e.fn;
  }
  return n;
}

/** Return [fn, args] with args in application order. */
export function getAppArgs(e: Expr): [Expr, Expr[]] {
  const args: Expr[] = [];
  while (e.kind === ExprKind.App) {
    args.push(e.arg);
    e = e.fn;
  }
  args.reverse();
  return [e, args];
}

// ---------------------------------------------------------------------------
// Loose bound variables: lift, instantiate, abstract
// ---------------------------------------------------------------------------

export function liftLooseBVars(e: Expr, start: number, amount: number): Expr {
  if (amount === 0) return e;
  const rec = (t: Expr, s: number): Expr => {
    if (t.looseBVarRange <= s) return t;
    switch (t.kind) {
      case ExprKind.BVar:
        return t.idx >= s ? new BVar(t.idx + amount) : t;
      case ExprKind.App: {
        // Iterate along the spine: a deep application must not recurse
        // once per node (measured: a stack overflow on real input).
        const spine: App[] = [];
        let cur: Expr = t;
        while (cur.kind === ExprKind.App && cur.looseBVarRange > s) {
          spine.push(cur);
          cur = cur.fn;
        }
        let acc = rec(cur, s);
        let changed = acc !== cur;
        for (let i = spine.length - 1; i >= 0; i--) {
          const node = spine[i]!;
          const arg = rec(node.arg, s);
          if (changed || arg !== node.arg) {
            acc = new App(acc, arg);
            changed = true;
          } else {
            acc = node;
          }
        }
        return acc;
      }
      case ExprKind.Lam: {
        const ty = rec(t.type, s);
        const body = rec(t.body, s + 1);
        return ty === t.type && body === t.body ? t : new Lam(t.binderName, t.binderInfo, ty, body);
      }
      case ExprKind.Pi: {
        const ty = rec(t.type, s);
        const body = rec(t.body, s + 1);
        return ty === t.type && body === t.body ? t : new Pi(t.binderName, t.binderInfo, ty, body);
      }
      case ExprKind.Let: {
        const ty = rec(t.type, s);
        const v = rec(t.value, s);
        const body = rec(t.body, s + 1);
        return ty === t.type && v === t.value && body === t.body ? t : new Let(t.binderName, ty, v, body, t.nondep);
      }
      case ExprKind.Proj: {
        const st = rec(t.struct, s);
        return st === t.struct ? t : new Proj(t.structName, t.idx, st);
      }
      default:
        return t;
    }
  };
  return rec(e, start);
}

/**
 * Replace loose bvars by `subst`: at depth 0, bvar #i becomes subst[i].
 * A bvar above the range drops by subst.length. The whole spine goes in
 * one pass. Substituted terms lift by the current depth.
 */
export function instantiate(e: Expr, subst: readonly Expr[]): Expr {
  const n = subst.length;
  if (n === 0 || e.looseBVarRange === 0) return e;
  // Explicit-stack machine. The input file holds shallow terms, but
  // reduction builds terms of unbounded depth, and a recursive walk
  // overflowed the stack on real input (see docs/NOTEBOOK.md).
  // Per-depth memo keyed on node identity.
  const memo = new Map<number, Map<Expr, Expr>>();
  const getMemo = (d: number): Map<Expr, Expr> => {
    let m = memo.get(d);
    if (m === undefined) {
      m = new Map();
      memo.set(d, m);
    }
    return m;
  };
  // Lift results per (depth, index): fresh BVar objects for the same index
  // miss the node memo, and the lift walk repeats (measured: 24% of time
  // in the lift recursion on magma-list-deep-n21).
  const liftCache = new Map<number, Expr>();
  const liftedSubst = (j: number, d: number): Expr => {
    if (d === 0) return subst[j]!;
    const key = d * n + j;
    let r = liftCache.get(key);
    if (r === undefined) {
      r = liftLooseBVars(subst[j]!, 0, d);
      liftCache.set(key, r);
    }
    return r;
  };

  // phase 0: visit, phase 1: rebuild from child results.
  const tStack: Expr[] = [e];
  const dStack: number[] = [0];
  const pStack: number[] = [0];
  const results: Expr[] = [];

  while (tStack.length > 0) {
    const t = tStack[tStack.length - 1]!;
    const d = dStack[dStack.length - 1]!;
    const phase = pStack[pStack.length - 1]!;
    if (phase === 0) {
      if (t.looseBVarRange <= d) {
        tStack.pop();
        dStack.pop();
        pStack.pop();
        results.push(t);
        continue;
      }
      const m = getMemo(d);
      const cached = m.get(t);
      if (cached !== undefined) {
        tStack.pop();
        dStack.pop();
        pStack.pop();
        results.push(cached);
        continue;
      }
      switch (t.kind) {
        case ExprKind.BVar: {
          const j = t.idx - d;
          const r = j < n ? liftedSubst(j, d) : new BVar(t.idx - n);
          m.set(t, r);
          tStack.pop();
          dStack.pop();
          pStack.pop();
          results.push(r);
          break;
        }
        // Children push in reverse order, so that the first child pops
        // first and its result lands first on the result stack.
        case ExprKind.App:
          pStack[pStack.length - 1] = 1;
          tStack.push(t.arg, t.fn);
          dStack.push(d, d);
          pStack.push(0, 0);
          break;
        case ExprKind.Lam:
        case ExprKind.Pi:
          pStack[pStack.length - 1] = 1;
          tStack.push(t.body, t.type);
          dStack.push(d + 1, d);
          pStack.push(0, 0);
          break;
        case ExprKind.Let:
          pStack[pStack.length - 1] = 1;
          tStack.push(t.body, t.value, t.type);
          dStack.push(d + 1, d, d);
          pStack.push(0, 0, 0);
          break;
        case ExprKind.Proj:
          pStack[pStack.length - 1] = 1;
          tStack.push(t.struct);
          dStack.push(d);
          pStack.push(0);
          break;
        default: {
          m.set(t, t);
          tStack.pop();
          dStack.pop();
          pStack.pop();
          results.push(t);
          break;
        }
      }
    } else {
      tStack.pop();
      dStack.pop();
      pStack.pop();
      let r: Expr;
      switch (t.kind) {
        case ExprKind.App: {
          const arg = results.pop()!;
          const fn = results.pop()!;
          r = fn === t.fn && arg === t.arg ? t : new App(fn, arg);
          break;
        }
        case ExprKind.Lam: {
          const body = results.pop()!;
          const ty = results.pop()!;
          r = ty === t.type && body === t.body ? t : new Lam(t.binderName, t.binderInfo, ty, body);
          break;
        }
        case ExprKind.Pi: {
          const body = results.pop()!;
          const ty = results.pop()!;
          r = ty === t.type && body === t.body ? t : new Pi(t.binderName, t.binderInfo, ty, body);
          break;
        }
        case ExprKind.Let: {
          const body = results.pop()!;
          const v = results.pop()!;
          const ty = results.pop()!;
          r = ty === t.type && v === t.value && body === t.body ? t : new Let(t.binderName, ty, v, body, t.nondep);
          break;
        }
        case ExprKind.Proj: {
          const st = results.pop()!;
          r = st === t.struct ? t : new Proj(t.structName, t.idx, st);
          break;
        }
        default:
          throw new Error("unreachable in instantiate rebuild");
      }
      getMemo(d).set(t, r);
      results.push(r);
    }
  }
  return results.pop()!;
}

/** instantiate with one term: bvar #0 becomes `a`. */
export function instantiate1(e: Expr, a: Expr): Expr {
  return instantiate(e, [a]);
}

/**
 * instantiate_rev: fvars in binding order, so bvar #0 becomes the LAST
 * element of `fvars`.
 */
export function instantiateRev(e: Expr, fvars: readonly Expr[]): Expr {
  return instantiate(e, [...fvars].reverse());
}

/**
 * Abstract the given free variables: fvars[i] (binding order) becomes
 * bvar #(n-1-i) at depth 0.
 */
export function abstractFVars(e: Expr, fvars: readonly FVar[]): Expr {
  if (!e.hasFVar || fvars.length === 0) return e;
  const pos = new Map<number, number>();
  fvars.forEach((f, i) => pos.set(f.fid, i));
  const n = fvars.length;
  const rec = (t: Expr, d: number): Expr => {
    if (!t.hasFVar) return t;
    switch (t.kind) {
      case ExprKind.FVar: {
        const i = pos.get(t.fid);
        return i === undefined ? t : new BVar(n - 1 - i + d);
      }
      case ExprKind.App: {
        const spine: App[] = [];
        let cur: Expr = t;
        while (cur.kind === ExprKind.App && cur.hasFVar) {
          spine.push(cur);
          cur = cur.fn;
        }
        let acc = rec(cur, d);
        let changed = acc !== cur;
        for (let i = spine.length - 1; i >= 0; i--) {
          const node = spine[i]!;
          const arg = rec(node.arg, d);
          if (changed || arg !== node.arg) {
            acc = new App(acc, arg);
            changed = true;
          } else {
            acc = node;
          }
        }
        return acc;
      }
      case ExprKind.Lam: {
        const ty = rec(t.type, d);
        const body = rec(t.body, d + 1);
        return ty === t.type && body === t.body ? t : new Lam(t.binderName, t.binderInfo, ty, body);
      }
      case ExprKind.Pi: {
        const ty = rec(t.type, d);
        const body = rec(t.body, d + 1);
        return ty === t.type && body === t.body ? t : new Pi(t.binderName, t.binderInfo, ty, body);
      }
      case ExprKind.Let: {
        const ty = rec(t.type, d);
        const v = rec(t.value, d);
        const body = rec(t.body, d + 1);
        return ty === t.type && v === t.value && body === t.body ? t : new Let(t.binderName, ty, v, body, t.nondep);
      }
      case ExprKind.Proj: {
        const st = rec(t.struct, d);
        return st === t.struct ? t : new Proj(t.structName, t.idx, st);
      }
      default:
        return t;
    }
  };
  return rec(e, 0);
}

// ---------------------------------------------------------------------------
// Level parameter instantiation
// ---------------------------------------------------------------------------

export function instantiateLevelParams(e: Expr, params: Name[], values: Level[]): Expr {
  if (!e.hasLevelParam || params.length === 0) return e;
  const memo = new Map<Expr, Expr>();
  const rec = (t: Expr): Expr => {
    if (!t.hasLevelParam) return t;
    const cached = memo.get(t);
    if (cached !== undefined) return cached;
    let r: Expr;
    switch (t.kind) {
      case ExprKind.Sort:
        r = new Sort(instLevel(t.level, params, values));
        break;
      case ExprKind.Const:
        r = new Const(
          t.name,
          t.levels.map((l) => instLevel(l, params, values)),
        );
        break;
      case ExprKind.App: {
        const spine: App[] = [];
        let cur: Expr = t;
        let head: Expr | undefined;
        while (cur.kind === ExprKind.App) {
          if (cur !== t) {
            if (!cur.hasLevelParam) {
              head = cur;
              break;
            }
            const c = memo.get(cur);
            if (c !== undefined) {
              head = c;
              break;
            }
          }
          spine.push(cur);
          cur = cur.fn;
        }
        if (head === undefined) head = rec(cur);
        let acc = head;
        for (let i = spine.length - 1; i >= 0; i--) {
          const node = spine[i]!;
          acc = new App(acc, rec(node.arg));
          memo.set(node, acc);
        }
        r = acc;
        break;
      }
      case ExprKind.Lam:
        r = new Lam(t.binderName, t.binderInfo, rec(t.type), rec(t.body));
        break;
      case ExprKind.Pi:
        r = new Pi(t.binderName, t.binderInfo, rec(t.type), rec(t.body));
        break;
      case ExprKind.Let:
        r = new Let(t.binderName, rec(t.type), rec(t.value), rec(t.body), t.nondep);
        break;
      case ExprKind.Proj:
        r = new Proj(t.structName, t.idx, rec(t.struct));
        break;
      default:
        r = t;
    }
    memo.set(t, r);
    return r;
  };
  return rec(e);
}

// ---------------------------------------------------------------------------
// consumeTypeAnnotations, from src/Lean/Expr.lean
// ---------------------------------------------------------------------------

import { Name as NameRef } from "./name.ts";
const optParamName = NameRef.simple("optParam");
const autoParamName = NameRef.simple("autoParam");
const outParamName = NameRef.simple("outParam");
const semiOutParamName = NameRef.simple("semiOutParam");

function isAppOfConst(e: Expr, n: Name, nargs: number): boolean {
  return getAppNumArgs(e) === nargs && getAppFn(e).kind === ExprKind.Const && (getAppFn(e) as Const).name === n;
}

/** Strip optParam, autoParam, outParam, and semiOutParam wrappers. */
export function consumeTypeAnnotations(e: Expr): Expr {
  for (;;) {
    if (isAppOfConst(e, optParamName, 2) || isAppOfConst(e, autoParamName, 2)) {
      e = ((e as App).fn as App).arg;
    } else if (isAppOfConst(e, outParamName, 1) || isAppOfConst(e, semiOutParamName, 1)) {
      e = (e as App).arg;
    } else {
      return e;
    }
  }
}

// ---------------------------------------------------------------------------
// cheap_beta_reduce, from lean4 src/kernel/instantiate.cpp
// ---------------------------------------------------------------------------

export function cheapBetaReduce(e: Expr): Expr {
  if (e.kind !== ExprKind.App) return e;
  let fn = getAppFn(e);
  if (fn.kind !== ExprKind.Lam) return e;
  const [, args] = getAppArgs(e);
  let i = 0;
  let cur: Expr = fn;
  while (cur.kind === ExprKind.Lam && i < args.length) {
    i++;
    cur = cur.body;
  }
  if (!hasLooseBVars(cur)) {
    return mkAppN(cur, args.slice(i));
  } else if (cur.kind === ExprKind.BVar && cur.idx < i) {
    return mkAppN(args[i - cur.idx - 1]!, args.slice(i));
  }
  return e;
}

// ---------------------------------------------------------------------------
// Printing, only for error messages and debugging
// ---------------------------------------------------------------------------

export function exprToString(e: Expr): string {
  switch (e.kind) {
    case ExprKind.BVar:
      return `#${e.idx}`;
    case ExprKind.FVar:
      return `fv!${e.userName}.${e.fid}`;
    case ExprKind.Sort:
      return `Sort(*)`;
    case ExprKind.Const:
      return e.name.toString();
    case ExprKind.App: {
      const [fn, args] = getAppArgs(e);
      return `(${exprToString(fn)} ${args.map(exprToString).join(" ")})`;
    }
    case ExprKind.Lam:
      return `(fun ${e.binderName} : ${exprToString(e.type)} => ${exprToString(e.body)})`;
    case ExprKind.Pi:
      return `((${e.binderName} : ${exprToString(e.type)}) -> ${exprToString(e.body)})`;
    case ExprKind.Let:
      return `(let ${e.binderName} : ${exprToString(e.type)} := ${exprToString(e.value)}; ${exprToString(e.body)})`;
    case ExprKind.Lit:
      return typeof e.val === "bigint" ? e.val.toString() : JSON.stringify(e.val);
    case ExprKind.Proj:
      return `${exprToString(e.struct)}.${e.idx}`;
  }
}
