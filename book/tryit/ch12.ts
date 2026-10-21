// Chapter 12 — The conventions.
// Two pieces of kernel behaviour that no published rule mentions, and
// that a derive-and-compare checker must reproduce exactly.
// Run from the repository root: bun book/tryit/ch12.ts

import { Name } from "../../src/kernel/name.ts";
import { Const, App, ExprKind, consumeTypeAnnotations, type Expr } from "../../src/kernel/expr.ts";

// ---------------------------------------------------------------------
// 1. Freshening a universe-level name
// ---------------------------------------------------------------------

// A universe-polymorphic recursor needs a FRESH level variable for its
// motive. "Fresh" means `u`, unless the declaration already binds `u`,
// in which case a counter is appended. The question a port must answer
// exactly: what string does appending produce?

const plausible = (base: string, i: number): string => `${base}${i}`;
const actual = Name.simple("u").appendAfter(1).toString();

console.log(`string concatenation : ${plausible("u", 1)}`);
console.log(`Name.appendAfter     : ${actual}`);
console.log(`the export says      : u_1  (PUnit.rec levelParams, in the bytes)`);

// The underscore is not cosmetic. The recursor is derived and compared
// against the exported one (chapter 9), and the motive's level variable
// appears in every level annotation of that type. One wrong character
// and every universe-polymorphic inductive type in the library is
// refused — a type error reported against the *library*, for a
// disagreement about a name.
console.log(`derived type matches : ${actual === "u_1"}`);

// ---------------------------------------------------------------------
// 2. Annotations on binder types
// ---------------------------------------------------------------------

// Elaboration-time markers (outParam, optParam, autoParam,
// semiOutParam) survive into the export, wrapped around binder types.
// They carry no meaning for the kernel, and recursor derivation must
// strip them before making locals — otherwise the derived recursor's
// binders differ from the exported one's, again by nothing that matters.
const nat: Expr = new Const(Name.simple("Nat"), []);
const wrapped: Expr = new App(new Const(Name.simple("outParam"), []), nat);

const show = (e: Expr): string =>
  e.kind === ExprKind.App ? `(${show(e.fn)} ${show(e.arg)})` : (e as Const).name.toString();

console.log(`\nbinder type as exported : ${show(wrapped)}`);
console.log(`after consumeTypeAnnotations : ${show(consumeTypeAnnotations(wrapped))}`);
console.log(`a bare type is unchanged     : ${show(consumeTypeAnnotations(nat))}`);

// To break it: neither of these is reachable from the published type
// theory, which specifies a recursor's type only up to the naming of
// its bound variables. Once an export writes those names down, the
// naming is part of the interface — and the only normative statement of
// it is the kernel's source. That is why this book's registry cites a
// symbol in the C++ for every rule, and why chapter 15 insists on an
// oracle the author did not write.
