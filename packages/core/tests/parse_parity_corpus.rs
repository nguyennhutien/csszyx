//! Frozen regression corpus for the parse level of the native engine.
//!
//! The corpus (scripts/gen-rust-parse-parity-corpus.mjs) records, for each
//! `.tsx` source snippet, the `classes` (sz-derived) and `rawClassNames`
//! (static className strings) the engine itself produced when the record was
//! reviewed — the engine has been the canonical answer since 2026-08-12, so
//! the fixture's job is "the engine still does what it did", not "two
//! implementations agree". A red run here is a BEHAVIOUR CHANGE: either fix
//! the regression, or regenerate deliberately and let review judge the diff.
//! Never regenerate just to turn the gate green.
//!
//! The source parser lives behind the `native-engine` feature, so the harness
//! only runs under `cargo test --features native-engine`. Plain `cargo test`
//! (the lib + lowering-harness lane) compiles this file to just its docs.

#[cfg(feature = "native-engine")]
mod parse_parity {
    use csszyx_core::transform::{transform_batch, TransformFile};

    /// Records whose committed expectation is known-stale, pending a reviewed
    /// regeneration. Emptied 2026-08-12 when the fixture was re-based on the
    /// engine's own answers (the five const-read shapes recorded the
    /// TypeScript engines' runtime-variable output until then — see the git
    /// history of this list for what they looked like).
    const KNOWN_DIVERGENCES: &[&str] = &[];

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
            let recorded_classes = sorted_unique(record.classes.clone());
            let recorded_raw = sorted_unique(record.raw_class_names.clone());

            let diverges = rust_classes != recorded_classes || rust_raw != recorded_raw;
            let known = KNOWN_DIVERGENCES.contains(&record.source.as_str());

            if diverges && !known {
                unexpected.push(format!(
                    "  {}\n    classes recorded={recorded_classes:?} engine={rust_classes:?}\n    rawClassNames recorded={recorded_raw:?} engine={rust_raw:?}",
                    record.source
                ));
            } else if !diverges && known {
                newly_fixed.push(record.source.clone());
            }
        }

        assert!(
            unexpected.is_empty(),
            "{} parse regression(s) — the engine no longer matches its recorded answers:\n{}",
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
    /// source property order, exactly like the JavaScript engines it replaced. The vitest ordered
    /// fixtures cover this through the napi binding only once a binary with
    /// multi-ternary support ships; this test covers the source tree now.
    #[test]
    fn multi_ternary_discovery_order() {
        let cases: &[(&str, &[&str])] = &[
            (
                r"const A = ({ a, b }) => <div sz={{ p: a ? 2 : 4, m: b ? 1 : 3 }} />;",
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
