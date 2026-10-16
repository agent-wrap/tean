/**
 * A zero-dependency typed result. The kernel throws internally, as the C++
 * kernel does; the boundary converts to this so callers switch on data,
 * not on instanceof chains. Decision record: docs/NOTEBOOK.md 2026-10-15,
 * "no Effect library".
 */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

export function err<E>(error: E): { readonly ok: false; readonly error: E } {
  return { ok: false, error };
}
