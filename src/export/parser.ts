/**
 * Parser for the lean4export NDJSON format, version 3.1.0.
 * See docs/format_ndjson.md. The real bytes were read before this was
 * written; see docs/NOTEBOOK.md 2026-10-15.
 */
import { Name } from "../kernel/name";
import { Level } from "../kernel/level";
import { type Expr, BVar, Sort, Const, App, Lam, Pi, Let, Lit, Proj, type BinderInfo } from "../kernel/expr";
import { KernelError, type Hints, type DefinitionSafety } from "../kernel/env";

export class ParseError extends Error {}

// Exported declaration shapes, carrying all metadata for validation.

export interface ExpAxiom {
  kind: "axiom";
  name: Name;
  levelParams: Name[];
  type: Expr;
  isUnsafe: boolean;
}

export interface ExpDef {
  kind: "def";
  name: Name;
  levelParams: Name[];
  type: Expr;
  value: Expr;
  hints: Hints;
  safety: DefinitionSafety;
  all: Name[];
}

export interface ExpOpaque {
  kind: "opaque";
  name: Name;
  levelParams: Name[];
  type: Expr;
  value: Expr;
  isUnsafe: boolean;
  all: Name[];
}

export interface ExpThm {
  kind: "thm";
  name: Name;
  levelParams: Name[];
  type: Expr;
  value: Expr;
  all: Name[];
}

export interface ExpQuot {
  kind: "quot";
  name: Name;
  levelParams: Name[];
  type: Expr;
  quotKind: "type" | "ctor" | "lift" | "ind";
}

export interface ExpInductiveVal {
  name: Name;
  levelParams: Name[];
  type: Expr;
  numParams: number;
  numIndices: number;
  all: Name[];
  ctors: Name[];
  numNested: number;
  isRec: boolean;
  isUnsafe: boolean;
  isReflexive: boolean;
}

export interface ExpConstructorVal {
  name: Name;
  levelParams: Name[];
  type: Expr;
  induct: Name;
  cidx: number;
  numParams: number;
  numFields: number;
  isUnsafe: boolean;
}

export interface ExpRecursorRule {
  ctor: Name;
  nfields: number;
  rhs: Expr;
}

export interface ExpRecursorVal {
  name: Name;
  levelParams: Name[];
  type: Expr;
  all: Name[];
  numParams: number;
  numIndices: number;
  numMotives: number;
  numMinors: number;
  rules: ExpRecursorRule[];
  k: boolean;
  isUnsafe: boolean;
}

export interface ExpInductive {
  kind: "inductive";
  types: ExpInductiveVal[];
  ctors: ExpConstructorVal[];
  recs: ExpRecursorVal[];
}

export type ExpDecl = ExpAxiom | ExpDef | ExpOpaque | ExpThm | ExpQuot | ExpInductive;

export interface ExportMeta {
  exporter: { name: string; version: string };
  lean: { githash: string; version: string };
  format: { version: string };
}

// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function asNum(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v)) throw new ParseError(`expected integer for ${what}`);
  return v;
}

function asStr(v: unknown, what: string): string {
  if (typeof v !== "string") throw new ParseError(`expected string for ${what}`);
  return v;
}

function asBool(v: unknown, what: string): boolean {
  if (typeof v !== "boolean") throw new ParseError(`expected boolean for ${what}`);
  return v;
}

function asArr(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new ParseError(`expected array for ${what}`);
  return v;
}

function asObj(v: unknown, what: string): Json {
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new ParseError(`expected object for ${what}`);
  return v as Json;
}

const binderInfos: ReadonlySet<string> = new Set(["default", "implicit", "strictImplicit", "instImplicit"]);

function asBinderInfo(v: unknown): BinderInfo {
  const s = asStr(v, "binderInfo");
  if (!binderInfos.has(s)) throw new ParseError(`unknown binderInfo '${s}'`);
  return s as BinderInfo;
}

export class ExportParser {
  meta: ExportMeta | null = null;
  private names: Name[] = [Name.anonymous];
  private levels: Level[] = [Level.zero];
  private exprs: Expr[] = [];

  private getName(i: unknown, what = "name index"): Name {
    const idx = asNum(i, what);
    const n = this.names[idx];
    if (n === undefined) throw new ParseError(`undefined name index ${idx}`);
    return n;
  }

  private getLevel(i: unknown, what = "level index"): Level {
    const idx = asNum(i, what);
    const l = this.levels[idx];
    if (l === undefined) throw new ParseError(`undefined level index ${idx}`);
    return l;
  }

  private getExpr(i: unknown, what = "expr index"): Expr {
    const idx = asNum(i, what);
    const e = this.exprs[idx];
    if (e === undefined) throw new ParseError(`undefined expr index ${idx}`);
    return e;
  }

  private setAt<T>(table: T[], idx: number, v: T, what: string): void {
    if (table[idx] !== undefined) throw new ParseError(`duplicate ${what} index ${idx}`);
    table[idx] = v;
  }

