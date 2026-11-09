#!/bin/bash
# Compiles until the job's time budget runs out, then reports whether the build finished.
set -uo pipefail

cd src
echo "remaining before this stage: $(ninja -C out/Release -n chrome chrome_sandbox | tail -1)"
started=$SECONDS
timeout --signal=INT "$COMPILE_SECONDS" ninja -C out/Release -k 0 chrome chrome_sandbox 2>&1 | grep -E --line-buffered "^\[[0-9]+0000/|FAILED|error:|ninja: " | cut -c1-200
status=${PIPESTATUS[0]}
echo "compiled for $((SECONDS - started)) seconds, ninja status $status"
free -h | head -2
df -h /
du -sh out/Release

left=$(ninja -C out/Release -n chrome chrome_sandbox | tail -1)
echo "remaining after this stage: $left"
{
  echo "### Stage result"
  echo "Compiled for $(((SECONDS - started) / 60)) minutes. Remaining: \`$left\`"
} >> "$GITHUB_STEP_SUMMARY"

if [ "$status" -eq 0 ]; then
  echo "done=true" >> "$GITHUB_OUTPUT"
elif [ "$status" -eq 124 ] || [ "$status" -eq 130 ]; then
  echo "done=false" >> "$GITHUB_OUTPUT"
else
  echo "the compile failed rather than running out of time"
  exit "$status"
fi
