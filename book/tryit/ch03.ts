// Chapter 3 — Types are terms.
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

// (p : Prop) -> p   quantifies over ALL propositions...
// domain Prop : Sort 1, so l1 = 1; body p : Prop, so l2 = 0.
console.log(`(p : Prop) -> p        : ${name(piSort(1, 0))}`);

// ...and lands back in Prop. That is impredicativity. Compare Type:
// (A : Type) -> A   has l1 = 2 (Type : Sort 2) and l2 = 1.
console.log(`(A : Type) -> A        : ${name(piSort(2, 1))}`);

// A chain of quantifiers only climbs as high as its tallest domain:
console.log(`(A : Type) -> A -> A   : ${name(piSort(2, piSort(1, 1)))}`);

// With max instead of imax, Prop stops absorbing:
function piSortWrong(l1: number, l2: number): number {
  return Math.max(l1, l2);
}
console.log(`same, with max         : ${name(piSortWrong(1, 0))}`);

// To break it: that last line IS the break. A kernel whose pi rule uses
// max instead of imax rejects `(p : Prop) -> p : Prop`, and with it most
// of logic: False, And, Or are all defined by quantifying over Prop.
// The dual mistake — letting Sort l : Sort l — accepts everything,
// including a proof of False, by Girard's paradox. The ladder is not
// decoration; it is the wall between those two failures.

export {}; // keeps this file a self-contained module
