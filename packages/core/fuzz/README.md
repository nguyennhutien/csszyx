# Fuzzing the native transform engine

`cargo-fuzz` targets for `csszyx-core`, wired into [ClusterFuzzLite] (OSS-Fuzz's
CI-runnable fuzzing) via [`.clusterfuzzlite/`](../../../.clusterfuzzlite) and the
`cflite_*` GitHub Actions workflows.

## Targets

| Target | Entry point | What it guards |
| --- | --- | --- |
| `transform` | `transform_batch(&[TransformFile])` | the build-time parser/lowering must never panic on hostile or malformed source (a bundler-process DoS). |

The deterministic [`parser_panic_fuzz`](../tests/parser_panic_fuzz.rs) test covers
the same entry point in normal CI; this harness lets a coverage-guided fuzzer
explore far deeper.

## Run locally

Requires a nightly toolchain (libFuzzer needs `-Z` flags):

```bash
cargo install cargo-fuzz          # once
cd packages/core
cargo +nightly fuzz run transform # fuzz until a crash, or Ctrl-C
```

Reproduce a crash file:

```bash
cargo +nightly fuzz run transform fuzz/artifacts/transform/crash-<hash>
```

## In CI

- `cflite_pr` — fuzzes changed code for 5 min on every PR touching `packages/core`.
- `cflite_build` — uploads the main-branch build as the PR crash baseline.
- `cflite_batch` — a longer daily run.

[ClusterFuzzLite]: https://google.github.io/clusterfuzzlite/
