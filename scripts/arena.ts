/**
 * Run the checker over the whole local arena test suite.
 *
 *   bun run scripts/arena.ts [--dir vendor] [--timeout 60] [--jobs 8] [--out report.json]
 *
 * Every test runs in its own process. The result reads the exit code and
 * stderr, not the clock: a crash and a timeout are different outcomes.
 */
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface TestResult {
  file: string;
  expected: "good" | "bad";
  outcome: "accepted" | "refused" | "crashed" | "timeout";
  ok: boolean;
  ms: number;
  note: string;
}

function collect(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ndjson")) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

async function runOne(file: string, expected: "good" | "bad", timeoutSec: number): Promise<TestResult> {
  const start = performance.now();
  // Node with a raised stack: reduction depth on real proofs exceeds the
  // fixed 8 MB stack that Bun gives (measured; see docs/NOTEBOOK.md).
  const mainPath = join(import.meta.dir, "..", "src", "main.ts");
  const proc = Bun.spawn(
    ["bash", "-c", `ulimit -s 65520; exec node --stack-size=60000 --max-old-space-size=49152 "${mainPath}" --quiet "${file}"`],
    {
      stdout: "pipe",
      stderr: "pipe",
      timeout: timeoutSec * 1000,
    },
  );
  const exitCode = await proc.exited;
  const ms = performance.now() - start;
  const stderr = await new Response(proc.stderr).text();
  let outcome: TestResult["outcome"];
  if (proc.signalCode !== null) {
    outcome = proc.signalCode === "SIGKILL" && ms >= timeoutSec * 1000 ? "timeout" : "crashed";
  } else if (exitCode === 0) {
    outcome = "accepted";
  } else if (exitCode === 1) {
    outcome = "refused";
  } else {
    outcome = "crashed";
  }
  const ok = expected === "good" ? outcome === "accepted" : outcome === "refused";
  const note = ok ? "" : stderr.trim().split("\n").slice(0, 2).join(" | ").slice(0, 300);
  return { file, expected, outcome, ok, ms, note };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const getFlag = (name: string, dflt: string): string => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : dflt;
  };
  const dir = getFlag("dir", "vendor");
  const timeoutSec = Number(getFlag("timeout", "60"));
  const jobs = Number(getFlag("jobs", "8"));
  const outPath = getFlag("out", "");
  // Comma-separated substrings of test paths to skip. Skips print, so a
  // bounded run never reads as full coverage.
  const exclude = getFlag("exclude", "").split(",").filter((s) => s !== "");

  let tasks: Array<{ file: string; expected: "good" | "bad" }> = [
    ...collect(join(dir, "good")).map((f) => ({ file: f, expected: "good" as const })),
    ...collect(join(dir, "bad")).map((f) => ({ file: f, expected: "bad" as const })),
  ];
  if (exclude.length > 0) {
    const skipped = tasks.filter((t) => exclude.some((x) => t.file.includes(x)));
    tasks = tasks.filter((t) => !exclude.some((x) => t.file.includes(x)));
    for (const s of skipped) console.log(`SKIP ${s.file} (excluded)`);
  }

  const results: TestResult[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      const t = tasks[i]!;
      const r = await runOne(t.file, t.expected, timeoutSec);
      results.push(r);
      const mark = r.ok ? "ok  " : "FAIL";
      console.log(`${mark} ${r.outcome.padEnd(8)} ${r.ms.toFixed(0).padStart(7)}ms ${r.file}${r.note ? "  :: " + r.note : ""}`);
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));

  results.sort((a, b) => (a.file < b.file ? -1 : 1));
  const pass = results.filter((r) => r.ok).length;
  const byExpected = (exp: "good" | "bad") => {
    const rs = results.filter((r) => r.expected === exp);
    return `${rs.filter((r) => r.ok).length}/${rs.length}`;
  };
  console.log(`\ntotal ${pass}/${results.length}  good ${byExpected("good")}  bad ${byExpected("bad")}`);
  for (const r of results.filter((x) => !x.ok)) {
    console.log(`  FAIL ${r.expected} ${r.outcome} ${r.file}${r.note ? "  :: " + r.note : ""}`);
  }
  if (outPath !== "") {
    writeFileSync(outPath, JSON.stringify({ date: new Date().toISOString(), results }, null, 2));
    console.log(`report written to ${outPath}`);
  }
  process.exit(pass === results.length ? 0 : 1);
}

await main();
