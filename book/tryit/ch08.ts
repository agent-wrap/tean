// Chapter 8 — Recursion from data.
// Derive a recursor's type from a declaration, then run iota by hand.

// A constructor, reduced to what the derivation needs: its name and its
// argument kinds ("self" is a recursive argument, a name is anything else).
interface Ctor {
  name: string;
  args: string[];
}

// Derive the recursor's type, exactly as the kernel does: one motive C,
// one minor premise per constructor, then the major premise.
function deriveRecType(typeName: string, ctors: Ctor[]): string {
  const minors = ctors.map((c) => {
    const binders: string[] = [];
    const ihs: string[] = [];
    const names: string[] = [];
    c.args.forEach((a, i) => {
      const v = `a${i}`;
      names.push(v);
      binders.push(`(${v} : ${a === "self" ? typeName : a})`);
      if (a === "self") ihs.push(`C ${v}`); // induction hypothesis
    });
    const applied = names.length === 0 ? c.name : `(${c.name} ${names.join(" ")})`;
    const parts = [...binders, ...ihs, `C ${applied}`];
    // A minor premise with its own binders is one argument: parenthesize.
    return parts.length === 1 ? parts.join("") : `(${parts.join(" -> ")})`;
  });
  return [`(C : ${typeName} -> Sort u)`, ...minors, `(t : ${typeName})`, `C t`].join(" -> ");
}

console.log(`Nat.rec  : ${deriveRecType("Nat", [
  { name: "zero", args: [] },
  { name: "succ", args: ["self"] },
])}`);
console.log(`Bool.rec : ${deriveRecType("Bool", [
  { name: "true", args: [] },
  { name: "false", args: [] },
])}`);

// Now iota, the computation rule, on real data. The recursor applied to
// a constructor picks that constructor's minor premise — nothing more.
// Read natRec below as `reduce` for this data type: `onZero` is the
// initial value, `onSucc` is the combining step, `major` is the thing
// being folded. The kernel writes one of these for every type you
// declare — and its TYPE is the induction principle.
type Nat = { kind: "zero" } | { kind: "succ"; pred: Nat };
const zero: Nat = { kind: "zero" };
const succ = (pred: Nat): Nat => ({ kind: "succ", pred });

function natRec<T>(onZero: T, onSucc: (n: Nat, ih: T) => T, major: Nat, log: string[]): T {
  switch (major.kind) {
    case "zero":
      log.push("iota: zero");
      return onZero;
    case "succ":
      log.push("iota: succ");
      return onSucc(major.pred, natRec(onZero, onSucc, major.pred, log));
  }
}

function show(n: Nat): string {
  return n.kind === "zero" ? "zero" : `(succ ${show(n.pred)})`;
}

// double, defined by recursion ON THE DATA: no loop, no mutation.
const double = (n: Nat, log: string[]): Nat =>
  natRec<Nat>(zero, (_pred, ih) => succ(succ(ih)), n, log);

const log: string[] = [];
console.log(`double 2 = ${show(double(succ(succ(zero)), log))}`);
console.log(`steps    = ${log.join(", ")}`);

// To break it: in deriveRecType, drop the `C ${v}` induction hypothesis
// line and look at Nat.rec again. The succ case loses its `C a0`
// argument — the recursor can still case-split, but it can no longer
// recurse, and everything from addition upward stops being definable.
// The type of the recursor IS the induction principle, derived, not
// trusted: chapter 13 shows what one forged line in it buys an attacker.

export {}; // keeps this file a self-contained module
