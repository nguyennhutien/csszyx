//! TS↔Rust parse-level parity.
//!
//! The corpus (scripts/gen-rust-parse-parity-corpus.mjs) records, for each
//! `.tsx` source snippet, the canonical oxc `classes` (sz-derived) and
//! `rawClassNames` (static className strings). This harness replays the same
//! sources through the native `transform_batch` and asserts the same two sets,
//! so the rust parser — the shipped default — cannot diverge from oxc when it
//! extracts sz objects and class strings from real source.
//!
//! The source parser lives behind the `native-engine` feature, so the harness
//! only runs under `cargo test --features native-engine`. Plain `cargo test`
//! (the lib + lowering-harness lane) compiles this file to just its docs.

#[cfg(feature = "native-engine")]
mod parse_parity {
    use csszyx_core::transform::{transform_batch, TransformFile};

    /// Sources whose rust parse output is known to diverge from oxc, pending a
    /// fix. Each entry must be removed once the gap is closed.
    const KNOWN_DIVERGENCES: &[&str] = &[
        // A color-opacity sub-object conditional MIXED with a second property
        // conditional: rust expands the color-op ternary statically
        // (bg-black/30 + bg-black/100 — both safelisted, no runtime var) while
        // babel/oxc shift the opacity to a css-var lane
        // (bg-black/(--_sz-bg-op) + a style var). Both outputs are correct;
        // they disagree on class NAMES, which matters for cross-parser cache
        // and mangle-map stability. Surfaced (not caused) by multi-ternary
        // support — before it, rust punted this mix to the runtime with junk
        // candidates. Closing direction: align babel/oxc to rust's static
        // expansion (fewer runtime vars), a JS-lane follow-up.
        r#"const A = ({ a, b }) => <div sz={{ bg: { color: "black", op: a ? 30 : 100 }, p: b ? 2 : undefined }} />;"#,
    ];

    #[derive(serde::Deserialize)]
    struct ParseRecord {
        source: String,
        classes: Vec<String>,
        #[serde(rename = "rawClassNames")]
        raw_class_names: Vec<String>,
    }

    fn sorted_unique(mut values: Vec<String>) -> Vec<String> {
        values.sort();
        values.dedup();
        values
    }

    #[test]
    fn ts_rust_parse_parity() {
        let json = include_str!("fixtures/parse-parity-corpus.json");
        let records: Vec<ParseRecord> =
            serde_json::from_str(json).expect("parse parity corpus must be valid JSON");
        assert!(!records.is_empty(), "parse parity corpus is empty");

        let mut unexpected = Vec::new();
        let mut newly_fixed = Vec::new();

        for record in &records {
            let file = TransformFile {
                filename: "file.tsx".to_string(),
                source: record.source.clone(),
            };
            let results =
                transform_batch(std::slice::from_ref(&file)).expect("transform_batch failed");
            let result = &results[0];

            let rust_classes = sorted_unique(result.classes.clone());
            let rust_raw = sorted_unique(result.raw_class_names.clone());
            let oxc_classes = sorted_unique(record.classes.clone());
            let oxc_raw = sorted_unique(record.raw_class_names.clone());

            let diverges = rust_classes != oxc_classes || rust_raw != oxc_raw;
            let known = KNOWN_DIVERGENCES.contains(&record.source.as_str());

            if diverges && !known {
                unexpected.push(format!(
                    "  {}\n    classes oxc={oxc_classes:?} rust={rust_classes:?}\n    rawClassNames oxc={oxc_raw:?} rust={rust_raw:?}",
                    record.source
                ));
            } else if !diverges && known {
                newly_fixed.push(record.source.clone());
            }
        }

        assert!(
            unexpected.is_empty(),
            "{} new TS->rust parse divergence(s) — the rust default parser does not match oxc:\n{}",
            unexpected.len(),
            unexpected.join("\n")
        );
        assert!(
            newly_fixed.is_empty(),
            "{} source(s) now match — remove them from KNOWN_DIVERGENCES:\n  {}",
            newly_fixed.len(),
            newly_fixed.join("\n  ")
        );
    }

    /// Discovery-ORDER parity for the multi-ternary lane. The corpus test
    /// above compares SORTED class sets, which is blind to ordering — but
    /// production mangle IDs are assigned in discovery order, so rust must
    /// list statics, then var classes, then each conditional's branches in
    /// source property order, exactly like the JS engines. The vitest ordered
    /// fixtures cover this through the napi binding only once a binary with
    /// multi-ternary support ships; this test covers the source tree now.
    #[test]
    fn multi_ternary_discovery_order() {
        let cases: &[(&str, &[&str])] = &[
            (
                r#"const A = ({ a, b }) => <div sz={{ p: a ? 2 : 4, m: b ? 1 : 3 }} />;"#,
                &["p-2", "p-4", "m-1", "m-3"],
            ),
            (
                r#"const A = ({ w, a, b }) => <div sz={{ w: w, h: "max", p: a ? 2 : undefined, m: b ? 4 : undefined }} />;"#,
                &["h-max", "w-(--_sz-w)", "p-2", "m-4"],
            ),
            (
                r#"const A = ({ w, f, on, big }) => <div className="x" sz={{ w: w, flex: on ? f : undefined, p: big ? 8 : 2 }} />;"#,
                &["w-(--_sz-w)", "flex-(--_sz-flex)", "p-8", "p-2"],
            ),
        ];
        for (source, expected) in cases {
            let file = TransformFile {
                filename: "file.tsx".to_string(),
                source: (*source).to_string(),
            };
            let results =
                transform_batch(std::slice::from_ref(&file)).expect("transform_batch failed");
            assert_eq!(
                results[0].classes, *expected,
                "discovery order diverged for: {source}"
            );
        }
    }
}
