// Chapter 6 — Data types are contracts.
// The positivity check, on constructor argument types.

// A constructor argument type, simplified to what the check inspects:
type ArgType =
  | { kind: "self" } // the type being declared, applied to its params
  | { kind: "other"; name: string } // any established type
  | { kind: "arrow"; from: ArgType; to: ArgType }; // a function type

const self: ArgType = { kind: "self" };
const other = (name: string): ArgType => ({ kind: "other", name });
const arrow = (from: ArgType, to: ArgType): ArgType => ({ kind: "arrow", from, to });

function mentionsSelf(t: ArgType): boolean {
  switch (t.kind) {
    case "self":
      return true;
    case "other":
      return false;
    case "arrow":
      return mentionsSelf(t.from) || mentionsSelf(t.to);
  }
}

// Strict positivity: the type being declared may appear as the RESULT of
// an argument's type, but never to the LEFT of an arrow inside it.
function isPositive(t: ArgType): boolean {
  if (!mentionsSelf(t)) return true; // nonrecursive argument: fine
  switch (t.kind) {
    case "self":
      return true; // a plain recursive argument: fine
    case "other":
      return true;
    case "arrow":
      // The domain must not mention the type at all; recurse on the result.
      return !mentionsSelf(t.from) && isPositive(t.to);
  }
}

function show(t: ArgType): string {
  switch (t.kind) {
    case "self":
      return "t";
    case "other":
      return t.name;
    case "arrow":
      return `(${show(t.from)} -> ${show(t.to)})`;
  }
}

function verdict(ctor: string, args: ArgType[]): void {
  const bad = args.find((a) => !isPositive(a));
  const v = bad === undefined ? "accepted" : `refused: ${show(bad)} is not positive`;
  console.log(`${ctor.padEnd(34)} ${v}`);
}

// Nat:  zero : t          succ : t -> t  (argument type is `self`)
verdict("succ (arg: t)", [self]);
// Rose tree: node : (Nat -> t) -> t — self on the RIGHT of the arrow: ok.
verdict("node (arg: Nat -> t)", [arrow(other("Nat"), self)]);
// The forbidden shape: mk : (t -> Bool) -> t — self on the LEFT.
verdict("mk (arg: t -> Bool)", [arrow(self, other("Bool"))]);
// Hidden one level deeper, still caught:
verdict("mk2 (arg: (t -> Bool) -> Nat)", [arrow(arrow(self, other("Bool")), other("Nat"))]);

// Now the same shape in the type system you already use. TypeScript has
// no positivity rule, because a type system that only has to not crash
// does not need one:
type Bad = (x: Bad) => boolean;
const notMe: Bad = (x) => !x(x); // Cantor's diagonal, written out
console.log(`\nTypeScript accepts   type Bad = (x: Bad) => boolean`);
console.log(`and with it           notMe = (x) => !x(x)   : ${typeof notMe}`);
console.log(`notMe(notMe) does not terminate, so it is never called here.`);

// To break it: accept `mk : (t -> Bool) -> t` and follow the arithmetic.
// Each element of t now carries a function t -> Bool. That gives an
// injection from functions-out-of-t into t itself, and Cantor's diagonal
// builds the impossible member out of it — exactly the `notMe` above. In
// a programming language that is a hang; in a proof assistant it is a
// provable False. Chapter 13 runs this attack against the real checker,
// twice: once refused, once with the rule off.

export {}; // keeps this file a self-contained module
