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

#![cfg(feature = "migrate")]

use csszyx_core::migrate::{
    transform_html_source, transform_source, HtmlTransformOptions, SzObject, TransformOptions,
};
use serde::Deserialize;

#[derive(Deserialize)]
struct Corpus {
    #[serde(rename = "customMap")]
    custom_map: SzObject,
    sources: Vec<Source>,
    cases: Vec<Case>,
    #[serde(rename = "htmlCases")]
    html_cases: Vec<HtmlCase>,
}

#[derive(Deserialize)]
struct Source {
    file: String,
    source: String,
}

#[derive(Deserialize)]
struct Case {
    src: usize,
    options: CaseOptions,
    result: serde_json::Value,
}

#[derive(Deserialize, Default)]
struct CaseOptions {
    #[serde(default, rename = "injectTodos")]
    inject_todos: bool,
    #[serde(default, rename = "keysOnly")]
    keys_only: bool,
    /// Whether the case ran with the corpus's resolution map.
    #[serde(default, rename = "customMap")]
    custom_map: bool,
}

#[derive(Deserialize)]
struct HtmlCase {
    name: String,
    source: String,
    options: HtmlTransformOptions,
    result: serde_json::Value,
}

/// Read a corpus at run time rather than `include_str!`.
///
/// These files are megabytes. Embedding them puts the whole text in the test
/// binary as a literal, which rustc then carries through codegen with full
/// debug info — several test binaries compile at once, and on a 16 GB machine
/// that was enough to push the whole `cargo test` compile into swap. Reading
/// the file costs a syscall and keeps the binary small.
fn read_corpus(name: &str) -> String {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("reading {path}: {error}"))
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
        let actual = serde_json::to_value(transform_html_source(&case.source, &case.options))
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
