#!/usr/bin/env bash
# Arena entry point. The test file arrives in $IN.
# Exit codes follow the arena convention: 0 accept, 1 reject, 2 decline,
# anything else a checker bug.
#
# The stack: reduction depth on real corpora exceeds any main-thread stack
# (macOS caps ulimit -s at 64 MB; measured 639k frames). The checker
# respawns itself in a Node worker with a 2 GB stack, which measured
# 21.8M frames. See docs/NOTEBOOK.md 2026-10-16.
set -u
ulimit -s 65520 2>/dev/null || true
export TEAN_WORKER_STACK_MB="${TEAN_WORKER_STACK_MB:-2000}"
export TEAN_WORKER_HEAP_MB="${TEAN_WORKER_HEAP_MB:-16000}"
exec node --stack-size=60000 --max-old-space-size=16000 "$(dirname "$0")/src/main.ts" --quiet "${IN:-$1}"
