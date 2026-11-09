#!/bin/bash
# Compiles until the job's time budget runs out, then reports whether the build finished.
set -uo pipefail

steps_in() { sed -n 's/^\[[0-9]*\/\([0-9]*\)\].*/\1/p'; }

cd src
before=$(ninja -C out/Release -n $TARGETS | tail -1)
echo "remaining before this stage: $before"

# A restore that lost file dates would quietly restart the whole build.
if [ -f out/remaining-steps ]; then
  saved=$(cat out/remaining-steps)
  count=$(echo "$before" | steps_in)
  if [ "${count:-0}" -gt $((${saved:-0} + 500)) ]; then
    echo "the restored build lost its progress: $saved steps were left, now $count"
    exit 1
  fi
fi

started=$SECONDS
timeout --signal=INT --kill-after=180 "$COMPILE_SECONDS" ninja -C out/Release -k 0 $TARGETS 2>&1 |
  tee ../ninja.log |
  grep -E --line-buffered "^\[[0-9]+000/|^FAILED|^ninja: " |
  stdbuf -oL cut -c1-200
status=${PIPESTATUS[0]}
echo "compiled for $((SECONDS - started)) seconds, ninja status $status"
{ free -h 2>/dev/null || vm_stat; } | head -6
df -h .
du -sh out/Release

failures=$(grep -c '^FAILED' ../ninja.log)
if [ "$failures" -gt 0 ]; then
  echo "=== failed steps, with their output ==="
  grep -A25 '^FAILED' ../ninja.log | cut -c1-600 | head -600
fi

left=$(ninja -C out/Release -n $TARGETS | tail -1)
echo "remaining after this stage: $left"
echo "$left" | steps_in > out/remaining-steps
{
  echo "### Stage $STAGE result"
  echo "Compiled for $(((SECONDS - started) / 60)) minutes. Remaining: \`$left\`. Failed steps: $failures"
} >> "$GITHUB_STEP_SUMMARY"
echo "next=$((STAGE + 1))" >> "$GITHUB_OUTPUT"

if [ "$status" -eq 0 ]; then
  echo "done=true" >> "$GITHUB_OUTPUT"
elif [ "$status" -eq 124 ] || [ "$status" -eq 130 ] || [ "$status" -eq 137 ]; then
  echo "done=false" >> "$GITHUB_OUTPUT"
else
  echo "the compile failed rather than running out of time"
  exit "$status"
fi
