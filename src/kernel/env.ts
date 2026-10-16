/**
 * Declarations and the environment, matching lean4 src/kernel/declaration.h.
 */
import { Name } from "./name.ts";
import type { Expr } from "./expr.ts";
import { KernelError } from "./error.ts";

export interface ConstantVal {
  name: Name;
  lparams: Name[];
  type: Expr;
}

export type Hints = { kind: "opaque" } | { kind: "abbrev" } | { kind: "regular"; height: number };

/** From declaration.cpp compare: < 0 means unfold the first. */
export function compareHints(h1: Hints, h2: Hints): number {
  if (h1.kind === h2.kind) {
    if (h1.kind === "regular" && h2.kind === "regular") {
      if (h1.height === h2.height) return 0;
      return h1.height > h2.height ? -1 : 1;
    }
    return 0;
  }
  if (h1.kind === "opaque") return 1;
  if (h2.kind === "opaque") return -1;
  if (h1.kind === "abbrev") return -1;
  if (h2.kind === "abbrev") return 1;
  throw new KernelError("unreachable", "unreachable in compareHints");
}

export type DefinitionSafety = "safe" | "unsafe" | "partial";

export interface RecRule {
  ctor: Name;
  nfields: number;
  rhs: Expr;
}

export type Decl =
  | { kind: "axiom"; cv: ConstantVal; isUnsafe: boolean }
  | { kind: "def"; cv: ConstantVal; value: Expr; hints: Hints; safety: DefinitionSafety }
  | { kind: "thm"; cv: ConstantVal; value: Expr }
  | { kind: "opaque"; cv: ConstantVal; value: Expr; isUnsafe: boolean }
  | { kind: "quot"; cv: ConstantVal; quotKind: "type" | "ctor" | "lift" | "ind" }
  | {
      kind: "induct";
      cv: ConstantVal;
      numParams: number;
      numIndices: number;
      all: Name[];
      ctors: Name[];
      numNested: number;
      isRec: boolean;
      isUnsafe: boolean;
      isReflexive: boolean;
    }
  | {
      kind: "ctor";
      cv: ConstantVal;
      induct: Name;
      cidx: number;
      numParams: number;
      numFields: number;
      isUnsafe: boolean;
    }
  | {
      kind: "rec";
      cv: ConstantVal;
      all: Name[];
      numParams: number;
      numIndices: number;
      numMotives: number;
      numMinors: number;
      rules: RecRule[];
      k: boolean;
      isUnsafe: boolean;
    };

export type RecVal = Extract<Decl, { kind: "rec" }>;


export function declIsUnsafe(d: Decl): boolean {
  switch (d.kind) {
    case "def":
      return d.safety === "unsafe";
    case "thm":
    case "quot":
      return false;
    default:
      return d.isUnsafe;
  }
}

export function declHasValue(d: Decl): d is Extract<Decl, { kind: "def" | "thm" | "opaque" }> {
  return d.kind === "def" || d.kind === "thm" || d.kind === "opaque";
}

export function recMajorIdx(r: RecVal): number {
  return r.numParams + r.numMotives + r.numMinors + r.numIndices;
}

export class Environment {
  private map: Map<number, Decl>;
  quotInitialized: boolean;

  constructor(map?: Map<number, Decl>, quotInitialized = false) {
    this.map = map ?? new Map<number, Decl>();
    this.quotInitialized = quotInitialized;
  }

  clone(): Environment {
    return new Environment(new Map(this.map), this.quotInitialized);
  }

  find(n: Name): Decl | undefined {
    return this.map.get(n.id);
  }

  get(n: Name): Decl {
    const d = this.map.get(n.id);
    if (d === undefined) throw new KernelError("unknownConstant", `unknown constant '${n}'`);
    return d;
  }

  checkName(n: Name): void {
    if (this.map.has(n.id)) throw new KernelError("alreadyDeclared", `constant '${n}' has already been declared`);
  }

  /** Add without checking. The caller must have checked the declaration. */
  addCore(d: Decl): void {
    this.map.set(d.cv.name.id, d);
  }

  size(): number {
    return this.map.size;
  }
}

export function checkDuplicatedUnivParams(ls: Name[]): void {
  for (let i = 0; i < ls.length; i++) {
    for (let j = i + 1; j < ls.length; j++) {
      if (ls[i] === ls[j])
        throw new KernelError("universe", `failed to add declaration, duplicate universe level parameter: '${ls[i]}'`);
    }
  }
}

export function isNonRecStructure(env: Environment, declName: Name): boolean {
  const info = env.find(declName);
  if (info?.kind !== "induct") return false;
  return info.ctors.length === 1 && info.numIndices === 0 && !info.isRec;
}
