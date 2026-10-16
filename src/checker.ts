/**
 * The checker: admits declarations into the environment with full checking,
 * following lean4 src/kernel/environment.cpp. Exported metadata for
 * inductives, constructors, and recursors is never trusted: the checker
 * derives its own and compares.
 */
import { Name } from "./kernel/name.ts";
import { type Expr, exprEq } from "./kernel/expr.ts";
import { KernelError } from "./kernel/error.ts";
import {
  Environment, checkDuplicatedUnivParams, type ConstantVal, type DefinitionSafety, } from "./kernel/env.ts";
import { TypeChecker } from "./kernel/tc.ts";
import { addInductive, type InductiveDecl, type InductiveType } from "./kernel/inductive.ts";
import { addQuot, checkExportedQuot } from "./kernel/quot.ts";
import { isWeakened } from "./kernel/weaken.ts";
import { ParseError } from "./export/parser.ts";
import type { ExpDecl, ExpInductive } from "./export/parser.ts";
import { type Result, ok, err } from "./result.ts";

/**
 * A typed boundary failure. "refusal" means the kernel or parser refused
 * the input (arena exit code 1). "bug" means the checker itself broke
 * (arena exit code 3). The classification happens here, once.
 */
export type CheckFailure =
  | { kind: "refusal"; code: string; message: string }
  | { kind: "bug"; message: string };

function toCheckFailure(e: unknown): CheckFailure {
  if (e instanceof KernelError) return { kind: "refusal", code: e.code, message: e.message };
  if (e instanceof ParseError) return { kind: "refusal", code: "parse", message: e.message };
  return { kind: "bug", message: e instanceof Error ? e.message : String(e) };
}

/** Run one boundary step, converting throws into a typed Result. */
export function tryStep<T>(f: () => T): Result<T, CheckFailure> {
  try {
    return ok(f());
  } catch (e) {
    return err(toCheckFailure(e));
  }
}

export class Checker {
  env = new Environment();
  declsChecked = 0;

  private checkConstantVal(cv: ConstantVal, tc: TypeChecker): void {
    this.env.checkName(cv.name);
    checkDuplicatedUnivParams(cv.lparams);
    const sort = tc.check(cv.type, cv.lparams);
    tc.ensureSort(sort, cv.type);
  }

  addDecl(d: ExpDecl): void {
    switch (d.kind) {
      case "axiom": {
        const tc = new TypeChecker(this.env, d.isUnsafe ? "unsafe" : "safe");
        this.checkConstantVal({ name: d.name, lparams: d.levelParams, type: d.type }, tc);
        this.env.addCore({
          kind: "axiom",
          cv: { name: d.name, lparams: d.levelParams, type: d.type },
          isUnsafe: d.isUnsafe,
        });
        break;
      }
      case "def": {
        const cv = { name: d.name, lparams: d.levelParams, type: d.type };
        if (d.safety === "unsafe") {
          // An unsafe definition can be recursive: check the header, add,
          // then check the body.
          const tc = new TypeChecker(this.env, "unsafe");
          this.checkConstantVal(cv, tc);
          this.env.addCore({ kind: "def", cv, value: d.value, hints: d.hints, safety: d.safety });
          const tc2 = new TypeChecker(this.env, "unsafe");
          const valType = tc2.check(d.value, d.levelParams);
          if (!tc2.isDefEq(valType, d.type))
            throw new KernelError("typeMismatch", `definition '${d.name}': value type does not match declared type`);
        } else {
          const safety: DefinitionSafety = d.safety === "partial" ? "safe" : "safe";
          const tc = new TypeChecker(this.env, safety);
          this.checkConstantVal(cv, tc);
          const valType = tc.check(d.value, d.levelParams);
          if (!tc.isDefEq(valType, d.type))
            throw new KernelError("typeMismatch", `definition '${d.name}': value type does not match declared type`);
          this.env.addCore({ kind: "def", cv, value: d.value, hints: d.hints, safety: d.safety });
        }
        break;
      }
      case "thm": {
        const cv = { name: d.name, lparams: d.levelParams, type: d.type };
        const tc = new TypeChecker(this.env, "safe");
        this.checkConstantVal(cv, tc);
        // [R: WF-THM-PROP] weakened only by the forgery gate.
        if (!isWeakened("WF-THM-PROP") && !tc.isProp(d.type))
          throw new KernelError("typeMismatch", `theorem '${d.name}': type is not a proposition`);
        const valType = tc.check(d.value, d.levelParams);
        if (!tc.isDefEq(valType, d.type))
          throw new KernelError("typeMismatch", `theorem '${d.name}': value type does not match declared type`);
        this.env.addCore({ kind: "thm", cv, value: d.value });
        break;
      }
      case "opaque": {
        const cv = { name: d.name, lparams: d.levelParams, type: d.type };
        const tc = new TypeChecker(this.env, d.isUnsafe ? "unsafe" : "safe");
        this.checkConstantVal(cv, tc);
        const valType = tc.check(d.value, d.levelParams);
        if (!tc.isDefEq(valType, d.type))
          throw new KernelError("typeMismatch", `opaque '${d.name}': value type does not match declared type`);
        this.env.addCore({ kind: "opaque", cv, value: d.value, isUnsafe: d.isUnsafe });
        break;
      }
      case "quot": {
        // The canonical four declarations come from the checker itself.
        addQuot(this.env);
        checkExportedQuot(this.env, {
          kind: "quot",
          cv: { name: d.name, lparams: d.levelParams, type: d.type },
          quotKind: d.quotKind,
        });
        break;
      }
      case "inductive":
        this.addInductiveDecl(d);
        break;
    }
    this.declsChecked++;
  }

