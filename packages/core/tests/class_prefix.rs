//! The project's Tailwind `prefix()` on every class the engine emits.
//!
//! Tailwind serves `tw:p-4` and nothing else once a stylesheet imports it with
//! `prefix(tw)`: the prefix is always the first segment, before variants, the
//! negative sign and the important mark. A class the engine emits without it
//! styles nothing, so every emission shape is pinned here, and two corpus
//! invariants hold the rule for inputs no single test names.
#![cfg(feature = "native-engine")]

use csszyx_core::transform::lower::{
    lower_static_sz_object, lower_static_sz_object_with_class_prefix,
};
use csszyx_core::transform::{
    transform_batch_with_options, StaticSzObject, TransformFile, TransformOptions, TransformResult,
};

fn run(source: &str, class_prefix: Option<&str>) -> TransformResult {
    let file = TransformFile {
        filename: "/repo/src/App.tsx".to_string(),
        source: source.to_string(),
    };
    let options = TransformOptions {
        class_prefix: class_prefix.map(str::to_string),
        ..TransformOptions::default()
    };
    transform_batch_with_options(std::slice::from_ref(&file), options)
        .expect("transform_batch_with_options failed")
        .remove(0)
}

fn prefixed(classes: &[&str]) -> Vec<String> {
    classes.iter().map(|class| format!("tw:{class}")).collect()
}

#[test]
fn a_static_object_emits_prefixed_classes_before_variants_sign_and_mark() {
    let result = run(
        "export const A = () => <div sz={{ p: 4, hover: { bg: 'red-500' }, mt: -1, w: 'full!' }} />;",
        Some("tw"),
    );
    assert!(
        result
            .code
            .contains("className=\"tw:p-4 tw:hover:bg-red-500 tw:-mt-1 tw:w-full!\""),
        "{}",
        result.code
    );
    assert_eq!(
        result.classes,
        prefixed(&["p-4", "hover:bg-red-500", "-mt-1", "w-full!"])
    );
}

#[test]
fn an_existing_class_name_keeps_its_own_spelling() {
    let result = run(
        "export const A = () => <div className=\"card\" sz={{ p: 4 }} />;",
        Some("tw"),
    );
    assert!(
        result.code.contains("className=\"card tw:p-4\""),
        "{}",
        result.code
    );
    assert_eq!(result.classes, prefixed(&["p-4"]));
    assert_eq!(result.raw_class_names, ["card"]);
}

#[test]
fn conditional_branches_and_chain_arms_are_prefixed() {
    let ternary = run(
        "export const A = ({ on }) => <div sz={on ? { p: 4 } : { p: 2 }} />;",
        Some("tw"),
    );
    assert!(
        ternary.code.contains("on ? \"tw:p-4\" : \"tw:p-2\""),
        "{}",
        ternary.code
    );
    let chain = run(
        "export const A = ({ a, b }) => <div sz={a ? { p: 1 } : b ? { p: 2 } : { p: 3 }} />;",
        Some("tw"),
    );
    assert!(
        chain
            .code
            .contains("a ? \"tw:p-1\" : b ? \"tw:p-2\" : \"tw:p-3\""),
        "{}",
        chain.code
    );
    assert_eq!(chain.classes, prefixed(&["p-1", "p-2", "p-3"]));
}

#[test]
fn array_elements_prefix_lowered_objects_and_keep_authored_strings() {
    let result = run(
        "export const A = ({ on }) => <div sz={['flex', { p: 4 }, on && { m: 2 }]} />;",
        Some("tw"),
    );
    assert!(
        result
            .code
            .contains("_szcn(\"flex\", \"tw:p-4\", on && \"tw:m-2\")"),
        "{}",
        result.code
    );
    assert_eq!(result.classes, ["flex", "tw:p-4", "tw:m-2"]);
}

#[test]
fn the_boolean_class_helper_receives_the_prefixed_class_and_the_bare_key() {
    let result = run(
        "export const A = ({ on }) => <div sz={{ borderB: on }} />;",
        Some("tw"),
    );
    assert!(
        result
            .code
            .contains("__szBoolClass(on, \"borderB\", \"tw:border-b\")"),
        "{}",
        result.code
    );
    assert_eq!(result.classes, prefixed(&["border-b"]));
}

#[test]
fn a_runtime_value_class_is_prefixed_and_its_variable_is_not() {
    let result = run(
        "export const A = ({ w }) => <div sz={{ w: w, p: 4 }} />;",
        Some("tw"),
    );
    assert!(
        result.code.contains("className=\"tw:p-4 tw:w-(--_sz-w)\""),
        "{}",
        result.code
    );
    assert!(
        result
            .code
            .contains("\"--_sz-w\": __szSpacingVar(w, \"w\")"),
        "{}",
        result.code
    );
    assert_eq!(result.classes, prefixed(&["p-4", "w-(--_sz-w)"]));
}

#[test]
fn slot_objects_are_prefixed_and_slot_strings_are_not() {
    let result = run(
        "export const A = () => <Card szs={{ root: { p: 4 }, title: 'text-lg' }} />;",
        Some("tw"),
    );
    assert!(
        result.code.contains("root: \"tw:p-4\", title: 'text-lg'"),
        "{}",
        result.code
    );
    assert_eq!(result.classes, ["tw:p-4", "text-lg"]);
}

