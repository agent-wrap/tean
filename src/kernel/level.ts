/**
 * Universe levels, ported from lean4 src/kernel/level.cpp at githash 5045d005.
 * The equality test is normalize-then-compare, as in the real kernel.
 */
import { Name } from "./name.ts";
import { KernelError } from "./error.ts";

export const LevelKind = {
  Zero: 0,
  Param: 1,
  Max: 2,
  IMax: 3,
  Succ: 4,
} as const;
export type LevelKind = (typeof LevelKind)[keyof typeof LevelKind];

function mix(h1: number, h2: number): number {
  let h = (h1 * 0x9e3779b1) | 0;
  h = (h ^ h2) | 0;
  h = (h * 0x85ebca6b) | 0;
  return (h ^ (h >>> 13)) | 0;
}

export class Level {
  readonly kind: LevelKind;
  readonly hash: number;
  readonly depth: number;
  readonly hasParam: boolean;
  /** Succ: the predecessor. */
  readonly a: Level | null;
  /** Max and IMax: the right side. */
  readonly b: Level | null;
  /** Param: the name. */
  readonly name: Name | null;

  private constructor(kind: LevelKind, a: Level | null, b: Level | null, name: Name | null) {
    this.kind = kind;
    this.a = a;
    this.b = b;
    this.name = name;
    this.depth = 1 + Math.max(a?.depth ?? 0, b?.depth ?? 0);
    this.hasParam = kind === LevelKind.Param || (a?.hasParam ?? false) || (b?.hasParam ?? false);
    this.hash = mix(mix(kind, a?.hash ?? 0), mix(b?.hash ?? 0, name?.hash ?? 0));
  }

  static readonly zero = new Level(LevelKind.Zero, null, null, null);

  static succRaw(l: Level): Level {
    return new Level(LevelKind.Succ, l, null, null);
  }
  static maxRaw(a: Level, b: Level): Level {
    return new Level(LevelKind.Max, a, b, null);
  }
  static imaxRaw(a: Level, b: Level): Level {
    return new Level(LevelKind.IMax, a, b, null);
  }
  static param(n: Name): Level {
    return new Level(LevelKind.Param, null, null, n);
  }
}

export const levelZero = Level.zero;
export const levelOne = Level.succRaw(Level.zero);

export function mkSucc(l: Level): Level {
  return Level.succRaw(l);
}

export function mkSuccN(l: Level, k: number): Level {
  while (k > 0) {
    l = mkSucc(l);
    k--;
  }
  return l;
}

function isZero(l: Level): boolean {
  return l.kind === LevelKind.Zero;
}

/** succ^k of zero */
function isExplicit(l: Level): boolean {
  while (l.kind === LevelKind.Succ) l = l.a!;
  return l.kind === LevelKind.Zero;
}

/** Convert succ^k(l) into [l, k]. */
function toOffset(l: Level): [Level, number] {
  let k = 0;
  while (l.kind === LevelKind.Succ) {
    l = l.a!;
    k++;
  }
  return [l, k];
}

export function levelEq(l1: Level, l2: Level): boolean {
  if (l1 === l2) return true;
  if (l1.kind !== l2.kind || l1.hash !== l2.hash || l1.depth !== l2.depth) return false;
  switch (l1.kind) {
    case LevelKind.Zero:
      return true;
    case LevelKind.Param:
      return l1.name === l2.name;
    case LevelKind.Succ:
      return levelEq(l1.a!, l2.a!);
    case LevelKind.Max:
    case LevelKind.IMax:
      return levelEq(l1.a!, l2.a!) && levelEq(l1.b!, l2.b!);
  }
}

export function levelListEq(a: Level[], b: Level[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!levelEq(a[i]!, b[i]!)) return false;
  return true;
}

function isOne(l: Level): boolean {
  return levelEq(l, levelOne);
}

/** Smart constructor with the simplifications from level.cpp mk_max. */
function mkMax(l1: Level, l2: Level): Level {
  if (isExplicit(l1) && isExplicit(l2)) {
    return l1.depth >= l2.depth ? l1 : l2;
  } else if (levelEq(l1, l2)) {
    return l1;
  } else if (isZero(l1)) {
    return l2;
  } else if (isZero(l2)) {
    return l1;
  } else if (l2.kind === LevelKind.Max && (levelEq(l2.a!, l1) || levelEq(l2.b!, l1))) {
    return l2;
  } else if (l1.kind === LevelKind.Max && (levelEq(l1.a!, l2) || levelEq(l1.b!, l2))) {
    return l1;
  } else {
    const [b1, k1] = toOffset(l1);
    const [b2, k2] = toOffset(l2);
    if (levelEq(b1, b2)) {
      return k1 > k2 ? l1 : l2;
    }
    return Level.maxRaw(l1, l2);
  }
}

export function isNotZero(l: Level): boolean {
  switch (l.kind) {
    case LevelKind.Zero:
    case LevelKind.Param:
      return false;
    case LevelKind.Succ:
      return true;
    case LevelKind.Max:
      return isNotZero(l.a!) || isNotZero(l.b!);
    case LevelKind.IMax:
      return isNotZero(l.b!);
  }
}

export function normalizesToZero(l: Level): boolean {
  switch (l.kind) {
    case LevelKind.Zero:
      return true;
    case LevelKind.Param:
    case LevelKind.Succ:
      return false;
    case LevelKind.Max:
      return normalizesToZero(l.a!) && normalizesToZero(l.b!);
    case LevelKind.IMax:
      return normalizesToZero(l.b!);
  }
}

