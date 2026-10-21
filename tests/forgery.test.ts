/**
 * The forgery gate (book/ch14): every weakenable rule is demonstrated by
 * its negative space.
 *
 * For a soundness rule, the artifact in book/forgeries/<RULE>.ndjson is a
 * forgery: the normal kernel refuses it, and a kernel with exactly that
 * rule disabled accepts it. For WF-THM-PROP, a hygiene rule, the weakened
 * kernel also accepts, and the book explains why no proof of False follows.
 *
 * Artifacts come from the Lean Kernel Arena `bad/` suite
 * (https://arena.lean-lang.org/, Apache-2.0); see book/forgeries/README.md.
 */
import { describe, expect, test } from "bun:test";
import { checkFile } from "../src/main.ts";
import { weaken, restoreAllRules, type WeakenableRule } from "../src/kernel/weaken.ts";

interface Pair {
  rule: WeakenableRule;
  /** The KernelError code the normal kernel refuses with. */
  refusal: string;
  /**
   * tean refuses most forgeries twice over: once by the named rule, once
   * by the derive-and-compare net (it never trusts exported inductive
   * metadata). To show that the NAMED rule is load-bearing, the weakened
   * run must also trust the export, as the historical attacks assumed.
   */
  alsoWeaken: WeakenableRule[];
}

const PAIRS: Pair[] = [
  { rule: "WF-IND-POS", refusal: "inductive", alsoWeaken: ["WF-REC-DERIVE"] },
  { rule: "WF-IND-UNIV", refusal: "universe", alsoWeaken: ["WF-REC-DERIVE"] },
  { rule: "WF-REC-DERIVE", refusal: "exportMismatch", alsoWeaken: [] },
  { rule: "RED-K-GUARD", refusal: "typeMismatch", alsoWeaken: [] },
  { rule: "WF-THM-PROP", refusal: "typeMismatch", alsoWeaken: [] },
];

describe("forgery gate: each rule is defined by what it refuses", () => {
  for (const pair of PAIRS) {
    const artifact = `book/forgeries/${pair.rule}.ndjson`;

    test(`${pair.rule}: the normal kernel refuses ${artifact}`, async () => {
      restoreAllRules();
      const r = await checkFile(artifact, false);
      expect(r.failures.length).toBeGreaterThan(0);
      const f = r.failures[0]!.failure;
      expect(f.kind).toBe("refusal");
      if (f.kind === "refusal") expect(f.code).toBe(pair.refusal);
    });

    test(`${pair.rule}: a kernel without the rule accepts the same file`, async () => {
      weaken(pair.rule);
      for (const extra of pair.alsoWeaken) weaken(extra);
      try {
        const r = await checkFile(artifact, false);
        expect(r.failures).toEqual([]);
        expect(r.declsChecked).toBeGreaterThan(0);
      } finally {
        restoreAllRules();
      }
    });
  }
});
