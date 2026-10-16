#!/usr/bin/env bash
# Arena entry point. The test file arrives in $IN.
# Exit codes follow the arena convention: 0 accept, 1 reject, 2 decline,
# anything else a checker bug.
#
# The stack: reduction depth on real proofs exceeds the default 8 MB
# (measured, see docs/NOTEBOOK.md 2026-10-15), so raise the main-thread
# stack and tell V8 about it.
set -u
ulimit -s 65520 2>/dev/null || true
exec node --stack-size=60000 --max-old-space-size=16000 "$(dirname "$0")/src/main.ts" --quiet "${IN:-$1}"
