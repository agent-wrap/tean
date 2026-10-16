/**
 * CLI: check a lean4export NDJSON file.
 *
 *   bun run src/main.ts <file.ndjson> [--keep-going] [--quiet]
 *
 * Exit code 0: every declaration checked. Nonzero: a declaration failed.
 *
 * The file streams line by line: the real-world corpora (std is 569 MB)
 * exceed V8's maximum string length, so the whole-file read is not an
 * option (measured; see docs/NOTEBOOK.md 2026-10-16).
 */
import { ExportParser } from "./export/parser.ts";
import { Checker, tryStep, type CheckFailure } from "./checker.ts";
import type { ExpDecl } from "./export/parser.ts";

interface Failure {
  decl: string;
  failure: CheckFailure;
}

/** One root failure and how many later declarations it blocked. */
export interface RootEntry {
  root: string;
  code: string;
  blocked: number;
}

export interface CheckResult {
  declsChecked: number;
  failures: Failure[];
  elapsedMs: number;
  /** Failure roots ranked by blocked count (filled in keep-going mode). */
  rootRanking: RootEntry[];
}

/** Every name a declaration would have added to the environment. */
function declNamesOf(decl: ExpDecl): string[] {
  if (decl.kind === "inductive") {
    return [
      ...decl.types.map((t) => t.name.toString()),
      ...decl.ctors.map((c) => c.name.toString()),
      ...decl.recs.map((r) => r.name.toString()),
    ];
  }
  return [decl.name.toString()];
}

export async function checkFile(path: string, keepGoing: boolean): Promise<CheckResult> {
  const start = performance.now();
  const { createReadStream } = await import("node:fs");
  const { createInterface } = await import("node:readline");
  const parser = new ExportParser();
  const checker = new Checker();
  const failures: Failure[] = [];

  // Root attribution: a declaration that fails with `unknownConstant` on a
  // name that already failed is BLOCKED, not broken. Rank the roots by how
  // much each one blocks; the ranking, not the raw failure list, says what
  // to fix first.
  const rootOf = new Map<string, { root: string; code: string }>();
  const blockedCount = new Map<string, { code: string; blocked: number }>();
  const recordFailure = (decl: ExpDecl | null, declLabel: string, failure: CheckFailure): void => {
    failures.push({ decl: declLabel, failure });
    let root = declLabel;
    let code = failure.kind === "refusal" ? failure.code : "bug";
    if (failure.kind === "refusal" && failure.code === "unknownConstant") {
      const m = /unknown constant '([^']+)'/.exec(failure.message);
      const hit = m?.[1] !== undefined ? rootOf.get(m[1]) : undefined;
      if (hit !== undefined) {
        root = hit.root;
        code = hit.code;
      }
    }
    if (decl !== null) {
      for (const n of declNamesOf(decl)) rootOf.set(n, { root, code });
    }
    const entry = blockedCount.get(root);
    if (entry === undefined) blockedCount.set(root, { code, blocked: 1 });
    else entry.blocked++;
  };

  // TEAN_PROGRESS=1 prints a heartbeat so a corpus-scale stall shows its
  // location instead of looking like a hang.
  const progress = process.env["TEAN_PROGRESS"] === "1";
  const traceFromEnv = process.env["TEAN_TRACE_FROM"];
  const traceFrom = traceFromEnv !== undefined ? Number(traceFromEnv) : null;
  let lastDecl = "";
  const rl = createInterface({ input: createReadStream(path, "utf8"), crlfDelay: Infinity });
  let lineNo = 0;
  let stop = false;
  for await (const line of rl) {
    if (stop) continue; // drain the stream after a fatal failure
    lineNo++;
    if (progress && lineNo % 100000 === 0) {
      console.error(
        `..line ${lineNo}, ${checker.declsChecked} decls, ${((performance.now() - start) / 1000).toFixed(0)}s, last: ${lastDecl}`,
      );
    }
    const parsed = tryStep(() => parser.processLine(line));
    if (!parsed.ok) {
      recordFailure(null, `<line ${lineNo}>`, parsed.error);
      if (!keepGoing) stop = true;
      continue;
    }
    const decl = parsed.value;
    if (decl === null) continue;
    const declName =
      decl.kind === "inductive" ? decl.types.map((t) => t.name.toString()).join(",") : decl.name.toString();
    lastDecl = declName;
    // TEAN_TRACE_FROM=<line>: print each declaration BEFORE checking it,
    // so a hang names its declaration. An after-the-fact timer cannot: the
    // event loop is blocked while a declaration checks.
    if (traceFrom !== null && lineNo >= traceFrom) console.error(`..decl ${declName}`);
    const declStart = progress ? performance.now() : 0;
    const checked = tryStep(() => {
      checker.addDecl(decl);
    });
    if (progress) {
      const ms = performance.now() - declStart;
      if (ms > 1000) console.error(`..slow decl ${ms.toFixed(0)}ms: ${declName}`);
    }
    if (!checked.ok) {
      recordFailure(decl, declName, checked.error);
      if (!keepGoing) stop = true;
    }
  }

  const rootRanking: RootEntry[] = [...blockedCount.entries()]
    .map(([root, e]) => ({ root, code: e.code, blocked: e.blocked }))
    .sort((a, b) => b.blocked - a.blocked);
  return { declsChecked: checker.declsChecked, failures, elapsedMs: performance.now() - start, rootRanking };
}