  private names_(v: unknown, what: string): Name[] {
    return asArr(v, what).map((i) => this.getName(i, what));
  }

  /**
   * Process one NDJSON line. Returns a declaration when the line is one,
   * null for primitives and metadata.
   */
  processLine(line: string): ExpDecl | null {
    const trimmed = line.trim();
    if (trimmed === "") return null;
    let o: Json;
    try {
      o = asObj(JSON.parse(trimmed), "line");
    } catch (err) {
      throw new ParseError(`invalid JSON line: ${err instanceof Error ? err.message : String(err)}`);
    }

    if ("meta" in o) {
      this.meta = o["meta"] as unknown as ExportMeta;
      return null;
    }
    if ("in" in o) {
      const idx = asNum(o["in"], "name index");
      let n: Name;
      if ("str" in o) {
        const s = asObj(o["str"], "str");
        n = Name.str(this.getName(s["pre"]), asStr(s["str"], "name part"));
      } else if ("num" in o) {
        const s = asObj(o["num"], "num");
        n = Name.num(this.getName(s["pre"]), BigInt(asNum(s["i"], "name numeral")));
      } else {
        throw new ParseError("name line without str or num");
      }
      this.setAt(this.names, idx, n, "name");
      return null;
    }
    if ("il" in o) {
      const idx = asNum(o["il"], "level index");
      let l: Level;
      if ("succ" in o) {
        l = Level.succRaw(this.getLevel(o["succ"]));
      } else if ("max" in o) {
        const [a, b] = asArr(o["max"], "max");
        l = Level.maxRaw(this.getLevel(a), this.getLevel(b));
      } else if ("imax" in o) {
        const [a, b] = asArr(o["imax"], "imax");
        l = Level.imaxRaw(this.getLevel(a), this.getLevel(b));
      } else if ("param" in o) {
        l = Level.param(this.getName(o["param"]));
      } else {
        throw new ParseError("level line without succ, max, imax, or param");
      }
      this.setAt(this.levels, idx, l, "level");
      return null;
    }
    if ("ie" in o) {
      const idx = asNum(o["ie"], "expr index");
      this.setAt(this.exprs, idx, this.parseExpr(o), "expr");
      return null;
    }
    return this.parseDecl(o);
  }

  private parseExpr(o: Json): Expr {
    if ("bvar" in o) return new BVar(asNum(o["bvar"], "bvar"));
    if ("sort" in o) return new Sort(this.getLevel(o["sort"]));
    if ("const" in o) {
      const c = asObj(o["const"], "const");
      return new Const(
        this.getName(c["name"]),
        asArr(c["us"], "us").map((u) => this.getLevel(u)),
      );
    }
    if ("app" in o) {
      const a = asObj(o["app"], "app");
      return new App(this.getExpr(a["fn"]), this.getExpr(a["arg"]));
    }
    if ("lam" in o) {
      const l = asObj(o["lam"], "lam");
      return new Lam(this.getName(l["name"]), asBinderInfo(l["binderInfo"]), this.getExpr(l["type"]), this.getExpr(l["body"]));
    }
    if ("forallE" in o) {
      const l = asObj(o["forallE"], "forallE");
      return new Pi(this.getName(l["name"]), asBinderInfo(l["binderInfo"]), this.getExpr(l["type"]), this.getExpr(l["body"]));
    }
    if ("letE" in o) {
      const l = asObj(o["letE"], "letE");
      return new Let(
        this.getName(l["name"]),
        this.getExpr(l["type"]),
        this.getExpr(l["value"]),
        this.getExpr(l["body"]),
        asBool(l["nondep"], "nondep"),
      );
    }
    if ("proj" in o) {
      const p = asObj(o["proj"], "proj");
      return new Proj(this.getName(p["typeName"]), asNum(p["idx"], "proj idx"), this.getExpr(p["struct"]));
    }
    if ("natVal" in o) {
      const v = o["natVal"];
      if (typeof v === "string" || typeof v === "number") return new Lit(BigInt(v));
      throw new ParseError("natVal is not a string or number");
    }
    if ("strVal" in o) return new Lit(asStr(o["strVal"], "strVal"));
    if ("mdata" in o) {
      // The kernel ignores metadata. Unwrap at parse time.
      const m = asObj(o["mdata"], "mdata");
      return this.getExpr(m["expr"]);
    }
    throw new ParseError(`unknown expression line: ${JSON.stringify(Object.keys(o))}`);
  }

