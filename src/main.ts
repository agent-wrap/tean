/**
 * CLI: check a lean4export NDJSON file.
 *
 *   bun run src/main.ts <file.ndjson> [--keep-going] [--quiet]
 *
 * Exit code 0: every declaration checked. Nonzero: a declaration failed.
 */
import { ExportParser } from "./export/parser.ts";
import { Checker, tryStep, type CheckFailure } from "./checker.ts";

interface Failure {
  decl: string;
  failure: CheckFailure;
}

export interface CheckResult {
  declsChecked: number;
  failures: Failure[];
  elapsedMs: number;
}

export async function checkFile(path: string, keepGoing: boolean): Promise<CheckResult> {
  const start = performance.now();
  // node:fs keeps this file runnable under both Bun and Node. Node gets a
  // far larger stack via --stack-size, which the deep tests need.
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(path, "utf8");
  const parser = new ExportParser();
  const checker = new Checker();
  const failures: Failure[] = [];
  let lineNo = 0;
  for (const line of text.split("\n")) {
    lineNo++;
    const parsed = tryStep(() => parser.processLine(line));
    if (!parsed.ok) {
      failures.push({ decl: `<line ${lineNo}>`, failure: parsed.error });
      if (!keepGoing) break;
      continue;
    }
    const decl = parsed.value;
    if (decl === null) continue;
    const declName =
      decl.kind === "inductive" ? decl.types.map((t) => t.name.toString()).join(",") : decl.name.toString();
    const checked = tryStep(() => { checker.addDecl(decl); });
    if (!checked.ok) {
      failures.push({ decl: declName, failure: checked.error });
      if (!keepGoing) break;
    }
  }
  return { declsChecked: checker.declsChecked, failures, elapsedMs: performance.now() - start };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const keepGoing = args.includes("--keep-going");
  const quiet = args.includes("--quiet");
  const files = args.filter((a) => !a.startsWith("--"));
  const file = files[0];
  if (files.length !== 1 || file === undefined) {
    console.error("usage: bun run src/main.ts <file.ndjson> [--keep-going] [--quiet]");
    process.exit(2);
  }
  const result = await checkFile(file, keepGoing);
  if (!quiet) {
    console.log(`checked ${result.declsChecked} declarations in ${result.elapsedMs.toFixed(0)} ms`);
  }
  if (result.failures.length > 0) {
    for (const f of result.failures) {
      const tag = f.failure.kind === "refusal" ? f.failure.code : "BUG";
      console.error(`FAIL [${tag}] ${f.decl}: ${f.failure.message}`);
    }
    // Arena convention: 1 = proof rejected, >2 = a bug in the checker.
    process.exit(result.failures.every((f) => f.failure.kind === "refusal") ? 1 : 3);
  }
}

// import.meta.main works in both Bun and Node 24+.
if (import.meta.main) {
  await main();
}
