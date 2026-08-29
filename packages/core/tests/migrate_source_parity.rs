//! The recorded golden for `csszyx migrate`, whole file by whole file.
//!
//! The corpus holds hand-written snippets that reach every branch of the
//! transformer, synthetic files in the benchmark's shapes, and the real
//! components under apps/docs, each recorded under the option sets that
//! matter for it. The transformer must write the same code, report the same
//! stats and warnings, and name the same unused imports.
//!
//! It was recorded from the TypeScript implementation this engine was ported
//! from, and its generator went with that implementation, so the file is now
//! frozen: a regression net for the cases it holds, not a comparison against
//! a second implementation. Only a warning's prefix is compared where a parse
//! fails, because the wording there was never guaranteed to match.
//!
//! Frozen is not unchangeable. `record_the_corpus` below rewrites the file
//! from the engine as it stands, so a change to migrate that is MEANT to
//! change output is re-baselined as a reviewable diff rather than by editing
//! a megabyte of JSON or deleting the test.

#![cfg(feature = "migrate")]

use csszyx_core::migrate::{
    transform_html_source, transform_source, HtmlTransformOptions, SzObject, TransformOptions,
};
use serde::{Deserialize, Serialize};

mod common;
use common::{read_corpus, write_corpus};

#[derive(Deserialize, Serialize)]
struct Corpus {
    /// Field order here IS the file's key order; the recorder writes it back.
    #[serde(rename = "$comment")]
    comment: String,
    #[serde(rename = "customMap")]
    custom_map: SzObject,
    sources: Vec<Source>,
    cases: Vec<Case>,
    #[serde(rename = "htmlCases")]
    html_cases: Vec<HtmlCase>,
}

#[derive(Deserialize, Serialize)]
struct Source {
    file: String,
    source: String,
}

#[derive(Deserialize, Serialize)]
struct Case {
    src: usize,
    options: CaseOptions,
    result: serde_json::Value,
}

#[derive(Deserialize, Serialize, Default)]
struct CaseOptions {
    // A false flag is absent in the file rather than written out, so the
    // recorder omits it too and an untouched case round-trips byte for byte.
    #[serde(
        default,
        rename = "injectTodos",
        skip_serializing_if = "std::ops::Not::not"
    )]
    inject_todos: bool,
    #[serde(
        default,
        rename = "keysOnly",
        skip_serializing_if = "std::ops::Not::not"
    )]
    keys_only: bool,
    /// Whether the case ran with the corpus's resolution map.
    #[serde(
        default,
        rename = "customMap",
        skip_serializing_if = "std::ops::Not::not"
    )]
    custom_map: bool,
}

#[derive(Deserialize, Serialize)]
struct HtmlCase {
    name: String,
    source: String,
    /// Held as JSON, not as the typed options. The engine's options struct
    /// spells out every field once serialized, while the file records only
    /// what a case overrides — writing it back through the struct would
    /// rewrite every case's options block for nothing.
    options: serde_json::Value,
    result: serde_json::Value,
}

impl HtmlCase {
    /// The case's options, with the engine's defaults filled in.
    fn options(&self) -> HtmlTransformOptions {
        serde_json::from_value(self.options.clone()).expect("html options are options")
    }
}

fn corpus() -> Corpus {
    let json = read_corpus("migrate-source-parity-corpus.json");
    serde_json::from_str(&json).expect("the migrate source parity corpus is JSON")
}

/// The warning a parser failure produces starts with this; the rest is the
/// parser's own wording.
fn parse_error_prefix(file: &str) -> String {
    format!("Parse error in {file}: ")
}

