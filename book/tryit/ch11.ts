// Chapter 11 — The adversary.
// Run one forgery against the real checker, twice: with the rule, and
// without it. Run from the repository root: bun book/tryit/ch11.ts

import { checkFile } from "../../src/main.ts";
import { weaken, restoreAllRules } from "../../src/kernel/weaken.ts";

async function verdict(path: string): Promise<string> {
  const r = await checkFile(path, false);
  if (r.failures.length === 0) return `ACCEPTED (${r.declsChecked} declarations)`;
  const f = r.failures[0];
  if (f === undefined || f.failure.kind !== "refusal") return "CHECKER BUG";
  return `refused [${f.failure.code}] at ${f.decl}`;
}

// A negative inductive type — chapter 6's forbidden shape, as real
// export bytes from the arena's bad suite. Accepting the declaration is
// the whole breach: Cantor's construction then derives False from it.
const indNeg = "book/forgeries/WF-IND-POS.ndjson";
console.log(`positivity on : ${await verdict(indNeg)}`);
weaken("WF-IND-POS"); // the named rule...
weaken("WF-REC-DERIVE"); // ...and trust the export, as the attack assumes
console.log(`positivity off: ${await verdict(indNeg)}`);
restoreAllRules();

// A theorem whose type is not a proposition. Also refused — but dropping
// THIS rule yields no proof of False, and the book must say which is which.
const nonPropThm = "book/forgeries/WF-THM-PROP.ndjson";
console.log(`thm-prop on   : ${await verdict(nonPropThm)}`);
weaken("WF-THM-PROP");
console.log(`thm-prop off  : ${await verdict(nonPropThm)}`);
restoreAllRules();

// To break it: this file IS the controlled break. The uncontrolled
// version is a kernel that never had the rule, and no test that notices.
// Every soundness rule in the registry carries a forgery like the first
// one; every hygiene rule carries an explanation like the second. A rule
// with neither is a rule nobody has defined yet.
