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

/// Deeply nested brackets overflow the stack inside `oxc_parser`'s recursive
/// descent — a known limitation of the upstream parser, not a csszyx lowering
/// bug — so pathologically nested inputs only re-find that one upstream crash.
/// Skip them so the fuzzer keeps exploring csszyx's own code paths.
const MAX_NESTING_DEPTH: i32 = 256;

/// Maximum open-bracket nesting depth (`(`, `[`, `{`) reached anywhere in `source`.
fn max_bracket_depth(source: &str) -> i32 {
    let mut depth = 0;
    let mut max = 0;
    for byte in source.bytes() {
        match byte {
            b'(' | b'[' | b'{' => {
                depth += 1;
                max = max.max(depth);
            }
            b')' | b']' | b'}' => depth -= 1,
            _ => {}
        }
    }
    max
}

fuzz_target!(|data: &[u8]| {
    // The transform consumes UTF-8 source; non-UTF-8 inputs are out of scope.
    if let Ok(source) = std::str::from_utf8(data) {
        // Skip inputs whose nesting only overflows the upstream oxc parser (see
        // MAX_NESTING_DEPTH); they crash before csszyx's lowering ever runs.
        if max_bracket_depth(source) > MAX_NESTING_DEPTH {
            return;
        }
        let file = TransformFile {
            filename: "fuzz.tsx".to_string(),
            source: source.to_string(),
        };
        // Must return Ok/Err, never panic.
        let _ = transform_batch(&[file]);
    }
});