async function main(args: string[]): Promise<void> {
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
    if (keepGoing) {
      // In keep-going mode the ranking is the useful output; the raw list
      // can hold thousands of blocked entries.
      console.error(`${result.failures.length} declarations failed. Roots by blocked count:`);
      for (const r of result.rootRanking.slice(0, 20)) {
        console.error(`  ${String(r.blocked).padStart(6)}  [${r.code}] ${r.root}`);
      }
      const firstReal = result.failures.find(
        (f) => !(f.failure.kind === "refusal" && f.failure.code === "unknownConstant"),
      );
      if (firstReal !== undefined) {
        console.error(`first non-blocked failure: ${firstReal.decl}: ${firstReal.failure.message.slice(0, 400)}`);
      }
    } else {
      for (const f of result.failures) {
        const tag = f.failure.kind === "refusal" ? f.failure.code : "BUG";
        console.error(`FAIL [${tag}] ${f.decl}: ${f.failure.message}`);
      }
    }
    // Arena convention: 1 = proof rejected, >2 = a bug in the checker.
    process.exit(result.failures.every((f) => f.failure.kind === "refusal") ? 1 : 3);
  }
}

/**
 * Worker mode. Reduction depth on real corpora exceeds any stack the main
 * thread can get (macOS caps `ulimit -s` at 64 MB; measured 639k frames).
 * A Node worker accepts `resourceLimits.stackSizeMb`: 2 GB gives 21.8M
 * frames (measured, docs/NOTEBOOK.md 2026-10-16). With TEAN_WORKER_STACK_MB
 * set, the process respawns itself as a worker with that stack.
 */
async function runMaybeInWorker(): Promise<void> {
  const wt = await import("node:worker_threads");
  if (!wt.isMainThread) {
    const data = wt.workerData as { argv?: string[] } | null;
    await main(data?.argv ?? []);
    return;
  }
  const stackMb = Number(process.env["TEAN_WORKER_STACK_MB"] ?? "0");
  const isBun = process.versions.bun !== undefined;
  if (stackMb > 0 && !isBun) {
    const heapMb = Number(process.env["TEAN_WORKER_HEAP_MB"] ?? "49152");
    const w = new wt.Worker(new URL(import.meta.url), {
      workerData: { argv: process.argv.slice(2) },
      resourceLimits: { stackSizeMb: stackMb, maxOldGenerationSizeMb: heapMb },
    });
    w.on("exit", (code) => process.exit(code));
    return;
  }
  await main(process.argv.slice(2));
}

// import.meta.main works in both Bun and Node 24+, and is false in a worker.
if (import.meta.main) {
  await runMaybeInWorker();
} else {
  const { isMainThread } = await import("node:worker_threads");
  if (!isMainThread) await runMaybeInWorker();
}
