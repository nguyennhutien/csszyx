//! End-to-end runs of the native szv precompile — parse, qualify, finalize,
//! splice — through the same public batch entry the napi binding uses.
//!
//! The vitest suites already prove tri-lane parity for these scenarios; what
//! they cannot do is make the Rust half execute under `cargo test`, so before
//! this file the whole finalize/splice path only ran through Node and was
//! invisible to the Rust coverage gate.

#![cfg(feature = "native-engine")]

use csszyx_core::transform::{
    transform_batch, transform_batch_with_options, TransformFile, TransformOptions, TransformResult,
};

const IMPORTS: &str =
    "import { szr } from '@csszyx/runtime';\nimport { szv } from '@csszyx/runtime';\n";

/// The well-formed factory used across the vitest matrix, verbatim.
const FACTORY: &str = "const cardSz = szv({ base: { rounded: 'lg' }, variants: { pad: { sm: { p: 2 }, lg: { p: 8 } }, tone: { red: { bg: 'red-500' }, blue: { bg: 'blue-500', color: 'white' } } }, defaultVariants: { tone: 'blue' } });\n";

fn run(source: &str) -> TransformResult {
    let file = TransformFile {
        filename: "/repo/src/App.tsx".to_string(),
        source: source.to_string(),
    };
    transform_batch(std::slice::from_ref(&file))
        .expect("transform_batch failed")
        .remove(0)
}

fn run_with_statics(source: &str, statics_json: &str) -> TransformResult {
    let file = TransformFile {
        filename: "/repo/src/App.tsx".to_string(),
        source: source.to_string(),
    };
    let options = TransformOptions {
        cross_module_statics_json: Some(statics_json.to_string()),
        ..TransformOptions::default()
    };
    transform_batch_with_options(std::slice::from_ref(&file), options)
        .expect("transform_batch_with_options failed")
        .remove(0)
}

#[test]
fn static_selection_collapses_to_a_string_literal() {
    let source =
        format!("{IMPORTS}{FACTORY}export const x = szr(cardSz({{ pad: 'sm', tone: 'red' }}));\n");
    let result = run(&source);
    assert!(
        result.code.contains("\"rounded-lg p-2 bg-red-500\""),
        "static pick should collapse to a literal, got:\n{}",
        result.code
    );
    assert!(!result.code.contains("__szvPick"));
    assert!(!result.code.contains("__szvT_"));
    // With every argument proven, the szr import may leave the barrel.
    assert!(result.code.contains("@csszyx/runtime/core"));
}

#[test]
fn dynamic_selection_splices_a_table_and_the_full_picker() {
    let source = format!("{IMPORTS}{FACTORY}export const x = (sel) => szr(cardSz(sel));\n");
    let result = run(&source);
    assert!(
        result.code.contains("__szvPick(__szvT_cardSz, sel)"),
        "dynamic pick expected, got:\n{}",
        result.code
    );
    assert!(result
        .code
        .contains("const __szvT_cardSz = {\"base\":\"rounded-lg\""));
    assert!(result.code.contains("\"defaults\":{\"tone\":\"blue\"}"));
}

#[test]
fn single_dimension_call_uses_the_narrow_picker() {
    let source = format!(
        "{IMPORTS}const padSz = szv({{ variants: {{ pad: {{ sm: {{ p: 2 }}, lg: {{ p: 8 }} }} }} }});\nexport const x = (size) => szr(padSz({{ pad: size }}));\n"
    );
    let result = run(&source);
    assert!(
        result
            .code
            .contains("__szvPick1(__szvT_padSz, \"pad\", size)"),
        "single-dimension pick expected, got:\n{}",
        result.code
    );
}

#[test]
fn defaults_disable_the_single_dimension_picker() {
    // The omitted dimensions contribute classes through defaultVariants, which
    // the narrow picker never visits — so this call must use the full picker.
    let source =
        format!("{IMPORTS}{FACTORY}export const x = (size) => szr(cardSz({{ pad: size }}));\n");
    let result = run(&source);
    assert!(result.code.contains("__szvPick(__szvT_cardSz,"));
    assert!(!result.code.contains("__szvPick1"));
}

#[test]
fn op_in_a_leaf_bails_the_whole_config() {
    let source = format!(
        "{IMPORTS}const toneSz = szv({{ variants: {{ tone: {{ soft: {{ bg: 'red-500', op: 50 }} }} }} }});\nexport const x = (sel) => szr(toneSz(sel));\n"
    );
    let result = run(&source);
    assert!(!result.code.contains("__szvT_"));
    assert!(result.code.contains("szv({"));
}

#[test]
fn an_extra_factory_reference_bails_the_rewrite() {
    let source = format!(
        "{IMPORTS}{FACTORY}export const x = szr(cardSz({{ pad: 'sm' }}));\nexport const keep = cardSz;\n"
    );
    let result = run(&source);
    assert!(!result.code.contains("__szvT_"));
    // The unproven argument keeps the szr import on the barrel.
    assert!(!result.code.contains("@csszyx/runtime/core"));
}

#[test]
fn comment_mentions_do_not_count_as_references() {
    let source = format!(
        "{IMPORTS}{FACTORY}// cardSz is the card factory\n/* cardSz */\nexport const x = szr(cardSz({{ pad: 'sm', tone: 'red' }}));\n"
    );
    let result = run(&source);
    assert!(
        result.code.contains("\"rounded-lg p-2 bg-red-500\""),
        "comment mentions must not bail the precompile, got:\n{}",
        result.code
    );
}

#[test]
fn an_unproven_szr_argument_reports_through_the_shared_channel() {
    let source = format!("{IMPORTS}export const x = szr(makeSz());\n");
    let result = run(&source);
    assert!(
        !result.diagnostics.is_empty(),
        "an unresolvable szr argument must surface a diagnostic"
    );
}

#[test]
fn cross_module_statics_collapse_an_imported_factory() {
    let source = "import { szr } from '@csszyx/runtime';\nimport { cardSz } from './styles';\nexport const x = szr(cardSz({ pad: 'sm', tone: 'red' }));\n";
    let statics = r#"[["./styles",[["cardSz",[["base",[["rounded","lg"]]],["variants",[["pad",[["sm",[["p",2]]],["lg",[["p",8]]]]],["tone",[["red",[["bg","red-500"]]],["blue",[["bg","blue-500"],["color","white"]]]]]]],["defaultVariants",[["tone","blue"]]]]]]]]"#;
    let result = run_with_statics(source, statics);
    assert!(
        result.code.contains("\"rounded-lg p-2 bg-red-500\""),
        "imported factory should collapse via the registry payload, got:\n{}",
        result.code
    );
}

#[test]
fn a_malformed_statics_payload_only_costs_the_optimization() {
    let source = "import { szr } from '@csszyx/runtime';\nimport { cardSz } from './styles';\nexport const x = szr(cardSz({ pad: 'sm' }));\n";
    let result = run_with_statics(source, "not json at all");
    assert!(!result.code.contains("__szvT_"));
    assert!(result.code.contains("cardSz({ pad: 'sm' })"));
}
