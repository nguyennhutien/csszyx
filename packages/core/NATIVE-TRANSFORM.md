# Native Transform Boundary

This document locks the package boundary for the future Rust transform core.
The transform implementation is intentionally not here yet; this file keeps the
native packaging contract explicit before adding `napi-rs`, `oxc_parser`, or
platform packages.

## Decision

`@csszyx/core` stays the umbrella package.

- Browser and edge consumers keep using the existing WASM build.
- Node build-time consumers may opt into a future native transform through
  `build.parser: "rust"`.
- Native binaries ship as optional platform packages named
  `@csszyx/core-<triple>`.
- The compiler/unplugin layer lazy-loads native code only when the Rust parser
  mode is selected.
- If a matching native package is unavailable, the Rust parser mode fails with a
  clear diagnostic and tells the user to choose `parser: "oxc"` or install a
  supported native package.

The initial native path must not compile Rust during `pnpm install` or npm
install. Source-build fallback can be revisited later, but it is not part of the
first native boundary because install-time compilation adds CI and user-machine
risk.

## Export Shape

The current public exports remain stable:

```json
{
  ".": {
    "types": "./pkg/csszyx_core.d.ts",
    "node": "./pkg-node/csszyx_core.js",
    "default": "./pkg/csszyx_core.js"
  }
}
```

The native transform lands behind a separate export in a later task:

```json
{
  "./native": {
    "types": "./native/index.d.ts",
    "node": "./native/index.js"
  }
}
```

Keeping native behind `./native` prevents existing WASM imports from changing
resolution behavior. The compiler package can probe `@csszyx/core/native` only
for `parser: "rust"`.

## Platform Packages

The planned optional package names are:

| Package                         | Triple                       |
| ------------------------------- | ---------------------------- |
| `@csszyx/core-linux-x64-gnu`    | `x86_64-unknown-linux-gnu`   |
| `@csszyx/core-linux-x64-musl`   | `x86_64-unknown-linux-musl`  |
| `@csszyx/core-linux-arm64-gnu`  | `aarch64-unknown-linux-gnu`  |
| `@csszyx/core-linux-arm64-musl` | `aarch64-unknown-linux-musl` |
| `@csszyx/core-darwin-x64`       | `x86_64-apple-darwin`        |
| `@csszyx/core-darwin-arm64`     | `aarch64-apple-darwin`       |
| `@csszyx/core-win32-x64-msvc`   | `x86_64-pc-windows-msvc`     |
| `@csszyx/core-win32-arm64-msvc` | `aarch64-pc-windows-msvc`    |

FreeBSD can be added after the main matrix is stable. WASM stays in the umbrella
package and is not a substitute for the Node native transform unless a separate
fallback mode is explicitly designed.

## Rust Source Layout

The existing crate keeps the shared Rust kernels:

```text
packages/core/src/
  collision.rs
  encoder.rs
  mangle.rs
  token.rs
  transformer.rs
```

Future transform code should use these internal boundaries:

```text
packages/core/src/transform/
  mod.rs              # orchestration and public Rust API
  contract.rs         # serde/napi-safe request and result structs
  fast_path.rs        # AST-free static sz path
  parser.rs           # oxc_parser path
  semantic.rs         # oxc_semantic path
  rewrite.rs          # span replacement/string mutation
```

The JS boundary should receive a compact result object and no AST. AST values
must not cross the napi boundary.

## Cache Boundary

Parser identity remains part of the JS cache key. The first native transform
should use the existing JS transform cache until the Rust cache design lands.

The future Rust cache can use an opaque binary format internally, but any cache
format change must be keyed by producer and schema version so Babel, JS oxc, and
Rust entries never collide.

## Deferred Decisions

- `string_wizard` vendoring vs. exact pinning remains deferred until the Rust
  rewrite module is added.
- mmap cache format remains deferred until the Rust cache task.
- SharedArrayBuffer worker transport remains deferred until the persistent
  worker task.
- Tailwind pre-bake output is out of scope for the first native transform.

## Non-Goals

- No default parser flip.
- No removal of Babel or JS oxc.
- No install-time Rust compilation.
- No native dependency added before a minimal loader and error contract exist.
