// Chapter 9 — The failure ranking.
// One underscore, 46 test failures, and the method that found it.

import { Name } from "../../src/kernel/name.ts";

// The kernel derives a FRESH universe variable for a recursor's motive.
// Fresh means: "u", unless the declaration already uses "u", in which
// case append a counter. The question a port must answer exactly:
// what string does appending produce?

// The guess a port naturally writes:
function appendAfterGuess(base: string, i: number): string {
  return `${base}${i}`; // u -> u1
}

// What the kernel's name::append_after actually does — src/kernel/name.ts
// ports it, and vendor/lean4-inductive.cpp calls it for this exact job:
const real = Name.simple("u").appendAfter(1).toString();

console.log(`guess       : ${appendAfterGuess("u", 1)}`);
console.log(`kernel      : ${real}`);
// The export of PUnit.rec names its motive level u_1. A derived recursor
// named u1 differs from the exported one in every level annotation, so
// the compare refuses — once per universe-polymorphic inductive type.
console.log(`export says : u_1 (PUnit.rec levelParams, read from real bytes)`);

// The method that found it. Day one, round 1: 47 good tests failed.
// Rank the failures by shared ROOT, not by name, and fix the top root.
interface Failure {
  root: string;
  blocked: number;
}
// The real day-one table, from docs/NOTEBOOK.md (2026-10-15):
const round1: Failure[] = [
  { root: "append_after underscore (u1 vs u_1)", blocked: 46 },
  { root: "other", blocked: 1 },
];
const round2: Failure[] = [
  { root: "outParam not stripped in recursor locals", blocked: 10 },
  { root: "resource limits (stack, memory, time)", blocked: 4 },
];

function top(fs: Failure[]): string {
  const best = [...fs].sort((a, b) => b.blocked - a.blocked)[0];
  return best === undefined ? "none" : `${best.root} (blocks ${best.blocked})`;
}

console.log(`round 1 fix : ${top(round1)}`);
console.log(`round 2 fix : ${top(round2)}`);

// To break it: sort round2 by root name instead of blocked count, the
// way an alphabetized issue tracker would. The resource limits come
// first, a week disappears into stack tuning, and ten tests that one
// line would fix stay red. Rank by what each failure BLOCKS, and rank
// again after every fix, because the ranking moves.