/** Smart constructor with the simplifications from level.cpp mk_imax. */
export function mkIMax(l1: Level, l2: Level): Level {
  if (isNotZero(l2)) return mkMax(l1, l2);
  if (isZero(l2)) return l2;
  if (isZero(l1) || isOne(l1)) return l2;
  if (levelEq(l1, l2)) return l1;
  return Level.imaxRaw(l1, l2);
}

/** Total order used only inside normalize, from is_norm_lt. */
function isNormLt(a: Level, b: Level): boolean {
  if (a === b) return false;
  const [l1, k1] = toOffset(a);
  const [l2, k2] = toOffset(b);
  if (!levelEq(l1, l2)) {
    if (l1.kind !== l2.kind) return l1.kind < l2.kind;
    switch (l1.kind) {
      case LevelKind.Param:
        return l1.name!.id < l2.name!.id;
      case LevelKind.Max:
      case LevelKind.IMax:
        if (!levelEq(l1.a!, l2.a!)) return isNormLt(l1.a!, l2.a!);
        return isNormLt(l1.b!, l2.b!);
      default:
        throw new KernelError("unreachable", "unreachable in isNormLt");
    }
  }
  return k1 < k2;
}

function pushMaxArgs(l: Level, out: Level[]): void {
  if (l.kind === LevelKind.Max) {
    pushMaxArgs(l.a!, out);
    pushMaxArgs(l.b!, out);
  } else {
    out.push(l);
  }
}

function mkMaxList(args: Level[]): Level {
  let r = args[args.length - 1]!;
  for (let i = args.length - 2; i >= 0; i--) r = mkMax(args[i]!, r);
  return r;
}

function normalize(l: Level): Level {
  const [r, k] = toOffset(l);
  switch (r.kind) {
    case LevelKind.Zero:
    case LevelKind.Param:
      return l;
    case LevelKind.IMax: {
      const l1 = normalize(r.a!);
      const l2 = normalize(r.b!);
      return mkSuccN(mkIMax(l1, l2), k);
    }
    case LevelKind.Max: {
      const todo: Level[] = [];
      const args: Level[] = [];
      pushMaxArgs(r, todo);
      for (const a of todo) pushMaxArgs(normalize(a), args);
      args.sort((x, y) => (isNormLt(x, y) ? -1 : isNormLt(y, x) ? 1 : 0));
      const rargs: Level[] = [];
      let i = 0;
      if (isExplicit(args[i]!)) {
        while (i + 1 < args.length && isExplicit(args[i + 1]!)) i++;
        const kk = toOffset(args[i]!)[1];
        let j = i + 1;
        for (; j < args.length; j++) {
          if (toOffset(args[j]!)[1] >= kk) break;
        }
        if (j < args.length) i++;
      }
      rargs.push(args[i]!);
      let prev = toOffset(args[i]!);
      i++;
      for (; i < args.length; i++) {
        const curr = toOffset(args[i]!);
        if (levelEq(prev[0], curr[0])) {
          if (prev[1] < curr[1]) {
            prev = curr;
            rargs.pop();
            rargs.push(args[i]!);
          }
        } else {
          prev = curr;
          rargs.push(args[i]!);
        }
      }
      for (let m = 0; m < rargs.length; m++) rargs[m] = mkSuccN(rargs[m]!, k);
      return mkMaxList(rargs);
    }
    default:
      throw new KernelError("unreachable", "unreachable in normalize");
  }
}

export function isEquivalent(l1: Level, l2: Level): boolean {
  return levelEq(l1, l2) || levelEq(normalize(l1), normalize(l2));
}

function isGeqCore(l1: Level, l2: Level): boolean {
  if (levelEq(l1, l2) || isZero(l2)) return true;
  if (l2.kind === LevelKind.Max) return isGeq(l1, l2.a!) && isGeq(l1, l2.b!);
  if (l1.kind === LevelKind.Max && (isGeq(l1.a!, l2) || isGeq(l1.b!, l2))) return true;
  if (l2.kind === LevelKind.IMax) return isGeq(l1, l2.a!) && isGeq(l1, l2.b!);
  if (l1.kind === LevelKind.IMax) return isGeq(l1.b!, l2);
  const [b1, k1] = toOffset(l1);
  const [b2, k2] = toOffset(l2);
  if (levelEq(b1, b2) || isZero(b2)) return k1 >= k2;
  if (k1 === k2 && k1 > 0) return isGeq(b1, b2);
  return false;
}

export function isGeq(l1: Level, l2: Level): boolean {
  return isGeqCore(normalize(l1), normalize(l2));
}

/** Substitute level params by position in parallel. */
export function instLevel(l: Level, params: Name[], values: Level[]): Level {
  if (!l.hasParam) return l;
  switch (l.kind) {
    case LevelKind.Zero:
      return l;
    case LevelKind.Param: {
      for (let i = 0; i < params.length; i++) {
        if (params[i] === l.name) return values[i]!;
      }
      return l;
    }
    case LevelKind.Succ:
      return mkSucc(instLevel(l.a!, params, values));
    case LevelKind.Max:
      return mkMax(instLevel(l.a!, params, values), instLevel(l.b!, params, values));
    case LevelKind.IMax:
      return mkIMax(instLevel(l.a!, params, values), instLevel(l.b!, params, values));
  }
}

/** Return a param name in `l` that is not in `ps`, or null. */
export function getUndefParam(l: Level, ps: Name[]): Name | null {
  if (!l.hasParam) return null;
  switch (l.kind) {
    case LevelKind.Zero:
      return null;
    case LevelKind.Param:
      return ps.includes(l.name!) ? null : l.name!;
    case LevelKind.Succ:
      return getUndefParam(l.a!, ps);
    case LevelKind.Max:
    case LevelKind.IMax:
      return getUndefParam(l.a!, ps) ?? getUndefParam(l.b!, ps);
  }
}
