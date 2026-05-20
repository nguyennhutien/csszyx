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

## Dependency Pins

Native build tooling is pinned instead of ranged:

| Dependency      | Pin       | Where                                                       | Reason                                                                         |
| --------------- | --------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `@napi-rs/cli`  | `3.6.2`   | `packages/core/package.json`                                | Current stable CLI used only by core build/release tasks.                      |
| `napi`          | `3.9.0`   | `packages/core/Cargo.toml` optional `native` feature        | N-API binding crate; not compiled by default WASM builds.                      |
| `napi-derive`   | `3.5.6`   | `packages/core/Cargo.toml` optional `native` feature        | Procedural macros for future native exports.                                   |
| `oxc_ast`       | `0.131.0` | `packages/core/Cargo.toml` optional `native-engine` feature | AST node types used only inside the parser lowering module.                    |
| `oxc_ast_visit` | `0.131.0` | `packages/core/Cargo.toml` optional `native-engine` feature | Visitor traversal for lowering JSX attributes into csszyx IR.                  |
| `oxc_parser`    | `0.131.0` | `packages/core/Cargo.toml` optional `native-engine` feature | Rust parser for the full transform engine; requires rustc 1.93.                |
| `oxc_semantic`  | `0.131.0` | `packages/core/Cargo.toml` optional `native-engine` feature | Binding/scope analysis for the future semantic path; pinned with `oxc_parser`. |
| `oxc_span`      | `0.131.0` | `packages/core/Cargo.toml` optional `native-engine` feature | Source-type and span helpers used by the parser facade.                        |
| `rayon`         | `1.12.0`  | `packages/core/Cargo.toml` optional `native-engine` feature | Batch parallelism for native transforms.                                       |
| `string_wizard` | `0.0.27`  | `packages/core/Cargo.toml` optional `native-engine` feature | Future span overwrite engine; still under exact review before default use.     |

The N-API dependencies are behind `features.native`, while parser/rewrite
dependencies are behind `features.native-engine`; default `cargo test` and the
existing WASM build path must remain independent from both. CI should check both:

```bash
cargo test --manifest-path packages/core/Cargo.toml
cargo check --manifest-path packages/core/Cargo.toml --features native
cargo check --manifest-path packages/core/Cargo.toml --features native,native-engine
cargo clippy --manifest-path packages/core/Cargo.toml --all-targets --features native,native-engine -- -D warnings
```

Or run the package script:

```bash
pnpm --filter @csszyx/core native:check
```

Do not use `cargo test --features native` as a local gate unless it runs inside
a Node addon harness. The napi crate references Node-provided symbols that are
not available when Cargo links a standalone Rust test binary.
For the same reason, CI must not use `cargo test --all-features`; run default
Cargo tests, native-engine parser tests, and `native:check`/`check-native.mjs`
instead.

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

The platform package directories are scaffolded under `packages/core-*`, but
they are excluded from `pnpm-workspace.yaml` until the native publish matrix is
ready. This avoids unsupported-platform warnings on every local pnpm command
while keeping the metadata contract reviewable.

While the packages stay private/excluded, `@csszyx/core` must not list them in
`optionalDependencies`. `pnpm --filter @csszyx/core native:packages` fails this
half-wired state so local builds cannot accidentally produce a package that
asks npm/pnpm to resolve unpublished native packages.

The loader, package, build, and smoke scripts read platform metadata from
`packages/core/native/platforms.js`. Update that manifest first when adding a
platform; `pnpm --filter @csszyx/core native:packages` validates every package
directory against it.

To build the current host package locally:

```bash
pnpm --filter @csszyx/core native:build -- --clean
```

The script writes `csszyx-core.<platform>.node` into the matching
`packages/core-*` directory and removes generated `.d.ts` noise from the
platform package. Generated `.node` files are gitignored.

To build and load-test the current host package through `@csszyx/core/native`:

```bash
pnpm --filter @csszyx/core native:smoke
```

The smoke command asserts that the generated addon exports `transformBatch()`,
that the call reaches the Rust scaffold not-implemented error, and that
generated `.node`/`.d.ts` artifacts are removed before the command exits.

To build and load-test the current host package with the internal native engine
feature:

```bash
pnpm --filter @csszyx/core native:engine:smoke
```

This command builds with `features.native,native-engine`, calls
`transformBatch()` through the real N-API addon, verifies static rewrite output,
and removes generated `.node`/`.d.ts` artifacts before exiting. The normal
`native:smoke` command intentionally keeps validating the native-only scaffold.

Current native-engine rewrite coverage is still opt-in, but now covers the main
static and runtime fallback paths:

- Static `sz={{ ... }}`, `sz="..."`, and fully static `sz={[...]}` inputs can
  rewrite to `className`.
- Static string `class`/`className` attributes merge with static `sz` on the
  same JSX opening element.
- Dynamic `sz` attributes emit `_sz(original)` runtime fallback output instead
  of diagnostics for common identifier/call/object/array/ternary shapes.
- Existing static or dynamic `class`/`className` values merge with static or
  runtime-fallback `sz` output through `_szMerge(...)` when needed.
- Static `szRecover="csr"` / `"dev-only"` emits a deterministic
  `data-sz-recovery-token` and recovery token metadata; dynamic or unknown
  values emit diagnostics and skip token emission.
- Traversal enforces the 50k-node AST budget and leaves oversized files
  unchanged with `metadata.ast_budget_exceeded = true`.

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
  ir.rs               # parser-neutral typed transform IR
  lower.rs            # ordered static IR to class-list lowering
  generated/tables.rs # generated lookup tables from transform-core.ts
  fast_path.rs        # AST-free static sz path
  parser.rs           # oxc_parser path
  semantic.rs         # oxc_semantic path
  rewrite.rs          # span replacement/string mutation
```

The napi bridge lives separately:

```text
packages/core/src/native.rs # #[napi] entrypoints, feature-gated by native
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
