#!/usr/bin/env bash
# Runs every tests/*.test.js file under JavaScriptCore (no Node.js dependency,
# consistent with the rest of this project) and syntax-checks every js/**/*.js
# file. Must be run from the repo root: bash tests/run-all.sh
set -u

JSC="/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc"
if [ ! -x "$JSC" ]; then
  # Linux CI runners won't have Apple's jsc; fall back to whatever `jsc` is on PATH.
  JSC="$(command -v jsc || true)"
fi
if [ -z "$JSC" ]; then
  echo "No JavaScriptCore 'jsc' binary found — install one or run this on macOS." >&2
  exit 1
fi

fail=0

echo "== Syntax-checking js/**/*.js =="
for f in $(find js -name '*.js' | sort); do
  out=$("$JSC" -f "$f" 2>&1)
  if echo "$out" | grep -qi "SyntaxError"; then
    echo "SYNTAX ERROR in $f:"
    echo "$out"
    fail=1
  fi
done
if [ "$fail" -eq 0 ]; then echo "OK"; fi

echo
echo "== Running tests/*.test.js =="
for f in tests/*.test.js; do
  echo "--- $f ---"
  "$JSC" "$f"
  if [ $? -ne 0 ]; then fail=1; fi
  echo
done

if [ "$fail" -ne 0 ]; then
  echo "FAILED"
  exit 1
fi
echo "ALL GREEN"
