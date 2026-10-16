//! A template literal with no substitution is the string it spells.
//!
//! ``{ p: `4` }`` holds `'4'` before any code runs, so every reader of an sz
//! value lowers it like the quoted spelling: the `sz` attribute, an `szs` slot
//! object, an `szv` config the precompile qualifies, and the `szv` catalog it
//! falls back to. The vitest suite runs the same cases on both artifacts; this
//! file makes the Rust half run under `cargo test`.

#![cfg(feature = "native-engine")]

use csszyx_core::transform::{transform_batch, TransformFile, TransformResult};

fn run(source: &str) -> TransformResult {
    let file = TransformFile {
        filename: "/repo/src/App.tsx".to_string(),
        source: source.to_string(),
    };
    transform_batch(std::slice::from_ref(&file))
        .expect("transform_batch failed")
        .remove(0)
}

const IMPORT: &str = "import { szv, szr } from '@csszyx/runtime';\n";

#[test]
fn an_sz_attribute_lowers_it_like_a_quoted_string() {
    let template = run("export const A = () => <div sz={{ p: `4`, hover: { bg: `red-500` } }} />;");
    let quoted = run("export const A = () => <div sz={{ p: '4', hover: { bg: 'red-500' } }} />;");
    assert_eq!(template.code, quoted.code);
    assert!(
        template.code.contains("className=\"p-4 hover:bg-red-500\""),
        "{}",
        template.code
    );
}

#[test]
fn a_substitution_keeps_the_value_at_runtime() {
    let result = run("export const A = ({ n }) => <div sz={{ p: `${n}` }} />;");
    assert!(result.code.contains("p-(--_sz-p)"), "{}", result.code);
}

#[test]
fn an_szs_slot_object_reads_it() {
    let result = run("export const A = () => <Card szs={{ header: { p: `4` } }} />;");
    assert!(
        result.code.contains("szsc={{ header: \"p-4\" }}"),
        "{}",
        result.code
    );
}

#[test]
fn an_szv_config_holding_one_precompiles() {
    let result = run(&format!(
        "{IMPORT}const card = szv({{ base: {{ p: `4` }}, variants: {{ tone: {{ red: {{ bg: 'red-500' }} }} }} }});\nexport const x = szr(card({{ tone: 'red' }}));\n"
    ));
    assert!(
        result.code.contains("\"p-4 bg-red-500\""),
        "{}",
        result.code
    );
}

#[test]
fn the_szv_catalog_collects_it() {
    let result = run(&format!(
        "{IMPORT}declare const dense: boolean;\nexport const card = szv({{ base: {{ p: `4`, m: dense ? 2 : 4 }} }});\n"
    ));
    let mut classes = result.classes;
    classes.sort();
    assert_eq!(classes, ["m-2", "m-4", "p-4"]);
}
