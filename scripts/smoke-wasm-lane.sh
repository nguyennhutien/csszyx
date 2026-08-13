#!/usr/bin/env bash
# Wasm-lane smoke: one real production build through each artifact of the
# native engine, and the CSS must come out byte-identical.
#
# Why this exists: the wasm build is the degrade path for machines without a
# @csszyx/core-<platform> binary, but almost nobody runs it in the field — the
# default lane is native, so "no bug reports" would mean "nobody exercised it",
# not "it works". This smoke removes the luck: every run here is a full
# vite+tailwind production build (mangling included) that went through the
# wasm parser end to end.
#
# The comparison is strict on purpose. Same engine, two compilations — any
# byte of CSS difference is a real divergence, and asset filenames embed
# content hashes so even the names must match.
#
# Assumes the workspace is built (dist/ + pkg-parser + native), which both
# callers guarantee: verify-like-ci runs it after its workspace build, and CI
# runs it after the unit-test job's builds.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

PG_FILTER="@csszyx/playground-vite-react"
PG_DIR="playground/vite-react"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

# $1 = lane name (also the CSSZYX_PARSER value), $2 = exact active-parser
# banner the build must print. An explicit CSSZYX_PARSER is fail-loud, and the
# banner assert catches the silent failure mode a typo'd env var would cause:
# falling back to the default lane and comparing rust against rust.
build_lane() {
    local lane="$1" banner="$2"
    rm -rf "$PG_DIR/dist"
    echo "[smoke-wasm-lane] building $PG_FILTER with CSSZYX_PARSER=$lane..."
    if ! CSSZYX_PARSER="$lane" pnpm --filter "$PG_FILTER" build >"$OUT/$lane.log" 2>&1; then
        echo "[smoke-wasm-lane] $lane build FAILED:" >&2
        tail -40 "$OUT/$lane.log" >&2
        exit 1
    fi
    if ! grep -qF "$banner" "$OUT/$lane.log"; then
        echo "[smoke-wasm-lane] $lane build did not print '$banner' — wrong lane ran?" >&2
        grep -F "active parser" "$OUT/$lane.log" >&2 || true
        exit 1
    fi
    mkdir -p "$OUT/$lane"
    cp "$PG_DIR"/dist/assets/*.css "$OUT/$lane/"
}

build_lane rust '[csszyx] active parser: rust (native engine)'
build_lane wasm '[csszyx] active parser: wasm (wasm build of the native engine)'

if diff -r "$OUT/rust" "$OUT/wasm" >"$OUT/css.diff" 2>&1; then
    echo "[smoke-wasm-lane] OK — CSS byte-identical across the native and wasm artifacts:"
    (cd "$OUT/rust" && ls -la ./*.css)
else
    echo "[smoke-wasm-lane] CSS DIVERGED between the native and wasm builds:" >&2
    cat "$OUT/css.diff" >&2
    exit 1
fi
