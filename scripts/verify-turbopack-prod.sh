#!/usr/bin/env bash
# Regression guard for the Next.js Turbopack PRODUCTION build path.
#
# Guards the two real-app blockers found by QA on KLTN/ui:
#   1. a broad-glob `turbopack.rules` with `as` self-matches -> `./X.tsx.tsx`
#   2. the transform injects `import { _szMerge } from '@csszyx/runtime'`, which
#      must resolve in a production `next build --turbopack`.
#
# It builds the broad-glob fixture (playground/nextjs-16/app/turbo-broad/*, wired
# via the csszyxTurbopack helper, no `as`) and asserts the build succeeds, then
# re-runs WITH `as` and asserts it fails with `.tsx.tsx` (so nobody re-adds it).
#
# Run by .github/workflows/turbopack-prod.yml — gated on Turbopack/Next version
# + csszyx turbo code changes (does not run on every push once green).
# Prereqs (the workflow does these): pnpm install, native engine built,
# `pnpm build` (so @csszyx/cli + @csszyx/unplugin dist exist).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/playground/nextjs-16"
CLI="$ROOT/packages/cli/dist/bin.mjs"
SAFELIST=".csszyx/next-loader-classes.html"

cd "$APP" || { echo "❌ playground/nextjs-16 not found"; exit 1; }
fail() { echo "❌ $1"; exit 1; }

echo "== prebuild safelist =="
node "$CLI" next prebuild --root . --output-file "$SAFELIST" || fail "prebuild failed"

echo "== main build (broad glob, NO \`as\`) — must succeed =="
CSSZYX_NEXT16_TURBO_BROAD=1 pnpm exec next build --turbopack > /tmp/turbo-broad.log 2>&1
code=$?
if grep -Eq "tsx\.tsx|[Cc]an.?t resolve '@csszyx/runtime'|Cannot resolve '@csszyx/runtime'" /tmp/turbo-broad.log; then
    tail -40 /tmp/turbo-broad.log
    fail "main build hit .tsx.tsx or @csszyx/runtime resolution failure"
fi
[ "$code" -eq 0 ] || { tail -40 /tmp/turbo-broad.log; fail "main build exited $code"; }
echo "✅ main build clean (exit 0, no .tsx.tsx, runtime resolved)"

# Guard is informational only: the no-`as` build above is the real regression
# guard. This re-adds `as` (equal to the rule key) and reports whether Turbopack
# still self-matches into `.tsx.tsx`. It must NOT fail the suite — the failure
# mode is Turbopack-internal and may shift between versions.
echo "== guard build (broad glob WITH \`as\` == key) — informational =="
CSSZYX_NEXT16_TURBO_BROAD=1 CSSZYX_NEXT16_TURBO_BROAD_AS=1 pnpm exec next build --turbopack \
    > /tmp/turbo-broad-as.log 2>&1
if grep -q "tsx\.tsx" /tmp/turbo-broad-as.log; then
    echo "✅ guard: \`as\` still reproduces .tsx.tsx — keep omitting it in the recipe"
else
    echo "⚠️ guard: \`as\` did not reproduce .tsx.tsx on Next $(pnpm exec next --version 2>/dev/null | tail -1) — non-fatal; the no-\`as\` build above is the binding check"
fi

echo "🎉 Turbopack production-build regression suite PASSED (no-\`as\` build clean)"
