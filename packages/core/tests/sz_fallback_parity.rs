//! Golden args for the sz runtime-fallback diagnostic matrix.
//!
//! Each `fallback_golden_*` source was first captured from the removed Babel
//! lane's `transformSourceCode`. The engine writes no sentence: it reports the
//! fallback's code, the shape it found and the expression that shape names,
//! and the compiler renders the reason and the advice from the registry (ADR
//! 0031). The suite holds the ADR 0011 contract on what the engine owns:
//! which artifact (native or wasm) a build loads must not change one arg of
//! one issue. A failure here is an engine regression.

#![cfg(feature = "native-engine")]
// The captured JSX sources legitimately contain `{...}` sequences.
#![allow(clippy::literal_string_with_formatting_args)]

use csszyx_core::transform::{transform_batch, TransformFile};

/// Where each diagnostic points: a byte offset into the source. The text no
/// longer carries a position; the consumer turns the offset into a line and a
/// UTF-16 column.
fn starts(result: &csszyx_core::transform::TransformResult) -> Vec<u32> {
    result.issues.iter().map(|issue| issue.start).collect()
}

/// Each issue as `<code> <args JSON>`.
fn lines(result: &csszyx_core::transform::TransformResult) -> Vec<String> {
    result
        .issues
        .iter()
        .map(|issue| format!("{} {}", issue.code.as_str(), issue.args.to_json()))
        .collect()
}

fn run(source: &str) -> csszyx_core::transform::TransformResult {
    let file = TransformFile {
        filename: "/repo/src/App.tsx".to_string(),
        source: source.to_string(),
    };
    transform_batch(std::slice::from_ref(&file))
        .expect("transform_batch failed")
        .remove(0)
}

#[test]
fn fallback_golden_member() {
    let result = run("export const A = () => <div sz={cfg.x} />;");
    let expected = [r#"fallback-nudge {"site":"sz","shape":"member","detail":"","path":""}"#];
    assert_eq!(lines(&result), expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [32]);
}

#[test]
fn fallback_golden_member_parens() {
    let result = run("export const A = () => <div sz={(cfg.x)} />;");
    let expected = [r#"fallback-nudge {"site":"sz","shape":"member","detail":"","path":""}"#];
    assert_eq!(lines(&result), expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [33]);
}

#[test]
fn fallback_golden_member_ts_as() {
    let result = run("export const A = () => <div sz={cfg.x as object} />;");
    let expected =
        [r#"fallback-nudge {"site":"sz","shape":"other","detail":"TSAsExpression","path":""}"#];
    assert_eq!(lines(&result), expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [32]);
}

#[test]
fn fallback_golden_call_named() {
    let result = run("export const A = () => <div sz={makeSz()} />;");
    let expected = [r#"fallback-nudge {"site":"sz","shape":"call","detail":"makeSz","path":""}"#];
    assert_eq!(lines(&result), expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [32]);
}

#[test]
fn fallback_golden_call_member() {
    let result = run("export const A = () => <div sz={theme.build()} />;");
    let expected = [r#"fallback-nudge {"site":"sz","shape":"call","detail":"build","path":""}"#];
    assert_eq!(lines(&result), expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [32]);
}

#[test]
fn fallback_golden_call_computed() {
    let result = run("export const A = () => <div sz={table[key]()} />;");
    let expected = [r#"fallback-nudge {"site":"sz","shape":"call","detail":"key","path":""}"#];
    assert_eq!(lines(&result), expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [32]);
}

#[test]
fn fallback_golden_call_unreadable() {
    let result = run("export const A = ({ c }) => <div sz={(c ? f : g)()} />;");
    let expected = [r#"fallback-nudge {"site":"sz","shape":"call","detail":"?","path":""}"#];
    assert_eq!(lines(&result), expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [37]);
}

#[test]
fn fallback_golden_other_new() {
    let result = run("export const A = () => <div sz={new Sz()} />;");
    let expected =
        [r#"fallback-nudge {"site":"sz","shape":"other","detail":"NewExpression","path":""}"#];
    assert_eq!(lines(&result), expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [32]);
}

#[test]
fn fallback_golden_other_logical() {
    let result = run("export const A = ({c, o}) => <div sz={c && o} />;");
    let expected =
        [r#"fallback-nudge {"site":"sz","shape":"other","detail":"LogicalExpression","path":""}"#];
    assert_eq!(lines(&result), expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [38]);
}

#[test]
fn fallback_golden_other_template() {
    let result = run("export const A = ({ v }) => <div sz={`${v}`} />;");
    let expected =
        [r#"fallback-nudge {"site":"sz","shape":"other","detail":"TemplateLiteral","path":""}"#];
    assert_eq!(lines(&result), expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [37]);
}

#[test]
fn fallback_golden_other_await() {
    let result = run("export const A = async ({ p }) => <div sz={await p} />;");
    let expected =
        [r#"fallback-nudge {"site":"sz","shape":"other","detail":"AwaitExpression","path":""}"#];
    assert_eq!(lines(&result), expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [43]);
}

#[test]
fn fallback_golden_spread_object() {
    let result = run("export const A = ({o}) => <div sz={{ ...o, p: 4 }} />;");
    let expected = [
        r#"fallback-nudge {"site":"sz","shape":"other","detail":"ObjectExpression","path":""}"#,
        "unresolvable-spread {}",
    ];
    assert_eq!(lines(&result), expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [35, 35]);
}

#[test]
fn fallback_golden_cond_spread_silent() {
    let result =
        run("const B={p:8}; export const A = ({big}) => <div sz={{ ...(big ? B : {}), m: 2 }} />;");
    let expected: [&str; 0] = [];
    assert_eq!(lines(&result), expected, "code was: {}", result.code);
}

#[test]
fn columns_count_utf16_units() {
    // Two astral emoji (2 UTF-16 units each, 4 UTF-8 bytes each) sit before
    // the attribute: a byte-counted column would report 1:49, a code-point
    // one 1:43. The golden is 1:45 (UTF-16 units, what JS tooling reports)
    // for this exact source — captured, not computed — so this pins the unit,
    // not just the offset arithmetic.
    let source = "export const A = (/* \u{1F600}\u{1F600} */ p) => <div sz={p.x} />;";
    let result = run(source);
    assert_eq!(
        lines(&result),
        [r#"fallback-nudge {"site":"sz","shape":"member","detail":"","path":""}"#]
    );
    // The engine reports the UTF-8 byte offset (48: four bytes per emoji);
    // the consumer turns it into UTF-16 column 45.
    let at = u32::try_from(source.find("p.x").expect("the value")).expect("small");
    assert_eq!((starts(&result), at), (vec![48], 48));
}

#[test]
fn szr_disqualified_szv_factory_names_the_config_path() {
    // Not a captured golden: this finding shipped after the Babel lane was
    // removed, so the pin holds both artifacts (native and wasm) to the same
    // args, the contract the captures above hold.
    let result = run(concat!(
        "import { szr, szv } from 'csszyx';\n",
        "const t = szv({ base: { color: 'red-500' }, variants: { c: { blue: { color: 'blue-500' } } } });\n",
        "export const A = () => <div className={szr(t({ c: 'blue' }))} />;",
    ));
    let expected = [
        r#"fallback-missing-css {"site":"szr","shape":"szv-factory","detail":"t","path":"base.color"}"#,
    ];
    assert_eq!(lines(&result), expected, "code was: {}", result.code);
    // Line 3, column 44.
    assert_eq!(starts(&result), [175]);
}
