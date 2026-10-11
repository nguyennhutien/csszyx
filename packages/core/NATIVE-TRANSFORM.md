# Native Transform Boundary

This document describes the package boundary of the Rust transform engine: how
it is built, shipped and loaded.

## Decision

There is one engine, written in Rust, shipped as two artifacts that produce the
same output: a native N-API addon and a wasm build. `@csszyx/core` stays the
umbrella package.

- Native binaries ship as optional platform packages named
  `@csszyx/core-<triple>` and load through `@csszyx/core/native`.
- The wasm build of the engine ships inside `@csszyx/core` as
  `@csszyx/core/parser-wasm`.
- `build.parser` accepts `"rust"` (native) and `"wasm"`; the default is
  `"rust"`. A default `rust` with no native package for the host degrades to the
  wasm build, which costs parse speed and nothing else. An explicit `rust` (in
  config or `CSSZYX_PARSER`) fails with `RustTransformUnavailableError`, naming
  the missing platform package.
- Browser and edge consumers keep using the small WASM build exported from `.`,
  which carries the encoder, token, checksum and mangle kernels and the
  object-level `transform_sz`, not the source engine.

Native code is never compiled during `pnpm install` or `npm install`.

## Dependency Pins

The versions live in `packages/core/Cargo.toml` (`napi`, `napi-derive`, the
`oxc_*` crates, `rayon`, `string_wizard`), with the exact resolution in
`Cargo.lock`, and in `packages/core/package.json` (`@napi-rs/cli`, pinned
exactly); read them there rather than from a copy here.

The N-API dependencies are behind `features.native`, while parser/rewrite
dependencies are behind `features.native-engine`. Default `cargo test` and the
small `.` WASM build must stay independent from both; the `./parser-wasm` build
is made with `native-engine` on. CI checks each:

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

The native transform lives behind a separate export:

```json
{
  "./native": {
    "types": "./native/index.d.ts",
    "node": "./native/index.js"
  }
}
```

Keeping native behind `./native` prevents existing WASM imports from changing
resolution behavior. The engine's wasm build has its own export,
`./parser-wasm`, which the compiler loads when the native addon is unavailable
or `parser: "wasm"` is chosen.

## Platform Packages

The optional platform packages are:

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

FreeBSD can be added after the main matrix is stable. On a host none of these
packages serves, a build on the default parser runs the engine's wasm build
instead; one that sets `parser: "rust"` fails with `RustTransformUnavailableError`.

The platform package directories live under `packages/core-*` and are included
in the workspace so release publish can ship them with `@csszyx/core`. This
means local pnpm commands print unsupported-platform warnings for the packages
that do not match the current host; those warnings are expected and non-fatal.

`@csszyx/core` lists every platform package in `optionalDependencies` with
`workspace:*`; pnpm rewrites those entries to the release version during
pack/publish. The root `pnpm.supportedArchitectures` setting includes all
native OS/CPU/libc combinations so pnpm can install and pack every optional
workspace package from one release checkout.

`pnpm --filter @csszyx/core native:packages` validates the workspace package
metadata and can be run with `-- --require-binaries` in the release job after
native artifacts are downloaded.

The same validator requires every platform package version to match
`@csszyx/core`. A release-please version bump must keep these manifests in sync
before publish wiring can proceed.

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

To build a specific release target:

```bash
pnpm --filter @csszyx/core native:build -- \
  --clean --native-engine --target x86_64-unknown-linux-gnu
```

Linux cross builds pass `--cross-compile` in the release matrix. The release
workflow builds all eight native packages as artifacts, downloads them in the
publish job, validates `--require-binaries`, then runs `pnpm -r publish`.

To build and load-test the current host package through `@csszyx/core/native`:

```bash
pnpm --filter @csszyx/core native:smoke
```

The smoke command asserts that the generated native-only addon exports
`transformBatch()`, that `@csszyx/core/native` resolves the host optional package
by package name, that the native-only build fails with the stable unavailable
contract, and that generated `.node`/`.d.ts` artifacts are removed before the
command exits.

To build and load-test the current host package with the internal native engine
feature:

```bash
pnpm --filter @csszyx/core native:engine:smoke
```

This command builds with `features.native,native-engine`, calls
`transformBatch()` through the real N-API addon resolved by package name,
verifies static rewrite output, and removes generated `.node`/`.d.ts` artifacts
before exiting. The normal `native:smoke` command intentionally keeps validating
the native-only unavailable contract.

The engine covers the static and runtime fallback paths:

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

```text
packages/core/src/
  lib.rs              # wasm exports; engine entry points behind `native-engine`
  native.rs           # #[napi] entry points, behind the `native` feature
  collision.rs  encoder.rs  mangle.rs  token.rs  transformer.rs
  migrate/            # the Rust side of `csszyx migrate` (`migrate` feature)
  transform/          # the engine (`native-engine` feature)
    engine.rs         # orchestration
    contract.rs       # serde/napi-safe request and result structs
    parser.rs         # oxc_parser path: AST to transform IR
    scope.rs          # binding/scope analysis
    fast_path.rs      # AST-free static sz path
    ir.rs             # parser-neutral transform IR
    lower.rs          # IR to class-list lowering
    rewrite.rs        # span replacement
    module_links.rs   # cross-module import/export links
    generated/        # tables generated from the TypeScript sources
```

The JS boundary should receive a compact result object and no AST. AST values
must not cross the napi boundary.

## Cache Boundary

The transform cache key carries the parser (`rust` or `wasm`) and a schema
version, so entries written by one artifact or one schema are never read by
another.
