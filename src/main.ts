/**
 * CLI: check a lean4export NDJSON file.
 *
 *   bun run src/main.ts <file.ndjson> [--keep-going] [--quiet]
 *
 * Exit code 0: every declaration checked. Nonzero: a declaration failed.
 */
import { ExportParser } from "./export/parser.ts";
import { Checker } from "./checker.ts";

interface Failure {
  decl: string;
  error: string;
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
    let decl;
    try {
      decl = parser.processLine(line);
    } catch (err) {
      failures.push({ decl: `<line ${lineNo}>`, error: err instanceof Error ? err.message : String(err) });
      if (!keepGoing) break;
      continue;
    }
    if (decl === null) continue;
    const declName =
      decl.kind === "inductive" ? decl.types.map((t) => t.name.toString()).join(",") : decl.name.toString();
    try {
      checker.addDecl(decl);
    } catch (err) {
      failures.push({ decl: declName, error: err instanceof Error ? err.message : String(err) });
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
  if (files.length !== 1) {
    console.error("usage: bun run src/main.ts <file.ndjson> [--keep-going] [--quiet]");
    process.exit(2);
  }
  const result = await checkFile(files[0]!, keepGoing);
  if (!quiet) {
    console.log(`checked ${result.declsChecked} declarations in ${result.elapsedMs.toFixed(0)} ms`);
  }
  if (result.failures.length > 0) {
    for (const f of result.failures) {
      console.error(`FAIL ${f.decl}: ${f.error}`);
    }
    process.exit(1);
  }
}

const isDirectRun = (): boolean => {
  if (typeof Bun !== "undefined") return import.meta.main;
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url.endsWith(entry.split("/").pop() ?? "");
};

if (isDirectRun()) {
  await main();
}
