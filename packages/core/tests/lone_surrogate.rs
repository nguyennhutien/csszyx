//! A string that holds a lone UTF-16 surrogate is never compiled.
//!
//! The parser hands such a value over with no text form, so any class text
//! the engine wrote for it would be invented. The site that needs it keeps its
//! runtime path, the rest of the file compiles, and the diagnostic says why.
//! `packages/compiler/tests/lone-surrogate.test.ts` holds the same contract on
//! both engine artifacts; this suite reaches the lines the native build
//! compiles, for the coverage gate.

#![cfg(feature = "native-engine")]

use csszyx_core::transform::{
    transform_batch, transform_batch_with_options, TransformFile, TransformOptions, TransformResult,
};

fn run(source: &str) -> TransformResult {
    let file = TransformFile {
        filename: "/repo/src/App.tsx".to_string(),
        source: source.to_string(),
    };
    transform_batch(std::slice::from_ref(&file))
        .expect("transform_batch failed")
        .remove(0)
}

/// Each issue as `<code> <args JSON>`.
fn lines(result: &TransformResult) -> Vec<String> {
    result
        .issues
        .iter()
        .map(|issue| format!("{} {}", issue.code.as_str(), issue.args.to_json()))
        .collect()
}

const SZ_LONE: &str =
    r#"fallback-missing-css {"site":"sz","shape":"lone-surrogate","detail":"","path":""}"#;

/// Whether any collected class carries text a lone surrogate was turned into.
fn invents_text(result: &TransformResult) -> bool {
    result
        .classes
        .iter()
        .any(|class| class.contains('\u{FFFD}') || class.to_ascii_lowercase().contains("\\ud8"))
}

