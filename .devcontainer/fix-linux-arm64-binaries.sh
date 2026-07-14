#!/usr/bin/env bash
# fix-linux-arm64-binaries.sh
# Installs missing linux-arm64 native binaries after pnpm install on macOS-created lockfiles.
# Safe to run multiple times (skips already-installed binaries).

set -euo pipefail

# Only run on linux/arm64
if [[ "$(uname -s)" != "Linux" ]] || [[ "$(uname -m)" != "aarch64" ]]; then
    exit 0
fi

WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PNPM_STORE="$WORKSPACE_ROOT/node_modules/.pnpm"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

log() { echo "[fix-linux-arm64] $*"; }

# ── Helper: download + extract npm package to a temp dir ──────────────────────
# Each download lives in its OWN subdir so `ls *.tgz` always sees exactly one
# tarball — the just-downloaded one. The earlier version used `ls TMPDIR/*.tgz
# | tail -1`, which after the first download picked whichever tarball sorted
# last alphabetically, then `mv`'d that over the expected filename. Result: a
# corrupted extract from the wrong package. Isolating downloads sidesteps the
# whole rename problem (npm pack strips `@scope/` from output filenames, so we
# still rename, but now we only see one candidate per call).
extract_npm_pack() {
    local pkg="$1" ver="$2" dest="$3"
    local tgz="$TMPDIR/${pkg//\//-}-${ver}.tgz"
    if [[ ! -f "$tgz" ]]; then
        log "Downloading ${pkg}@${ver}..."
        local subdir
        subdir="$(mktemp -d -p "$TMPDIR" "dl-XXXXXX")"
        npm pack "${pkg}@${ver}" --pack-destination "$subdir" --quiet 2>/dev/null || \
        npm pack "${pkg}@${ver}" --pack-destination "$subdir" 2>&1 | grep -v "^npm notice" || true
        local downloaded
        downloaded="$({ ls "$subdir"/*.tgz 2>/dev/null || true; } | head -1)"
        if [[ -n "$downloaded" ]]; then
            mv "$downloaded" "$tgz"
        fi
        rmdir "$subdir" 2>/dev/null || true
    fi
    mkdir -p "$dest"
    tar -xzf "$tgz" -C "$dest" --strip-components=1
}

# ── 1. esbuild — one linux-arm64 package per version ──────────────────────────
# Modern pnpm lockfile lists packages as `  esbuild@X.Y.Z:` (no leading
# slash). Older format used `/esbuild@…`; the legacy pattern silently
# returned zero matches after the lockfile upgrade. Wrapping each grep
# in `{ … || true; }` keeps `set -euo pipefail` from killing the whole
# script when a package isn't in the lockfile.
ESBUILD_VERSIONS=$({ grep -oP '(?<=^  esbuild@)[0-9]+\.[0-9]+\.[0-9]+' "$WORKSPACE_ROOT/pnpm-lock.yaml" || true; } | sort -u)

for VER in $ESBUILD_VERSIONS; do
    LINUX_PKG_DIR="$PNPM_STORE/@esbuild+linux-arm64@${VER}/node_modules/@esbuild/linux-arm64"
    LINK_DIR="$PNPM_STORE/esbuild@${VER}/node_modules/esbuild/node_modules/@esbuild"

    if [[ -f "$LINUX_PKG_DIR/bin/esbuild" ]]; then
        log "esbuild@${VER} linux-arm64 already installed — skip"
    else
        extract_npm_pack "@esbuild/linux-arm64" "$VER" "$LINUX_PKG_DIR"
        chmod +x "$LINUX_PKG_DIR/bin/esbuild"
        log "esbuild@${VER} linux-arm64 installed"
    fi

    # Ensure symlink exists regardless (pnpm install may recreate esbuild dirs)
    if [[ -d "$PNPM_STORE/esbuild@${VER}" ]]; then
        mkdir -p "$LINK_DIR"
        ln -sfn "$LINUX_PKG_DIR" "$LINK_DIR/linux-arm64"
    fi
done

# ── 2. lightningcss — copies .node file into the package dir ──────────────────
LIGHTNING_VER=$({ grep -oP '(?<=^  lightningcss@)[0-9]+\.[0-9]+\.[0-9]+' "$WORKSPACE_ROOT/pnpm-lock.yaml" || true; } | sort -u | head -1)
if [[ -n "$LIGHTNING_VER" ]]; then
    LIGHTNING_PKG="$PNPM_STORE/lightningcss@${LIGHTNING_VER}/node_modules/lightningcss"
    NODE_FILE="$LIGHTNING_PKG/lightningcss.linux-arm64-gnu.node"

    if [[ -f "$NODE_FILE" ]]; then
        log "lightningcss@${LIGHTNING_VER} linux-arm64-gnu .node already present — skip"
    else
        EXTRACT_DIR="$TMPDIR/lightningcss-linux-arm64-gnu"
        extract_npm_pack "lightningcss-linux-arm64-gnu" "$LIGHTNING_VER" "$EXTRACT_DIR"
        NODE_SRC=$(find "$EXTRACT_DIR" -name "*.node" | head -1)
        if [[ -n "$NODE_SRC" ]]; then
            cp "$NODE_SRC" "$NODE_FILE"
            log "lightningcss@${LIGHTNING_VER} linux-arm64-gnu installed"
        else
            log "WARNING: could not find .node file in lightningcss-linux-arm64-gnu@${LIGHTNING_VER}"
        fi
    fi
