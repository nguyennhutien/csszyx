#![no_main]
//! Fuzz the build-time transform over arbitrary source.
//!
//! `transform_batch` runs at build time on developer source. A panic there
//! (out-of-bounds index, an `.unwrap()` on a malformed-input path, runaway
//! recursion) would crash the bundler — a denial of service triggered by hostile
//! or simply malformed input. This target feeds libFuzzer-mutated bytes through
//! the parser/lowering and relies on the libFuzzer panic hook to flag any unwind.
//! The deterministic `parser_panic_fuzz` test covers the same entry point in CI.

use csszyx_core::transform::{transform_batch, TransformFile};
use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    // The transform consumes UTF-8 source; non-UTF-8 inputs are out of scope.
    if let Ok(source) = std::str::from_utf8(data) {
        let file = TransformFile {
            filename: "fuzz.tsx".to_string(),
            source: source.to_string(),
        };
        // Must return Ok/Err, never panic.
        let _ = transform_batch(&[file]);
    }
});
