// Chapter 9 — Two more primitives.
// K-like reduction (iota without looking at the proof) and the
// quotient's one computation rule.

// ---------------------------------------------------------------------
// K-like reduction
// ---------------------------------------------------------------------

// A proposition as the kernel sees it: a head and its arguments.
// `Eq x y` is the running example — one constructor, `refl x : Eq x x`.
interface PropType {
  head: string;
  args: string[];
}
const eq = (x: string, y: string): PropType => ({ head: "Eq", args: [x, y] });
const showT = (t: PropType): string => `${t.head} ${t.args.join(" ")}`;

// What the SOLE constructor's type would be, at this instance. For Eq,
// `refl x` always proves `Eq x x` — the second argument is forced.
function soleCtorType(t: PropType): PropType | null {
  const [x] = t.args;
  return t.head === "Eq" && t.args.length === 2 && x !== undefined ? eq(x, x) : null;
}

const defEqType = (a: PropType, b: PropType): boolean =>
  a.head === b.head && a.args.length === b.args.length && a.args.every((x, i) => x === b.args[i]);

// [R: RED-K] For a subsingleton proposition, iota may fire on a STUCK
// proof: the type alone determines the only constructor the proof could
// be, so the kernel substitutes that constructor without inspecting the
// proof. Proof irrelevance fused with computation.
//
// The guard is the whole safety of the rule: the proof's type must be
// definitionally the constructor's type at this instance.
function kLike(proof: string, type: PropType, guard: boolean): string {
  const inst = soleCtorType(type);
  if (inst === null) return `refused: ${showT(type)} is not a subsingleton`;
  if (guard && !defEqType(type, inst)) return `refused: ${showT(type)} is not ${showT(inst)}`;
  return `fires: ${proof} replaced by (refl ${type.args[0] ?? "?"})`;
}

console.log(`h : Eq a a, guard on  -> ${kLike("h", eq("a", "a"), true)}`);
console.log(`h : Eq a b, guard on  -> ${kLike("h", eq("a", "b"), true)}`);
console.log(`h : Eq a b, guard OFF -> ${kLike("h", eq("a", "b"), false)}`);

// ---------------------------------------------------------------------
// The quotient
// ---------------------------------------------------------------------

// Quot r is the type where r-related elements are identified. The kernel
// builds four constants for it and gives them ONE computation rule.
type QVal =
  | { kind: "mk"; value: string } // an element, wrapped: Quot.mk r a
  | { kind: "opaque"; name: string }; // anything else: a variable, say

// [R: RED-QUOT] Lifting a function through the quotient and applying it
// to a WRAPPED element just applies the function. Against anything else
// it is stuck — which is what keeps the quotient abstract.
function quotLift(fn: string, q: QVal): string {
  return q.kind === "mk" ? `${fn} ${q.value}` : `stuck (${q.name} is not a wrapped element)`;
}

console.log(`Quot.lift f h (Quot.mk r a) ~> ${quotLift("f", { kind: "mk", value: "a" })}`);
console.log(`Quot.lift f h q             ~> ${quotLift("f", { kind: "opaque", name: "q" })}`);

// To break it: pass `false` for the guard on the second line and the
// refusal becomes a fire — the kernel hands back a proof of `Eq a a`
// where a proof of `Eq a b` was asked for, and `a = b` is now provable
// for any a and b. That one boolean is a real weakening flag in this
// project's checker, and chapter 13 runs the forged file through it
// both ways.

export {}; // keeps this file a self-contained module
