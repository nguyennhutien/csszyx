#!/usr/bin/env bash
# Run the same CodeQL queries GitHub runs, before pushing rather than after.
#
# CodeQL is the one of the three reporting services whose findings a lint rule
# cannot stand in for. It compiles the tree into a relational database and asks
# reachability questions over it — "does untrusted input arrive at this sink
# through ANY path" — which is a different question from "does this text match".
# The repository has taken findings from it that no pattern would have caught.
#
# Licensing, because it decides whether this script may exist at all: the CodeQL
# CLI is free for an "Open Source Codebase", which its licence defines as one
# released under an OSI-approved licence, and the restriction on automated, CI
# and CD use carries the same exception. csszyx is public and MIT, so this is
# covered. A private repository without a GitHub Code Security licence is not —
# if this project ever stops being public, delete this script rather than
# quietly keep running it.
#
# The CLI is a large download and not a dependency of this repository, so the
# script asks for it rather than installing it, and says so loudly instead of
# skipping in silence.
#
# Usage:
#   bash scripts/codeql-local.sh            # analyse and print findings
#   CODEQL=/path/to/codeql bash scripts/…   # use a CLI that is not on PATH

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

CODEQL="${CODEQL:-codeql}"
DB_DIR="${CODEQL_DB_DIR:-target/codeql-db}"
RESULTS="${CODEQL_RESULTS:-target/codeql-results.sarif}"

if ! command -v "$CODEQL" >/dev/null 2>&1; then
    cat >&2 <<'MISSING'
[codeql-local] The CodeQL CLI is not on PATH, so nothing was analysed.

This is a real gap, not a pass: the queries did not run. Install the CLI from
https://github.com/github/codeql-cli-binaries/releases, put it on PATH (or set
CODEQL=/path/to/codeql), and run this again.

The workflow in .github/workflows/ runs the same queries on every pull request,
so skipping here costs a round trip, not coverage.
MISSING
    exit 2
fi

echo "[codeql-local] Building the database (a few minutes on a cold tree)..."
rm -rf "$DB_DIR"
# `--build-mode=none` is what the JavaScript/TypeScript extractor wants: there
# is nothing to compile, and pointing it at a build would analyse the emitted
# bundles rather than the sources they came from.
"$CODEQL" database create "$DB_DIR" \
    --language=javascript-typescript \
    --build-mode=none \
    --source-root=. \
    --overwrite

echo "[codeql-local] Running the security-and-quality suite..."
"$CODEQL" database analyze "$DB_DIR" \
    codeql/javascript-queries:codeql-suites/javascript-security-and-quality.qls \
    --format=sarif-latest \
    --output="$RESULTS" \
    --sarif-category=local

node -e '
const { readFileSync } = require("node:fs");
const sarif = JSON.parse(readFileSync(process.argv[1], "utf8"));
const results = sarif.runs.flatMap(run => run.results ?? []);
for (const result of results) {
    const where = result.locations?.[0]?.physicalLocation;
    console.log(`  ${where?.artifactLocation?.uri ?? "?"}:${where?.region?.startLine ?? "?"}  ${result.ruleId}`);
    console.log(`      ${result.message?.text ?? ""}`);
}
console.log(`\n[codeql-local] ${results.length} finding(s). Full SARIF: ${process.argv[1]}`);
process.exitCode = results.length > 0 ? 1 : 0;
' "$RESULTS"
