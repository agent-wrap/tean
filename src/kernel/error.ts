/**
 * The kernel's one error channel. A refusal always carries a code, so the
 * boundary can map errors to arena exit codes without instanceof chains,
 * and tests can assert WHICH check refused, not just that one did.
 */
export type KernelErrorCode =
  | "alreadyDeclared" // a name collides with the environment
  | "unknownConstant" // a reference to a constant that does not exist
  | "unknownFVar" // a free variable without a local declaration
  | "looseBVar" // a loose bound variable reached the type checker
  | "typeExpected" // a sort was needed and did not appear
  | "functionExpected" // a Pi was needed and did not appear
  | "typeMismatch" // is_def_eq refused a required equality
  | "thmNotProp" // a theorem's type is not a proposition
  | "universe" // a universe-parameter problem
  | "unsafe" // a safe declaration reached unsafe or partial code
  | "invalidProjection" // the proj typing rules refused
  | "natLimit" // the kernel's Nat size bounds refused
  | "inductive" // the inductive declaration checks refused
  | "recursor" // recursor shape, derivation, or reduction refused
  | "quot" // the quotient module checks refused
  | "exportMismatch" // exported metadata disagrees with the derived one
  | "unreachable"; // an internal invariant broke (a checker bug)

export class KernelError extends Error {
  readonly code: KernelErrorCode;

  constructor(code: KernelErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