  private addInductiveDecl(d: ExpInductive): void {
    const first = d.types[0];
    if (first === undefined) throw new KernelError("inductive", "empty inductive declaration");
    const lparams = first.levelParams;
    const nparams = first.numParams;
    const ctorByName = new Map<number, (typeof d.ctors)[number]>();
    for (const c of d.ctors) ctorByName.set(c.name.id, c);
    const types: InductiveType[] = d.types.map((t) => ({
      name: t.name,
      type: t.type,
      ctors: t.ctors.map((cn) => {
        const c = ctorByName.get(cn.id);
        if (c === undefined) throw new KernelError("exportMismatch", `inductive '${t.name}': constructor '${cn}' not in export`);
        return { name: c.name, type: c.type };
      }),
    }));
    const isUnsafe = d.types.some((t) => t.isUnsafe);
    const decl: InductiveDecl = { lparams, nparams, types, isUnsafe };

    // Derive everything ourselves. This also installs the declarations.
    addInductive(this.env, decl);

    // [R: WF-REC-DERIVE] weakened only by the forgery gate: trust the
    // exported recursors instead of comparing against the derived ones.
    // This is the historical attack surface that 073_BogusRecursor targets.
    if (isWeakened("WF-REC-DERIVE")) {
      for (const r of d.recs) {
        this.env.addCore({
          kind: "rec",
          cv: { name: r.name, lparams: r.levelParams, type: r.type },
          all: r.all,
          numParams: r.numParams,
          numIndices: r.numIndices,
          numMotives: r.numMotives,
          numMinors: r.numMinors,
          rules: r.rules,
          k: r.k,
          isUnsafe: r.isUnsafe,
        });
      }
      return;
    }

    // Now compare the derived declarations against the exported metadata.
    const mismatch = (what: string, n: Name): never => {
      throw new KernelError("exportMismatch", `exported ${what} for '${n}' does not match the derived one`);
    };
    const sameNames = (a: Name[], b: Name[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);
    const sameTypeModuloLparams = (expLparams: Name[], expType: Expr, gotLparams: Name[], gotType: Expr): boolean =>
      sameNames(expLparams, gotLparams) && exprEq(expType, gotType);

    for (const t of d.types) {
      const got = this.env.get(t.name);
      if (got.kind !== "induct") return mismatch("inductive", t.name);
      if (
        got.numParams !== t.numParams ||
        got.numIndices !== t.numIndices ||
        !sameNames(got.all, t.all) ||
        !sameNames(got.ctors, t.ctors) ||
        got.isRec !== t.isRec ||
        got.isUnsafe !== t.isUnsafe ||
        got.isReflexive !== t.isReflexive ||
        !sameTypeModuloLparams(t.levelParams, t.type, got.cv.lparams, got.cv.type)
      )
        return mismatch("inductive", t.name);
    }
    for (const c of d.ctors) {
      const got = this.env.get(c.name);
      if (got.kind !== "ctor") return mismatch("constructor", c.name);
      if (
        got.induct !== c.induct ||
        got.cidx !== c.cidx ||
        got.numParams !== c.numParams ||
        got.numFields !== c.numFields ||
        got.isUnsafe !== c.isUnsafe ||
        !sameTypeModuloLparams(c.levelParams, c.type, got.cv.lparams, got.cv.type)
      )
        return mismatch("constructor", c.name);
    }
    for (const r of d.recs) {
      const got = this.env.get(r.name);
      if (got.kind !== "rec") return mismatch("recursor", r.name);
      if (
        got.numParams !== r.numParams ||
        got.numIndices !== r.numIndices ||
        got.numMotives !== r.numMotives ||
        got.numMinors !== r.numMinors ||
        got.k !== r.k ||
        got.isUnsafe !== r.isUnsafe ||
        !sameNames(got.all, r.all) ||
        got.rules.length !== r.rules.length ||
        !sameTypeModuloLparams(r.levelParams, r.type, got.cv.lparams, got.cv.type)
      )
        return mismatch("recursor", r.name);
      for (let i = 0; i < r.rules.length; i++) {
        const er = r.rules[i];
        const gr = got.rules[i];
        if (er === undefined || gr === undefined) return mismatch("recursor rule", r.name);
        if (er.ctor !== gr.ctor || er.nfields !== gr.nfields || !exprEq(er.rhs, gr.rhs))
          return mismatch("recursor rule", r.name);
      }
    }
  }
}
