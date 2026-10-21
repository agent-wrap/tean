// Chapter 15 — The arena.
// The contract an outside judge holds a checker to: exit codes.
// 0 accept, 1 reject, 2 decline, anything else is a checker bug.

import { ExportParser } from "../../src/export/parser.ts";
import { Checker, tryStep, type CheckFailure } from "../../src/checker.ts";

function check(lines: string[]): { failures: CheckFailure[] } {
  const parser = new ExportParser();
  const checker = new Checker();
  const failures: CheckFailure[] = [];
  for (const line of lines) {
    const step = tryStep(() => {
      const d = parser.processLine(line);
      if (d !== null) checker.addDecl(d);
    });
    if (!step.ok) failures.push(step.error);
  }
  return { failures };
}

// The arena convention, as implemented at this checker's boundary:
function exitCode(failures: CheckFailure[]): number {
  if (failures.length === 0) return 0; // accept
  return failures.every((f) => f.kind === "refusal") ? 1 : 3; // reject | bug
}

const meta =
  '{"meta":{"exporter":{"name":"lean4export","version":"3.1.0"},' +
  '"format":{"version":"3.1.0"},"lean":{"githash":"5045d005","version":"4.34.1"}}}';

// A file the checker must accept: one honest axiom.
const good = [
  meta,
  '{"in":1,"str":{"pre":0,"str":"T"}}',
  '{"il":1,"succ":0}',
  '{"ie":0,"sort":1}',
  '{"axiom":{"name":1,"levelParams":[],"type":0,"isUnsafe":false}}',
];

// A file the checker must refuse: a theorem claiming to prove Type.
const bad = [
  meta,
  '{"in":1,"str":{"pre":0,"str":"oops"}}',
  '{"il":1,"succ":0}',
  '{"ie":0,"sort":1}',
  '{"thm":{"name":1,"levelParams":[],"type":0,"value":0,"all":[1]}}',
];

const g = check(good);
const b = check(bad);
console.log(`good file: exit ${exitCode(g.failures)}`);
const first = b.failures[0];
const code = first !== undefined && first.kind === "refusal" ? first.code : "?";
console.log(`bad file : exit ${exitCode(b.failures)} [${code}]`);

// The distinction the exit codes encode is the one chapter 13 paid for:
// a refusal (1) and a crash (3) must never be confused, in either
// direction. A checker that crashes on a forgery has not refused it.

// To break it: return 1 from exitCode unconditionally. Every bad test
// still "passes" — and so does every good test the checker actually
// failed on. An oracle can only see what the contract lets it see; the
// contract is therefore part of the kernel's trusted surface.
