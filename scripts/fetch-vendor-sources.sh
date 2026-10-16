#!/usr/bin/env bash
# Fetch the raw sources that book/rules.json cites, pinned to the exact
# revisions the citations were verified against. vendor/ is gitignored;
# CI runs this before scripts/book-gates.ts. Local checkouts that already
# have the files are left untouched.
set -euo pipefail
cd "$(dirname "$0")/.."

LEAN_HASH=5045d0056413266e57c625dcd7c365b10e377c52
LEAN_RAW="https://raw.githubusercontent.com/leanprover/lean4/${LEAN_HASH}/src/kernel"
THESIS_TAR="https://codeload.github.com/digama0/lean-type-theory/tar.gz/refs/heads/master"

mkdir -p vendor/lean-type-theory

for f in type_checker.cpp level.cpp inductive.cpp inductive.h environment.cpp quot.cpp; do
  out="vendor/lean4-${f}"
  if [ ! -f "$out" ]; then
    echo "fetch ${out}"
    curl -sfL -o "$out" "${LEAN_RAW}/${f}"
  fi
done

if [ ! -f vendor/lean-type-theory/axioms.tex ]; then
  echo "fetch thesis sources"
  tmp="$(mktemp -d)"
  curl -sfL -o "${tmp}/ltt.tar.gz" "$THESIS_TAR"
  tar -xzf "${tmp}/ltt.tar.gz" -C "$tmp"
  cp "${tmp}"/lean-type-theory-*/*.tex vendor/lean-type-theory/
  rm -rf "$tmp"
fi

echo "vendor sources present"