fi

# ── 3. @tailwindcss/oxide — copies .node file into the package dir ────────────
OXIDE_VER=$({ grep -oP "(?<=^  '@tailwindcss/oxide@)[0-9]+\.[0-9]+\.[0-9]+" "$WORKSPACE_ROOT/pnpm-lock.yaml" || true; } | sort -u | head -1)
if [[ -n "$OXIDE_VER" ]]; then
    OXIDE_PKG="$PNPM_STORE/@tailwindcss+oxide@${OXIDE_VER}/node_modules/@tailwindcss/oxide"
    NODE_FILE="$OXIDE_PKG/tailwindcss-oxide.linux-arm64-gnu.node"

    if [[ -f "$NODE_FILE" ]]; then
        log "tailwindcss/oxide@${OXIDE_VER} linux-arm64-gnu .node already present — skip"
    else
        EXTRACT_DIR="$TMPDIR/tailwindcss-oxide-linux-arm64-gnu"
        extract_npm_pack "@tailwindcss/oxide-linux-arm64-gnu" "$OXIDE_VER" "$EXTRACT_DIR"
        NODE_SRC=$(find "$EXTRACT_DIR" -name "*.node" | head -1)
        if [[ -n "$NODE_SRC" ]]; then
            cp "$NODE_SRC" "$NODE_FILE"
            log "tailwindcss/oxide@${OXIDE_VER} linux-arm64-gnu installed"
        else
            log "WARNING: could not find .node file in @tailwindcss/oxide-linux-arm64-gnu@${OXIDE_VER}"
        fi
    fi
fi

# ── 4. lefthook — top-level binary; macOS-built lockfile only links the
# darwin-arm64 optional dep, so the linux-arm64 sibling never reaches
# node_modules. The wrapper's `get-exe.js` calls
# `require.resolve('lefthook-linux-arm64/bin/lefthook')`, which Node
# walks up the parent dirs to find. A top-level
# `node_modules/lefthook-linux-arm64/` satisfies that lookup — no
# `.pnpm` symlink dance required because the package has no own deps. ──────────
LEFTHOOK_VER=$({ grep -oP '(?<=^  lefthook@)[0-9]+\.[0-9]+\.[0-9]+' "$WORKSPACE_ROOT/pnpm-lock.yaml" || true; } | sort -u | head -1)
if [[ -n "$LEFTHOOK_VER" ]]; then
    LEFTHOOK_DIR="$WORKSPACE_ROOT/node_modules/lefthook-linux-arm64"
    LEFTHOOK_BIN="$LEFTHOOK_DIR/bin/lefthook"

    if [[ -f "$LEFTHOOK_BIN" ]]; then
        log "lefthook-linux-arm64@${LEFTHOOK_VER} binary already present — skip"
    else
        extract_npm_pack "lefthook-linux-arm64" "$LEFTHOOK_VER" "$LEFTHOOK_DIR"
        if [[ -f "$LEFTHOOK_BIN" ]]; then
            chmod +x "$LEFTHOOK_BIN"
            log "lefthook-linux-arm64@${LEFTHOOK_VER} installed at ${LEFTHOOK_DIR}"
        else
            log "WARNING: lefthook-linux-arm64@${LEFTHOOK_VER} extracted but bin/lefthook missing"
        fi
    fi
fi

# ── 5. @biomejs/cli-linux-arm64 — native CLI binary inside the wrapper's
# .pnpm node_modules tree. pnpm strict mode requires the binding to sit
# next to the wrapper's own deps (unlike lefthook, whose top-level
# lookup walks Node's parent-dir resolver). Mirrors the esbuild section's
# package-dir placement but skips the symlink dance because the
# `@biomejs/biome` wrapper resolves the binding from its OWN
# `node_modules` directly. The binary lives at the package root (not in
# bin/), so the check + chmod target `$BIOME_DIR/biome`. ─────────────────────
BIOME_VER=$({ grep -oP "(?<=^  '@biomejs/biome@)[0-9]+\.[0-9]+\.[0-9]+" "$WORKSPACE_ROOT/pnpm-lock.yaml" || true; } | sort -u | head -1)
if [[ -n "$BIOME_VER" ]]; then
    BIOME_DIR="$PNPM_STORE/@biomejs+biome@${BIOME_VER}/node_modules/@biomejs/cli-linux-arm64"
    BIOME_BIN="$BIOME_DIR/biome"

    if [[ -f "$BIOME_BIN" ]]; then
        log "@biomejs/cli-linux-arm64@${BIOME_VER} binary already present — skip"
    else
        extract_npm_pack "@biomejs/cli-linux-arm64" "$BIOME_VER" "$BIOME_DIR"
        if [[ -f "$BIOME_BIN" ]]; then
            chmod +x "$BIOME_BIN"
            log "@biomejs/cli-linux-arm64@${BIOME_VER} installed at ${BIOME_DIR}"
        else
            log "WARNING: @biomejs/cli-linux-arm64@${BIOME_VER} extracted but biome binary missing"
        fi
    fi
fi

log "Done."
