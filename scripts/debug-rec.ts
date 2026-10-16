/** Debug: show the derived vs exported recursor for the first mismatch. */
import { ExportParser } from "../src/export/parser";
import { Checker } from "../src/checker";
import { exprToString, exprEq } from "../src/kernel/expr";
import { Environment } from "../src/kernel/env";
import { addInductive } from "../src/kernel/inductive";

const path = process.argv[2]!;
const target = process.argv[3]!;
const text = await Bun.file(path).text();
const parser = new ExportParser();
const checker = new Checker();
for (const line of text.split("\n")) {
  const decl = parser.processLine(line);
  if (decl === null) continue;
  if (decl.kind === "inductive" && decl.types.some((t) => t.name.toString() === target)) {
    const env: Environment = checker.env;
    const ctorByName = new Map(decl.ctors.map((c) => [c.name.id, c]));
    addInductive(env, {
      lparams: decl.types[0]!.levelParams,
      nparams: decl.types[0]!.numParams,
      isUnsafe: decl.types.some((t) => t.isUnsafe),
      types: decl.types.map((t) => ({
        name: t.name,
        type: t.type,
        ctors: t.ctors.map((cn) => ({ name: cn, type: ctorByName.get(cn.id)!.type })),
      })),
    });
    for (const r of decl.recs) {
      const got = env.get(r.name);
      if (got.kind !== "rec") {
        console.log("derived is not a rec:", r.name.toString());
        continue;
      }
      console.log("rec:", r.name.toString());
      console.log("  lparams exp:", r.levelParams.map(String).join(","), " got:", got.cv.lparams.map(String).join(","));
      console.log("  type eq:", exprEq(r.type, got.cv.type));
      if (!exprEq(r.type, got.cv.type)) {
        console.log("  exp type:", exprToString(r.type));
        console.log("  got type:", exprToString(got.cv.type));
      }
      console.log("  nums exp:", r.numParams, r.numIndices, r.numMotives, r.numMinors, r.k);
      console.log("  nums got:", got.numParams, got.numIndices, got.numMotives, got.numMinors, got.k);
      for (let i = 0; i < Math.max(r.rules.length, got.rules.length); i++) {
        const er = r.rules[i];
        const gr = got.rules[i];
        if (er === undefined || gr === undefined) {
          console.log(`  rule ${i}: missing on one side`);
          continue;
        }
        const eq = exprEq(er.rhs, gr.rhs);
        console.log(`  rule ${i}: ctor ${er.ctor}/${gr.ctor} nfields ${er.nfields}/${gr.nfields} rhsEq ${eq}`);
        if (!eq) {
          console.log("    exp rhs:", exprToString(er.rhs));
          console.log("    got rhs:", exprToString(gr.rhs));
        }
      }
    }
    break;
  }
  checker.addDecl(decl);
}
