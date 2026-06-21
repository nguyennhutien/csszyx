//! Lowering-isolated micro-bench (NO serde boundary) — isolates the A-vs-B delta.
//!
//! Full-path `transform_sz` is serde-boundary-dominated (~15.7k hz ≈ 64µs/call;
//! pure-JS ≈ 946k hz), so the lowering is ~2% of the runtime cost and the A-vs-B
//! choice is invisible at the boundary. This bench removes the boundary to size
//! the difference directly:
//!   - **B (zero-copy)**: lower a pre-built object — no conversion allocation.
//!   - **A (convert+lower)**: `obj.clone()` (a faithful proxy for
//!     `convert_runtime_object`'s `Vec<StaticSzProperty>` + key/value allocation)
//!     then lower.
//!
//! The delta `A - B` is the conversion cost A pays and B avoids.
//!
//! Run: `cargo test --release --test lowering_microbench -- --ignored --nocapture`

// Nanosecond timings are averaged as f64 — precision loss is irrelevant for a bench.
#![allow(clippy::cast_precision_loss)]

use std::hint::black_box;
use std::time::Instant;

use csszyx_core::transform::lower::lower_static_sz_object;
use csszyx_core::transform::{StaticSzObject, StaticSzProperty, StaticSzValue, TextSpan};

fn prop(key: &str, value: StaticSzValue) -> StaticSzProperty {
    StaticSzProperty {
        key: key.to_string(),
        span: TextSpan { start: 0, end: 0 },
        value,
    }
}

/// A representative object: leaf numbers/strings, a single-property utility, a
/// CSS-var paren value, and a nested variant — the shapes the runtime sees.
fn sample() -> StaticSzObject {
    StaticSzObject {
        properties: vec![
            prop("p", StaticSzValue::Number(4.0)),
            prop("bg", StaticSzValue::String("blue-500".to_string())),
            prop("display", StaticSzValue::String("flex".to_string())),
            prop("mx", StaticSzValue::String("--space".to_string())),
            prop(
                "hover",
                StaticSzValue::Object(StaticSzObject {
                    properties: vec![
                        prop("bg", StaticSzValue::String("blue-600".to_string())),
                        prop("scale", StaticSzValue::Number(105.0)),
                    ],
                }),
            ),
        ],
    }
}

#[test]
#[ignore = "micro-bench; run with --release -- --ignored --nocapture"]
fn lowering_microbench() {
    let obj = sample();
    let iters: u32 = 2_000_000;

    for _ in 0..50_000 {
        black_box(lower_static_sz_object(black_box(&obj)));
    }

    // B: zero-copy — lower a pre-built object.
    let t = Instant::now();
    for _ in 0..iters {
        black_box(lower_static_sz_object(black_box(&obj)));
    }
    let b_ns = t.elapsed().as_nanos() as f64 / f64::from(iters);

    // A: convert+lower — clone (proxy for convert_runtime_object's allocation) then lower.
    let t = Instant::now();
    for _ in 0..iters {
        let cloned = black_box(obj.clone());
        black_box(lower_static_sz_object(black_box(&cloned)));
    }
    let a_ns = t.elapsed().as_nanos() as f64 / f64::from(iters);

    println!("\nLOWERING-ISOLATED (no serde boundary), ns/call:");
    println!("  B  zero-copy (lower only):       {b_ns:7.0} ns");
    println!("  A  convert+lower (clone+lower):  {a_ns:7.0} ns");
    println!("  delta (A-B = conversion cost):   {:7.0} ns", a_ns - b_ns);
    println!(
        "  full-path transform_sz baseline: ~64000 ns (serde boundary); delta is {:.2}% of it\n",
        (a_ns - b_ns) / 64_000.0 * 100.0
    );
}