#[test]
fn an_sz_value_key_or_template_with_a_lone_surrogate_stays_at_runtime() {
    let result = run(concat!(
        "export const A = ({ c, x }) => <>",
        r#"<div sz={{ bg: "red\uD800" }} />"#,
        r#"<div sz={{ "p\uD800": 4 }} />"#,
        r"<div sz={{ bg: `red\uDC00` }} />",
        r#"<div sz={c ? { bg: "a\uD800" } : { p: 4 }} />"#,
        r#"<div sz={["p-4", "a\uD800"]} />"#,
        r#"<div sz={{ bg: "a\uD800", m: x }} />"#,
        r#"<div sz={{ p: 4 }} />"#,
        "</>;",
    ));

    assert!(
        result
            .code
            .contains(r#"className={_sz({ bg: "red\uD800" })}"#),
        "{}",
        result.code
    );
    assert!(
        result.code.contains(r#"className={_sz({ "p\uD800": 4 })}"#),
        "{}",
        result.code
    );
    assert!(
        result
            .code
            .contains(r"className={_sz({ bg: `red\uDC00` })}"),
        "{}",
        result.code
    );
    assert!(
        result.code.contains(r#"<div className="p-4" />"#),
        "{}",
        result.code
    );
    assert!(!invents_text(&result), "{:?}", result.classes);
    assert_eq!(lines(&result), [SZ_LONE; 6]);
}

#[test]
fn a_lone_surrogate_read_from_a_const_stays_at_runtime() {
    let result = run(concat!(
        "const s = { bg: \"a\\uD800\" };\n",
        "const C = \"b\\uD800\";\n",
        "export const A = () => <><div sz={s} /><div sz={{ bg: C }} /></>;",
    ));

    assert!(
        result.code.contains("className={_sz(s)}"),
        "{}",
        result.code
    );
    assert!(
        result.code.contains("className={_sz({ bg: C })}"),
        "{}",
        result.code
    );
    assert!(!invents_text(&result), "{:?}", result.classes);
    assert_eq!(lines(&result), [SZ_LONE; 2]);
}

#[test]
fn a_surrogate_pair_compiles() {
    let result = run(concat!(
        "export const A = () => <>",
        r#"<div sz={{ content: "'😀'" }} />"#,
        r#"<div sz={{ content: "'\uD83D\uDE00'" }} />"#,
        r#"<div sz={{ content: "'\u{D834}\u{DF06}'" }} />"#,
        "</>;",
    ));

    assert!(
        result
            .code
            .contains(r#"<div className="content-['😀']" />"#),
        "{}",
        result.code
    );
    assert!(
        result.code.contains(r#"<div className="content-['𝌆']" />"#),
        "{}",
        result.code
    );
    assert!(lines(&result).is_empty(), "{:?}", lines(&result));
}

#[test]
fn a_catalog_call_with_a_lone_surrogate_collects_no_class() {
    let result = run(concat!(
        "import { dynamic, szr, szv } from '@csszyx/runtime';\n",
        "export const t = szv({ base: { bg: 'a\\uD800' }, variants: { c: { b: { p: 4 } } } });\n",
        "export const a = szr({ bg: 'a\\uD800' });\n",
        "export const d = dynamic({ bg: 'a\\uD800' });\n",
    ));

    assert!(result.classes.is_empty(), "{:?}", result.classes);
    assert_eq!(
        lines(&result),
        [
            r#"fallback-missing-css {"site":"szv","shape":"lone-surrogate","detail":"","path":""}"#,
            r#"fallback-missing-css {"site":"szr","shape":"lone-surrogate","detail":"","path":""}"#,
        ]
    );
}

#[test]
fn an_szs_slot_map_with_a_lone_surrogate_stays_as_written() {
    let source = concat!(
        "export const A = () => <>",
        r#"<Card szs={{ root: "a\uD800" }} />"#,
        r#"<Card szs={{ root: { bg: "a\uD800" } }} />"#,
        "</>;",
    );
    let result = run(source);

    assert_eq!(result.code, source);
    assert!(result.classes.is_empty(), "{:?}", result.classes);
    assert_eq!(
        lines(&result)
            .iter()
            .map(|line| line.split(' ').next().unwrap_or_default())
            .collect::<Vec<_>>(),
        ["szs-slot-map", "szs-slot-map"]
    );
}

#[test]
fn a_specifier_with_a_lone_surrogate_names_no_known_module() {
    // `./styles` is in the registry; the specifier the source spells is not,
    // whatever text a lone surrogate might be written as.
    let source = concat!(
        "import { szr } from '@csszyx/runtime\\uD800';\n",
        "import { cardSz, base } from './styles\\uD800';\n",
        "import * as styles from './styles\\uD800';\n",
        "export const x = szr(cardSz({ tone: 'red' }));\n",
        "export const A = () => <><div sz={base} /><div sz={styles.base} /></>;\n",
    );
    let result = run_with_statics(source);
    // The same source with the specifiers spelled plainly does resolve.
    let control = run_with_statics(&source.replace("\\uD800", ""));
    assert!(control.code.contains("bg-red-500"), "{}", control.code);
    assert!(control.code.contains("p-4"), "{}", control.code);

    assert!(
        result.code.contains("szr(cardSz({ tone: 'red' }))"),
        "{}",
        result.code
    );
    assert!(
        result.code.contains("className={_sz(base)}"),
        "{}",
        result.code
    );
    assert!(
        result.code.contains("className={_sz(styles.base)}"),
        "{}",
        result.code
    );
    assert!(!result.code.contains("bg-red-500"), "{}", result.code);
    assert!(!result.code.contains("p-4"), "{}", result.code);
}

fn run_with_statics(source: &str) -> TransformResult {
    let statics =
        r#"[["./styles",[["cardSz",[["variants",[["tone",[["red",[["bg","red-500"]]]]]]]]]]]]"#;
    let objects = r#"[["./styles",[["base",[["p",4]]]]]]"#;
    let file = TransformFile {
        filename: "/repo/src/App.tsx".to_string(),
        source: source.to_string(),
    };
    let options = TransformOptions {
        cross_module_statics_json: Some(statics.to_string()),
        cross_module_sz_objects_json: Some(objects.to_string()),
        ..TransformOptions::default()
    };
    transform_batch_with_options(std::slice::from_ref(&file), options)
        .expect("transform_batch_with_options failed")
        .remove(0)
}

#[cfg(feature = "migrate")]
#[test]
fn migrate_leaves_a_class_template_with_a_lone_surrogate() {
    use csszyx_core::migrate::{transform_source, TransformOptions};

    let source = "const A = ({ c }) => <p className={`p-4 a\\uD800 ${c ? 'm-2' : ''}`} />;";
    let result = transform_source(source, "a.tsx", &TransformOptions::default());

    assert_eq!(result.code, source);
}
