#!/bin/sh
# Runs INSIDE the image build (Dockerfile stage `test`), not on a Jenkins agent.
#
# Deliberately never fails: the `test-results` target has to export a JUnit report even
# for a red suite, otherwise Jenkins has nothing to publish and the build log is the only
# record of what broke. The verdict is written to $OUT/exit-code, and the Dockerfile's
# `verified` stage is what refuses to build an image from it.
set -u

OUT="${1:-/out}"
mkdir -p "${OUT}"
status=0

# The typecheck has no JUnit output; a failure still turns the verdict red and shows up in the
# build log.
echo "== typecheck (server, client)"
if ! npm run typecheck; then
    status=1
fi

echo "== vitest"
if ! npx vitest run \
    --reporter=default \
    --reporter=junit --outputFile.junit="${OUT}/unit.junit.xml"; then
    status=1
fi

printf '%s\n' "${status}" > "${OUT}/exit-code"
echo "== Result: ${status} (0 = all green)"
exit 0
