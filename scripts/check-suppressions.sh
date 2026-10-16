#!/usr/bin/env bash
# Suppression policy (docs/NOTEBOOK.md 2026-10-16):
#   - zero suppressions in src/kernel/
#   - elsewhere, a suppression must carry a same-line reason after " -- "
set -u
fail=0

kernel_hits=$(grep -rnE '@ts-ignore|@ts-expect-error|eslint-disable' src/kernel 2>/dev/null || true)
if [ -n "$kernel_hits" ]; then
  echo "suppressions are forbidden in src/kernel:"
  echo "$kernel_hits"
  fail=1
fi

other_hits=$(grep -rnE '@ts-ignore|@ts-expect-error|eslint-disable' src tests scripts --include='*.ts' 2>/dev/null | grep -v '^src/kernel' || true)
if [ -n "$other_hits" ]; then
  bad=$(echo "$other_hits" | grep -vE ' -- ' || true)
  if [ -n "$bad" ]; then
    echo "suppressions outside src/kernel need a same-line ' -- reason':"
    echo "$bad"
    fail=1
  fi
fi

exit $fail
