// Chapter 4 — Types are terms.
// The universe ladder, and the one function that holds Prop in place.

// Concrete levels are enough to see the shape (the real thing also has
// level variables, max, and a normalizer).
// Sort 0 is Prop. Sort 1 is Type. Sort 2 is the type of Type. And so on.

function imax(l1: number, l2: number): number {
  // imax collapses when the right side is zero: a family of propositions
  // is a proposition, no matter how big the domain is.
  return l2 === 0 ? 0 : Math.max(l1, l2);
}

// The typing rule for a function type (x : A) -> B:
//   A : Sort l1    B : Sort l2 (under x)
//   -------------------------------------
//   ((x : A) -> B) : Sort (imax l1 l2)
function piSort(l1: number, l2: number): number {
  return imax(l1, l2);
}

function name(l: number): string {
  if (l === 0) return "Prop";
  if (l === 1) return "Type";
  return `Sort ${l}`;
}

// The everyday case. `n + 0 = n` is a proposition, so l2 = 0; the domain
// Nat is a data type, so Nat : Sort 1 and l1 = 1. A statement ABOUT
// numbers must still be a statement.
console.log(`(n : Nat) -> n + 0 = n : ${name(piSort(1, 0))}`);

// The self-referential case: quantifying over ALL propositions...
// domain Prop : Sort 1, so l1 = 1; body p : Prop, so l2 = 0.
console.log(`(p : Prop) -> p        : ${name(piSort(1, 0))}`);

// ...and it lands back in Prop too. That is impredicativity. Compare a
// quantifier over Type: (A : Type) -> A has l1 = 2 and l2 = 1.
console.log(`(A : Type) -> A        : ${name(piSort(2, 1))}`);

// A chain of quantifiers only climbs as high as its tallest domain:
console.log(`(A : Type) -> A -> A   : ${name(piSort(2, piSort(1, 1)))}`);

// With max instead of imax, Prop stops absorbing:
function piSortWrong(l1: number, l2: number): number {
  return Math.max(l1, l2);
}
console.log(`n + 0 = n, with max    : ${name(piSortWrong(1, 0))}`);

// To break it: that last line IS the break. A kernel whose pi rule uses
// max instead of imax says that `(n : Nat) -> n + 0 = n` lives in Type,
// not Prop — every theorem that quantifies over a data type stops being
// a proposition, and the chapter 6 rule that makes any two proofs of a
// proposition interchangeable no longer applies to any of them.
// The dual mistake — letting Sort l : Sort l — accepts everything,
// including a proof of False, by Girard's paradox. The ladder is not
// decoration; it is the wall between those two failures.

export {}; // keeps this file a self-contained module
