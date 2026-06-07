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
}
