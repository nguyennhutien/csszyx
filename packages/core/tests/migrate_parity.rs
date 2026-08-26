//! The recorded golden for `csszyx migrate`, class by class.
//!
//! The corpus records the answer for every class the goldens, the sz-key
//! matrix, the pinned corpora and a list of edge cases contain — including
//! which inputs are answered "not recognised". It was recorded from the
//! TypeScript implementation this engine was ported from, and stayed green
//! through the port; the generator that wrote it went with that
//! implementation, so the file no longer grows on its own.
//!
//! That makes it a frozen regression net rather than a comparison: it cannot
//! notice a class nobody has added to it, but any change to an answer it
//! already holds fails closed. New coverage belongs in the unit tests beside
//! the code, and in the corpus round-trip, which asks Tailwind itself.
//!
//! An answer here is a decision, not a law, and `record_the_corpus` below is
//! how a decision gets changed: it rewrites the file from the engine as it
//! stands, so re-baselining shows up as a reviewable diff of exactly the
//! answers that moved. Without it the only ways to change one would be
//! editing a megabyte of JSON by hand or deleting the test.

#![cfg(feature = "migrate")]

use csszyx_core::migrate::{
    class_name_to_sz_object, parse_class, sz_html_value, sz_object_literal, SzObject,
};
use serde::{Deserialize, Serialize};

mod common;
use common::{read_corpus, write_corpus};

#[derive(Deserialize, Serialize)]
struct Corpus {
    /// Field order here IS the file's key order; the recorder writes it back.
    #[serde(rename = "$comment")]
    comment: String,
    /// Where the classes came from. Carried verbatim: the generator that
    /// produced the breakdown is gone, and the recorder does not re-derive it.
    sources: Box<serde_json::value::RawValue>,
    count: usize,
    entries: Vec<Entry>,
    /// The migration-resolution map the custom-map cases were converted with.
    #[serde(rename = "customMap")]
    custom_map: SzObject,
    #[serde(rename = "customMapCases")]
    custom_map_cases: Vec<ConversionCase>,
}

#[derive(Deserialize, Serialize)]
struct Entry {
    /// The class as migrate receives it.
    c: String,
    /// What `parseClass` answered, or `null`.
    p: Option<serde_json::Value>,
    /// What `classNameToSzObject` answered.
    o: Conversion,
}

#[derive(Deserialize, Serialize)]
struct ConversionCase {
    c: String,
    o: Conversion,
}

#[derive(Deserialize, Serialize)]
struct Conversion {
    /// The sz object itself. Field order here IS the file's key order.
    sz: SzObject,
    /// The sz object as `JSON.stringify` wrote it, keys in its order.
    #[serde(rename = "szText")]
    sz_text: String,
    /// Classes left in `className`.
    u: Vec<String>,
    /// Classes the map said to keep.
    k: Vec<String>,
    /// The sz object as the codegen writes it: an object literal.
    g: String,
    /// The same as an HTML attribute value, outer braces stripped.
    h: String,
}

fn corpus() -> Corpus {
    let json = read_corpus("migrate-parity-corpus.json");
    let corpus: Corpus = serde_json::from_str(&json).expect("the migrate parity corpus is JSON");
    assert_eq!(corpus.count, corpus.entries.len());
    assert!(
        corpus.count > 3000,
        "the corpus holds only {} classes",
        corpus.count
    );
    corpus
}