#[test]
fn transform_source_writes_exactly_what_the_typescript_transformer_writes() {
    let corpus = corpus();
    let mut changed = 0;
    let mut mismatches = Vec::new();

    for case in &corpus.cases {
        let source = &corpus.sources[case.src];
        let options = TransformOptions {
            inject_todos: case.options.inject_todos,
            keys_only: case.options.keys_only,
            custom_map: case.options.custom_map.then_some(&corpus.custom_map),
        };
        let result = transform_source(&source.source, &source.file, &options);
        let mut actual = serde_json::to_value(&result).expect("a result serialises");
        let mut expected = case.result.clone();
        if expected["changed"] == true {
            changed += 1;
        }

        let prefix = parse_error_prefix(&source.file);
        let expected_parse_error = expected["warnings"]
            .get(0)
            .and_then(|warning| warning.as_str())
            .is_some_and(|warning| warning.starts_with(&prefix));
        if expected_parse_error {
            let actual_parse_error =
                result.warnings.len() == 1 && result.warnings[0].starts_with(&prefix);
            if actual_parse_error {
                expected["warnings"] = serde_json::Value::Null;
                actual["warnings"] = serde_json::Value::Null;
            }
        }

        if actual != expected {
            mismatches.push(format!(
                "  {} {:?}\n      ts   = {}\n      rust = {}",
                source.file,
                (
                    case.options.inject_todos,
                    case.options.keys_only,
                    case.options.custom_map
                ),
                serde_json::to_string(&expected).unwrap(),
                serde_json::to_string(&actual).unwrap(),
            ));
        }
    }

    assert!(changed > 100, "only {changed} cases changed anything");
    assert!(
        mismatches.is_empty(),
        "{} of {} files transform differently from the TypeScript:\n{}",
        mismatches.len(),
        corpus.cases.len(),
        mismatches
            .iter()
            .take(25)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn transform_html_writes_exactly_what_the_typescript_transformer_writes() {
    let corpus = corpus();
    let mut changed = 0;
    let mut mismatches = Vec::new();
    for case in &corpus.html_cases {
        let actual = serde_json::to_value(transform_html_source(&case.source, &case.options()))
            .expect("a result serialises");
        if case.result["changed"] == true {
            changed += 1;
        }
        if actual != case.result {
            mismatches.push(format!(
                "  {}\n      ts   = {}\n      rust = {}",
                case.name,
                serde_json::to_string(&case.result).unwrap(),
                serde_json::to_string(&actual).unwrap(),
            ));
        }
    }
    assert!(changed > 20, "only {changed} HTML cases changed anything");
    assert!(
        mismatches.is_empty(),
        "{} of {} HTML files transform differently from the TypeScript:\n{}",
        mismatches.len(),
        corpus.html_cases.len(),
        mismatches.join("\n")
    );
}

/// What the fixture says about itself. The generator that first wrote the
/// file is gone, so the header names the recorder that maintains it now.
const COMMENT: &str = "RECORDED from the Rust engine. Do not edit by hand. Re-baseline with: cargo test --features migrate --test migrate_source_parity -- --ignored";

/// Rewrite the corpus with what this engine answers today.
///
/// Ignored, so a normal `cargo test` never touches the fixture. Run it when a
/// change to migrate is meant to change what it writes:
///
/// ```text
/// cargo test --features migrate --test migrate_source_parity -- --ignored
/// ```
///
/// The sources and the option sets stay exactly as they are — they were
/// chosen by a generator that no longer exists — and only the recorded
/// results move, so the diff is the behaviour change and nothing else.
///
/// One thing it will always rewrite: a parse failure's warning carries this
/// parser's wording, where the file still holds the wording of the parser it
/// was recorded from. That is why the comparison above comes down to the
/// prefix for those cases, and why the file has not been re-recorded just to
/// settle it.
#[test]
#[ignore = "rewrites a committed fixture; run it only to re-baseline"]
fn record_the_corpus() {
    let mut corpus = corpus();
    corpus.comment = COMMENT.to_string();
    let custom_map = corpus.custom_map.clone();
    let sources = std::mem::take(&mut corpus.sources);
    for case in &mut corpus.cases {
        let source = &sources[case.src];
        let options = TransformOptions {
            inject_todos: case.options.inject_todos,
            keys_only: case.options.keys_only,
            custom_map: case.options.custom_map.then_some(&custom_map),
        };
        case.result =
            serde_json::to_value(transform_source(&source.source, &source.file, &options))
                .expect("a result serialises");
    }
    for case in &mut corpus.html_cases {
        case.result = serde_json::to_value(transform_html_source(&case.source, &case.options()))
            .expect("a result serialises");
    }
    corpus.sources = sources;
    write_corpus("migrate-source-parity-corpus.json", &corpus);
}
