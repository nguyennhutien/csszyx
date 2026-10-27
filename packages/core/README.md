# @csszyx/core

> Rust core for CSSzyx -- the native transform engine, encoder, checksum, collision detection, and recovery tokens.

The Rust core ships in two forms:

- **Native N-API addon** (per-platform `@csszyx/core-*` optional packages) —
  the default source-transform engine the build plugin uses since v0.9. The
  boundary is documented in [NATIVE-TRANSFORM.md](./NATIVE-TRANSFORM.md).
- **WebAssembly** — the same engine compiled to wasm for Node, used where no
  native binary installs and for the exports below.

`@csszyx/core` runs at build time, in Node. It has no browser or edge entry: a
bundler building for the browser fails to resolve it. In the browser,
`@csszyx/runtime` recomputes the mangle checksum with Web Crypto
(`verifyMangleChecksumAsync`), with no WebAssembly and no CSP exception.

## Installation

Install it beside `@csszyx/compiler`, which loads it:

```bash
pnpm add -D @csszyx/compiler @csszyx/core
```

Its exports are internal: they connect it to `@csszyx/compiler`, pinned to the
same version, and can change in any release (see the
[Public API](https://csszyx.com/docs/reference/public-api/) page). Call the
engine through `@csszyx/compiler/engine` (`transformSource` and the scans), and
check a mangle map in the browser with `verifyMangleChecksumAsync` from
`@csszyx/runtime`.

## What it contains

- **Mangle map integrity**: deterministic SHA-256 checksums that tie the
  server's class names to the ones hydration expects.
- **Transformer**: the lowering of an `sz` object to class strings, the one
  `@csszyx/compiler` runs.
- **Collision detector**: dual-hash names for CSS variables.

### Tiered Encoder

CSS-compliant class name generator using reversed tier encoding (z -> y -> x).

| Tier   | Range      | Format            | Example       |
| :----- | :--------- | :---------------- | :------------ |
| Tier 1 | 0 - 51     | \[z-aZ-A\]        | `z`, `y`, `x` |
| Tier 2 | 52 - 571   | \[z-aZ-A\]\[9-0\] | `z9`, `y8`    |
| Tier 3 | 572 - 3275 | \[z-aZ-A\]{2}     | `zz`, `zy`    |

## Performance

Benchmarks on Apple M2 (WASM, Node v20):

| Operation       | WASM (Rust) | Pure JS | Speedup |
| :-------------- | :---------- | :------ | :------ |
| Integrity Check | < 1ms       | ~15ms   | 15x     |
| ID Encoding     | ~5ns        | ~50ns   | 10x     |
| Token Auth      | ~25ns       | ~250ns  | 10x     |

## License

MIT