  private parseDecl(o: Json): ExpDecl {
    if ("axiom" in o) {
      const a = asObj(o["axiom"], "axiom");
      return {
        kind: "axiom",
        name: this.getName(a["name"]),
        levelParams: this.names_(a["levelParams"], "levelParams"),
        type: this.getExpr(a["type"]),
        isUnsafe: asBool(a["isUnsafe"], "isUnsafe"),
      };
    }
    if ("def" in o) {
      const d = asObj(o["def"], "def");
      return {
        kind: "def",
        name: this.getName(d["name"]),
        levelParams: this.names_(d["levelParams"], "levelParams"),
        type: this.getExpr(d["type"]),
        value: this.getExpr(d["value"]),
        hints: this.parseHints(d["hints"]),
        safety: this.parseSafety(d["safety"]),
        all: this.names_(d["all"], "all"),
      };
    }
    if ("opaque" in o) {
      const d = asObj(o["opaque"], "opaque");
      return {
        kind: "opaque",
        name: this.getName(d["name"]),
        levelParams: this.names_(d["levelParams"], "levelParams"),
        type: this.getExpr(d["type"]),
        value: this.getExpr(d["value"]),
        isUnsafe: asBool(d["isUnsafe"], "isUnsafe"),
        all: this.names_(d["all"], "all"),
      };
    }
    if ("thm" in o) {
      const d = asObj(o["thm"], "thm");
      return {
        kind: "thm",
        name: this.getName(d["name"]),
        levelParams: this.names_(d["levelParams"], "levelParams"),
        type: this.getExpr(d["type"]),
        value: this.getExpr(d["value"]),
        all: this.names_(d["all"], "all"),
      };
    }
    if ("quot" in o) {
      const d = asObj(o["quot"], "quot");
      const k = asStr(d["kind"], "quot kind");
      if (k !== "type" && k !== "ctor" && k !== "lift" && k !== "ind")
        throw new ParseError(`unknown quot kind '${k}'`);
      return {
        kind: "quot",
        name: this.getName(d["name"]),
        levelParams: this.names_(d["levelParams"], "levelParams"),
        type: this.getExpr(d["type"]),
        quotKind: k,
      };
    }
    if ("inductive" in o) {
      const d = asObj(o["inductive"], "inductive");
      const types = asArr(d["types"], "types").map((t) => this.parseInductiveVal(asObj(t, "InductiveVal")));
      const ctors = asArr(d["ctors"], "ctors").map((t) => this.parseConstructorVal(asObj(t, "ConstructorVal")));
      const recs = asArr(d["recs"], "recs").map((t) => this.parseRecursorVal(asObj(t, "RecursorVal")));
      return { kind: "inductive", types, ctors, recs };
    }
    throw new ParseError(`unknown declaration line: ${JSON.stringify(Object.keys(o))}`);
  }

  private parseHints(v: unknown): Hints {
    if (v === "opaque") return { kind: "opaque" };
    if (v === "abbrev") return { kind: "abbrev" };
    const o = asObj(v, "hints");
    if ("regular" in o) return { kind: "regular", height: asNum(o["regular"], "hint height") };
    throw new ParseError("unknown reducibility hint");
  }

  private parseSafety(v: unknown): DefinitionSafety {
    const s = asStr(v, "safety");
    if (s !== "safe" && s !== "unsafe" && s !== "partial") throw new ParseError(`unknown safety '${s}'`);
    return s;
  }

  private parseInductiveVal(t: Json): ExpInductiveVal {
    return {
      name: this.getName(t["name"]),
      levelParams: this.names_(t["levelParams"], "levelParams"),
      type: this.getExpr(t["type"]),
      numParams: asNum(t["numParams"], "numParams"),
      numIndices: asNum(t["numIndices"], "numIndices"),
      all: this.names_(t["all"], "all"),
      ctors: this.names_(t["ctors"], "ctors"),
      numNested: asNum(t["numNested"], "numNested"),
      isRec: asBool(t["isRec"], "isRec"),
      isUnsafe: asBool(t["isUnsafe"], "isUnsafe"),
      isReflexive: asBool(t["isReflexive"], "isReflexive"),
    };
  }

  private parseConstructorVal(t: Json): ExpConstructorVal {
    return {
      name: this.getName(t["name"]),
      levelParams: this.names_(t["levelParams"], "levelParams"),
      type: this.getExpr(t["type"]),
      induct: this.getName(t["induct"]),
      cidx: asNum(t["cidx"], "cidx"),
      numParams: asNum(t["numParams"], "numParams"),
      numFields: asNum(t["numFields"], "numFields"),
      isUnsafe: asBool(t["isUnsafe"], "isUnsafe"),
    };
  }

  private parseRecursorVal(t: Json): ExpRecursorVal {
    return {
      name: this.getName(t["name"]),
      levelParams: this.names_(t["levelParams"], "levelParams"),
      type: this.getExpr(t["type"]),
      all: this.names_(t["all"], "all"),
      numParams: asNum(t["numParams"], "numParams"),
      numIndices: asNum(t["numIndices"], "numIndices"),
      numMotives: asNum(t["numMotives"], "numMotives"),
      numMinors: asNum(t["numMinors"], "numMinors"),
      rules: asArr(t["rules"], "rules").map((r) => {
        const o = asObj(r, "RecursorRule");
        return {
          ctor: this.getName(o["ctor"]),
          nfields: asNum(o["nfields"], "nfields"),
          rhs: this.getExpr(o["rhs"]),
        };
      }),
      k: asBool(t["k"], "k"),
      isUnsafe: asBool(t["isUnsafe"], "isUnsafe"),
    };
  }
}

export { KernelError };
