// Chapter 8 — The real input.
// From here on the exercises use the real checker, not a sketch.
// Run from the repository root: bun book/tryit/ch08.ts

import { ExportParser } from "../../src/export/parser.ts";
import { Checker, tryStep } from "../../src/checker.ts";

// Real lines in lean4export NDJSON format (version 3.1.0). Tables of
// names, levels, and expressions build up by index; a declaration line
// then refers into them. Index 0 is predeclared: the anonymous name,
// the level zero. These facts came from reading the bytes of a real
// export next to the format document — not from either one alone.
const file = [
  '{"meta":{"exporter":{"name":"lean4export","version":"3.1.0"},' +
    '"format":{"version":"3.1.0"},"lean":{"githash":"5045d005","version":"4.34.1"}}}',
  '{"in":1,"str":{"pre":0,"str":"Nat"}}', // name 1 = "Nat"
  '{"in":2,"str":{"pre":0,"str":"big"}}', // name 2 = "big"
  '{"il":1,"succ":0}', // level 1 = succ 0
  '{"ie":0,"sort":1}', // expr 0 = Sort 1, i.e. Type
  '{"axiom":{"name":1,"levelParams":[],"type":0,"isUnsafe":false}}', // axiom Nat : Type
  '{"ie":1,"const":{"name":1,"us":[]}}', // expr 1 = Nat
  // natVal is a STRING in the format: 2^128 does not fit a JSON number.
  '{"ie":2,"natVal":"340282366920938463463374607431768211456"}',
  '{"def":{"name":2,"levelParams":[],"type":1,"value":2,' +
    '"hints":"abbrev","safety":"safe","all":[2]}}', // def big : Nat := 2^128
  '{"axiom":{"name":2,"levelParams":[],"type":9,"isUnsafe":false}}', // two lies at once
];

const parser = new ExportParser();
const checker = new Checker();

for (const [i, line] of file.entries()) {
  const parsed = tryStep(() => parser.processLine(line));
  if (!parsed.ok) {
    const tag = parsed.error.kind === "refusal" ? parsed.error.code : "bug";
    console.log(`line ${String(i + 1).padStart(2)}: refused at parse (${tag})`);
    continue;
  }
  if (parsed.value === null) continue; // a table line, not a declaration
  const decl = parsed.value;
  const name = decl.kind === "inductive" ? "..." : decl.name.toString();
  const checked = tryStep(() => { checker.addDecl(decl); });
  const v = checked.ok
    ? "accepted"
    : `refused (${checked.error.kind === "refusal" ? checked.error.code : "bug"})`;
  console.log(`line ${String(i + 1).padStart(2)}: ${decl.kind} ${name} — ${v}`);
}

console.log(`declarations checked: ${checker.declsChecked}`);
console.log(`format version seen : ${parser.meta?.format.version ?? "none"}`);

// To break it: change natVal's value to a plain JSON number and watch
// precision silently die before the kernel ever sees the term — then
// put it back. The parser must read the bytes the exporter wrote, not
// the bytes a JavaScript number can hold. The last line already breaks
// on purpose: it reuses the name `big` AND cites expression index 9,
// which no line declared. The parser refuses it first (parse), and had
// it slipped through, the environment would refuse the duplicate name.
