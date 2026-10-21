// Chapter 8 — Structures and projections.
// A one-constructor type earns three extras: field access, a reduction
// rule for it, and two new ways for the judge to say "equal".

type Expr =
  | { kind: "var"; name: string }
  | { kind: "mk"; struct: string; args: Expr[] } // the constructor, applied
  | { kind: "proj"; struct: string; idx: number; of: Expr }; // field access

const v = (name: string): Expr => ({ kind: "var", name });
const mk = (struct: string, args: Expr[]): Expr => ({ kind: "mk", struct, args });
const proj = (struct: string, idx: number, of: Expr): Expr => ({ kind: "proj", struct, idx, of });

// A structure declaration, reduced to what these rules inspect. A field
// type may mention EARLIER fields, written #0, #1, ...: that is the
// telescope of chapter 7, and it is why projection typing is not a
// table lookup.
interface Struct {
  ctor: string;
  fields: { name: string; type: string }[];
}

const structs = new Map<string, Struct>([
  ["Dep", { ctor: "mkDep", fields: [{ name: "fst", type: "A" }, { name: "snd", type: "B #0" }] }],
  ["Triv", { ctor: "mkTriv", fields: [] }],
]);

// Declared types for the free variables below.
const varTypes = new Map<string, string>([
  ["p", "Dep"],
  ["t1", "Triv"],
  ["t2", "Triv"],
]);

function show(e: Expr): string {
  switch (e.kind) {
    case "var":
      return e.name;
    case "mk":
      return `${structs.get(e.struct)?.ctor ?? "?"}(${e.args.map(show).join(", ")})`;
    case "proj":
      return `${show(e.of)}.${structs.get(e.struct)?.fields[e.idx]?.name ?? String(e.idx)}`;
  }
}

const structOf = (e: Expr): string | undefined =>
  e.kind === "var" ? varTypes.get(e.name) : e.kind === "mk" ? e.struct : undefined;

// [R: T-PROJ] Type a projection by walking the constructor's telescope:
// every earlier field mentioned in the field's type is replaced by a
// projection of the SAME value. `p.snd` is not of type `B #0`; it is of
// type `B p.fst`.
function projType(struct: string, idx: number, of: Expr): string {
  const s = structs.get(struct);
  const field = s?.fields[idx];
  if (s === undefined || field === undefined) throw new Error("no such field");
  let t = field.type;
  for (let i = idx - 1; i >= 0; i--) t = t.replaceAll(`#${i}`, show(proj(struct, i, of)));
  return t;
}

// [R: RED-PROJ] A projection reduces only when its target is LITERALLY a
// constructor application. Against a variable it is stuck, and stuck is
// the normal case.
function reduceProj(e: Expr): Expr | null {
  if (e.kind !== "proj" || e.of.kind !== "mk" || e.of.struct !== e.struct) return null;
  return e.of.args[e.idx] ?? null;
}

// Rebuild a value as "the constructor applied to its own projections".
const etaExpand = (struct: string, e: Expr): Expr =>
  mk(struct, (structs.get(struct)?.fields ?? []).map((_f, i) => proj(struct, i, e)));

function defEq(a0: Expr, b0: Expr): boolean {
  const a = reduceProj(a0) ?? a0;
  const b = reduceProj(b0) ?? b0;
  if (congruent(a, b)) return true;

  const sa = structOf(a);
  const sb = structOf(b);
  // [R: DEFEQ-UNIT-LIKE] A structure with no fields has exactly one
  // element, so any two of its elements are equal — without looking.
  if (sa !== undefined && sa === sb && structs.get(sa)?.fields.length === 0) return true;

  // [R: DEFEQ-ETA-STRUCT] An element of a structure IS the constructor
  // applied to its own projections. Expand the side that is not already
  // a constructor application, and ask again.
  if (a.kind !== "mk" && b.kind === "mk" && sa === b.struct) return defEq(etaExpand(b.struct, a), b);
  if (b.kind !== "mk" && a.kind === "mk" && sb === a.struct) return defEq(a, etaExpand(a.struct, b));
  return false;
}

function congruent(a: Expr, b: Expr): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "var":
      return a.name === (b as { name: string }).name;
    case "mk": {
      const bb = b as { struct: string; args: Expr[] };
      return a.struct === bb.struct && a.args.every((x, i) => defEq(x, bb.args[i] ?? x));
    }
    case "proj": {
      const bb = b as { struct: string; idx: number; of: Expr };
      return a.struct === bb.struct && a.idx === bb.idx && defEq(a.of, bb.of);
    }
  }
}

const p = v("p");
const built = mk("Dep", [v("a"), v("b")]);

// Typing: the telescope walk, not a table lookup.
console.log(`type of p.fst                 : ${projType("Dep", 0, p)}`);
console.log(`type of p.snd                 : ${projType("Dep", 1, p)}`);

// Reduction: only against a literal constructor application.
console.log(`${show(proj("Dep", 1, built)).padEnd(30)}~> ${show(reduceProj(proj("Dep", 1, built)) ?? proj("Dep", 1, built))}`);
console.log(`${show(proj("Dep", 1, p)).padEnd(30)}~> stuck (its target is a variable)`);

// The two new equalities.
console.log(`p == mkDep(p.fst, p.snd)      : ${defEq(p, etaExpand("Dep", p))}`);
console.log(`t1 == t2  (Triv has no fields): ${defEq(v("t1"), v("t2"))}`);
console.log(`a == b    (unrelated)         : ${defEq(v("a"), v("b"))}`);

// To break it: delete the DEFEQ-ETA-STRUCT branch and watch the fifth
// line turn false. Nothing unsound happens — a structure value and its
// own field-by-field copy are genuinely the same thing, and refusing to
// see it only costs completeness. Then delete the `e.of.struct !==
// e.struct` guard in reduceProj instead, and nothing visible happens at
// all: the projections here all agree. That silence is the point of
// chapter 14.

export {}; // keeps this file a self-contained module
