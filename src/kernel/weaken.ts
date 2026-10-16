/**
 * Rule weakening for the book's forgery gate (book/ch11, tests/forgery.test.ts).
 *
 * Each flag disables exactly one named kernel rule, so that a test can
 * demonstrate what the rule refuses: for a soundness rule, a forgery export
 * that the weakened kernel accepts and the normal kernel refuses. The flags
 * exist for that negative-space demonstration only. Nothing in src/ sets
 * them; the arena entry point never touches them.
 */
export type WeakenableRule =
  | "WF-IND-POS" // strict positivity of constructor arguments
  | "WF-IND-UNIV" // universe bound on constructor arguments
  | "WF-REC-DERIVE" // recursors are derived and compared, never trusted
  | "WF-THM-PROP" // a theorem's type must be a proposition
  | "RED-K-GUARD"; // defeq guard before K-like reduction

const weakened = new Set<WeakenableRule>();

export function weaken(rule: WeakenableRule): void {
  weakened.add(rule);
}

export function restoreAllRules(): void {
  weakened.clear();
}

export function isWeakened(rule: WeakenableRule): boolean {
  return weakened.size !== 0 && weakened.has(rule);
}