#[test]
fn parse_class_answers_exactly_what_the_typescript_parser_answers() {
    let corpus = corpus();
    let mut recognised = 0;
    let mut mismatches = Vec::new();

    for entry in &corpus.entries {
        let rust = parse_class(&entry.c)
            .map(|parsed| serde_json::to_value(parsed).expect("a parsed class serialises"));
        if rust.is_some() {
            recognised += 1;
        }
        if rust != entry.p {
            mismatches.push(format!(
                "  {:?}\n      ts   = {}\n      rust = {}",
                entry.c,
                entry
                    .p
                    .as_ref()
                    .map_or_else(|| "null".to_string(), ToString::to_string),
                rust.as_ref()
                    .map_or_else(|| "null".to_string(), ToString::to_string),
            ));
        }
    }

    // Two parsers that both recognise nothing also agree on everything.
    assert!(
        recognised > 2000,
        "only {recognised} classes were recognised"
    );
    assert!(
        mismatches.is_empty(),
        "{} of {} classes parse differently from the TypeScript parser:\n{}",
        mismatches.len(),
        corpus.count,
        mismatches
            .iter()
            .take(40)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

/// One class string through the Rust conversion, rendered the way the
/// corpus renders the TypeScript's answer.
fn convert(class_name: &str, custom_map: Option<&SzObject>) -> (String, Vec<String>, Vec<String>) {
    let converted = class_name_to_sz_object(class_name, custom_map);
    (
        serde_json::to_string(&converted.sz_object).expect("an sz object serialises"),
        converted.unrecognized,
        converted.keep_in_class_name,
    )
}

fn assert_conversions<'a>(
    cases: impl Iterator<Item = (&'a str, &'a Conversion)>,
    custom_map: Option<&SzObject>,
) {
    let mut total = 0;
    let mut mismatches = Vec::new();
    for (class_name, expected) in cases {
        total += 1;
        let actual = convert(class_name, custom_map);
        let wanted = (
            expected.sz_text.clone(),
            expected.u.clone(),
            expected.k.clone(),
        );
        if actual != wanted {
            mismatches.push(format!(
                "  {class_name:?}\n      ts   = {wanted:?}\n      rust = {actual:?}"
            ));
        }
    }
    assert!(
        mismatches.is_empty(),
        "{} of {total} class strings convert differently from the TypeScript:\n{}",
        mismatches.len(),
        mismatches
            .iter()
            .take(40)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn class_name_to_sz_object_answers_exactly_what_the_typescript_answers() {
    let corpus = corpus();
    let converted = corpus
        .entries
        .iter()
        .filter(|entry| entry.o.sz_text != "{}")
        .count();
    assert!(
        converted > 2000,
        "only {converted} class strings converted to anything"
    );
    assert_conversions(
        corpus
            .entries
            .iter()
            .map(|entry| (entry.c.as_str(), &entry.o)),
        None,
    );
}

#[test]
fn custom_map_entries_resolve_exactly_as_the_typescript_resolves_them() {
    let corpus = corpus();
    assert!(corpus.custom_map_cases.len() > 20);
    assert_conversions(
        corpus
            .custom_map_cases
            .iter()
            .map(|case| (case.c.as_str(), &case.o)),
        Some(&corpus.custom_map),
    );
}

/// The codegen's two spellings of one conversion's sz object.
fn spell(class_name: &str, custom_map: Option<&SzObject>) -> (String, String) {
    let converted = class_name_to_sz_object(class_name, custom_map);
    (
        sz_object_literal(&converted.sz_object),
        sz_html_value(&converted.sz_object, false),
    )
}

fn assert_codegen<'a>(
    cases: impl Iterator<Item = (&'a str, &'a Conversion)>,
    custom_map: Option<&SzObject>,
) {
    let mut total = 0;
    let mut mismatches = Vec::new();
    for (class_name, expected) in cases {
        total += 1;
        let actual = spell(class_name, custom_map);
        let wanted = (expected.g.clone(), expected.h.clone());
        if actual != wanted {
            mismatches.push(format!(
                "  {class_name:?}\n      ts   = {wanted:?}\n      rust = {actual:?}"
            ));
        }
    }
    assert!(
        mismatches.is_empty(),
        "{} of {total} sz objects print differently from the TypeScript codegen:\n{}",
        mismatches.len(),
        mismatches
            .iter()
            .take(40)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn codegen_prints_exactly_what_the_typescript_codegen_prints() {
    let corpus = corpus();
    let multi_line = corpus
        .entries
        .iter()
        .filter(|entry| entry.o.g.contains('\n'))
        .count();
    assert!(
        multi_line > 50,
        "only {multi_line} objects print on several lines"
    );
    assert_codegen(
        corpus
            .entries
            .iter()
            .map(|entry| (entry.c.as_str(), &entry.o)),
        None,
    );
    assert_codegen(
        corpus
            .custom_map_cases
            .iter()
            .map(|case| (case.c.as_str(), &case.o)),
        Some(&corpus.custom_map),
    );
}

/// What the fixture says about itself. The generator that first wrote the
/// file is gone, so the header names the recorder that maintains it now.
const COMMENT: &str = "RECORDED from the Rust engine. Do not edit by hand. Re-baseline with: cargo test --features migrate --test migrate_parity -- --ignored";

/// One class as the corpus records it, from the engine as it stands now.
fn record(class_name: &str, custom_map: Option<&SzObject>) -> Conversion {
    let converted = class_name_to_sz_object(class_name, custom_map);
    Conversion {
        sz_text: serde_json::to_string(&converted.sz_object).expect("an sz object serialises"),
        g: sz_object_literal(&converted.sz_object),
        h: sz_html_value(&converted.sz_object, false),
        u: converted.unrecognized,
        k: converted.keep_in_class_name,
        sz: converted.sz_object,
    }
}

/// Rewrite the corpus with what this engine answers today.
///
/// Ignored, so a normal `cargo test` never touches the fixture. Run it when a
/// change to migrate is meant to change an answer:
///
/// ```text
/// cargo test --features migrate --test migrate_parity -- --ignored
/// ```
///
/// It keeps the case list exactly as it is — the classes were chosen by a
/// generator that no longer exists — and re-records only the answers, so the
/// diff is the behaviour change and nothing else. Formatting matches the file
/// it replaces: one-space indent, struct field order as the key order.
#[test]
#[ignore = "rewrites a committed fixture; run it only to re-baseline"]
fn record_the_corpus() {
    let mut corpus = corpus();
    corpus.comment = COMMENT.to_string();
    for entry in &mut corpus.entries {
        entry.p = parse_class(&entry.c)
            .map(|parsed| serde_json::to_value(parsed).expect("a parsed class serialises"));
        entry.o = record(&entry.c, None);
    }
    for case in &mut corpus.custom_map_cases {
        case.o = record(&case.c, Some(&corpus.custom_map));
    }
    write_corpus("migrate-parity-corpus.json", &corpus);
}