#[test]
fn classes_read_from_a_dynamic_call_are_prefixed() {
    let result = run(
        "import { dynamic } from 'csszyx';\nconst s = dynamic({ p: 4, m: 2 });\nexport const A = () => <div className={s} />;",
        Some("tw"),
    );
    assert_eq!(result.classes, prefixed(&["p-4", "m-2"]));
}

#[test]
fn safelist_candidates_behind_a_runtime_fallback_are_prefixed() {
    let result = run(
        "export const A = ({ x }) => <div sz={{ ...x, p: 4 }} />;",
        Some("tw"),
    );
    assert_eq!(result.classes, prefixed(&["p-4"]));
}

#[test]
fn a_variant_added_to_a_fallback_candidate_goes_after_the_prefix() {
    let result = run(
        "export const A = ({ x }) => <div sz={{ hover: { ...x, p: 4 } }} />;",
        Some("tw"),
    );
    assert_eq!(result.classes, ["tw:hover:p-4"]);
    let bare = run(
        "export const A = ({ x }) => <div sz={{ hover: { ...x, p: 4 } }} />;",
        None,
    );
    assert_eq!(bare.classes, ["hover:p-4"]);
}

const SZV_IMPORTS: &str =
    "import { szr } from '@csszyx/runtime';\nimport { szv } from '@csszyx/runtime';\n";
const SZV_FACTORY: &str = "const cardSz = szv({ base: { rounded: 'lg' }, variants: { pad: { sm: { p: 2 }, lg: { p: 8 } }, tone: { red: { bg: 'red-500' }, blue: { bg: 'blue-500', color: 'white' } } }, defaultVariants: { tone: 'blue' } });\n";

#[test]
fn a_static_szv_pick_collapses_to_prefixed_classes() {
    let source = format!(
        "{SZV_IMPORTS}{SZV_FACTORY}export const x = szr(cardSz({{ pad: 'sm', tone: 'red' }}));\n"
    );
    let result = run(&source, Some("tw"));
    assert!(
        result
            .code
            .contains("\"tw:rounded-lg tw:p-2 tw:bg-red-500\""),
        "{}",
        result.code
    );
}

#[test]
fn a_dynamic_szv_table_holds_prefixed_classes() {
    let source = format!("{SZV_IMPORTS}{SZV_FACTORY}export const x = (sel) => szr(cardSz(sel));\n");
    let result = run(&source, Some("tw"));
    assert!(
        result.code.contains("__szvPick(__szvT_cardSz, sel)"),
        "{}",
        result.code
    );
    assert!(result.code.contains("tw:p-8"), "{}", result.code);
    assert!(!result.code.contains("\"p-8\""), "{}", result.code);
}

#[test]
fn an_empty_prefix_emits_what_no_prefix_emits() {
    let source = "export const A = ({ on }) => <div sz={on ? { p: 4 } : { m: 2 }} />;";
    let bare = run(source, None);
    let empty = run(source, Some(""));
    assert_eq!(empty.code, bare.code);
    assert_eq!(empty.classes, bare.classes);
}

#[derive(serde::Deserialize)]
struct LoweringRecord {
    ir: StaticSzObject,
}

#[test]
fn every_lowered_class_in_the_corpus_gains_exactly_the_prefix() {
    let records: Vec<LoweringRecord> =
        serde_json::from_str(include_str!("fixtures/parity-corpus.json")).expect("corpus JSON");
    assert!(
        records.len() > 1000,
        "lowering corpus shrank to {}",
        records.len()
    );
    let mut broken = Vec::new();
    for record in &records {
        let bare = lower_static_sz_object(&record.ir);
        let expected: Vec<String> = bare.iter().map(|class| format!("tw:{class}")).collect();
        let actual = lower_static_sz_object_with_class_prefix(&record.ir, Some("tw"));
        if actual != expected {
            broken.push(format!("{bare:?} -> {actual:?}"));
        }
    }
    assert!(
        broken.is_empty(),
        "{} of {} records:\n{}",
        broken.len(),
        records.len(),
        broken[..broken.len().min(10)].join("\n")
    );
}

#[derive(serde::Deserialize)]
struct ParseRecord {
    source: String,
}

#[test]
fn every_engine_class_in_the_parse_corpus_gains_exactly_the_prefix() {
    let records: Vec<ParseRecord> =
        serde_json::from_str(include_str!("fixtures/parse-parity-corpus.json"))
            .expect("corpus JSON");
    assert!(
        records.len() > 50,
        "parse corpus shrank to {}",
        records.len()
    );
    let mut broken = Vec::new();
    for record in &records {
        let bare = run(&record.source, None);
        let with = run(&record.source, Some("tw"));
        // Every class in this corpus is lowered from an object; none is a
        // string the author wrote, which keeps its spelling and is pinned by
        // its own tests above. A record adding one fails here by design.
        let expected: Vec<String> = bare
            .classes
            .iter()
            .map(|class| format!("tw:{class}"))
            .collect();
        if with.classes != expected || with.raw_class_names != bare.raw_class_names {
            broken.push(format!(
                "  {}\n    expected {expected:?}\n    actual   {:?}",
                record.source, with.classes
            ));
        }
    }
    assert!(
        broken.is_empty(),
        "{} of {} sources:\n{}",
        broken.len(),
        records.len(),
        broken.join("\n")
    );
}

#[test]
fn the_fast_lane_prefixes_too() {
    let result = run("const A = () => <div sz={{ p: 4 }} />;", Some("tw"));
    assert!(
        result.code.contains("className=\"tw:p-4\""),
        "{}",
        result.code
    );
    assert_eq!(result.classes, prefixed(&["p-4"]));
}
