import { describe, expect, test } from "bun:test";
import { Name } from "../src/kernel/name.ts";
import {
  Level,
  levelZero,
  levelOne,
  mkSucc,
  mkSuccN,
  isEquivalent,
  isGeq,
  isNotZero,
  normalizesToZero,
} from "../src/kernel/level.ts";

const u = Level.param(Name.simple("u"));
const v = Level.param(Name.simple("v"));

describe("level equivalence", () => {
  test("max is commutative", () => {
    expect(isEquivalent(Level.maxRaw(u, v), Level.maxRaw(v, u))).toBe(true);
  });
  test("max is associative", () => {
    const w = Level.param(Name.simple("w"));
    expect(isEquivalent(Level.maxRaw(Level.maxRaw(u, v), w), Level.maxRaw(u, Level.maxRaw(v, w)))).toBe(true);
  });
  test("max is idempotent", () => {
    expect(isEquivalent(Level.maxRaw(u, u), u)).toBe(true);
  });
  test("max absorbs a smaller constant", () => {
    expect(isEquivalent(Level.maxRaw(mkSucc(u), levelOne), mkSucc(u))).toBe(true);
  });
  test("succ distributes over max", () => {
    expect(isEquivalent(mkSucc(Level.maxRaw(u, v)), Level.maxRaw(mkSucc(u), mkSucc(v)))).toBe(true);
  });
  test("imax u 0 is 0", () => {
    expect(isEquivalent(Level.imaxRaw(u, levelZero), levelZero)).toBe(true);
  });
  test("imax u (succ v) is max u (succ v)", () => {
    expect(isEquivalent(Level.imaxRaw(u, mkSucc(v)), Level.maxRaw(u, mkSucc(v)))).toBe(true);
  });
  test("imax 1 0 normalizes to zero", () => {
    expect(normalizesToZero(Level.imaxRaw(levelOne, levelZero))).toBe(true);
  });
  test("u and v are not equivalent", () => {
    expect(isEquivalent(u, v)).toBe(false);
  });
  test("u+1 and u are not equivalent", () => {
    expect(isEquivalent(mkSucc(u), u)).toBe(false);
  });
});

describe("level geq and zero tests", () => {
  test("max u v >= u", () => {
    expect(isGeq(Level.maxRaw(u, v), u)).toBe(true);
  });
  test("u >= max u v fails", () => {
    expect(isGeq(u, Level.maxRaw(u, v))).toBe(false);
  });
  test("succ of anything is not zero", () => {
    expect(isNotZero(mkSucc(u))).toBe(true);
  });
  test("a param can be zero", () => {
    expect(isNotZero(u)).toBe(false);
    expect(normalizesToZero(u)).toBe(false);
  });
  test("succ^3 zero geq succ^2 zero", () => {
    expect(isGeq(mkSuccN(levelZero, 3), mkSuccN(levelZero, 2))).toBe(true);
    expect(isGeq(mkSuccN(levelZero, 2), mkSuccN(levelZero, 3))).toBe(false);
  });
});
