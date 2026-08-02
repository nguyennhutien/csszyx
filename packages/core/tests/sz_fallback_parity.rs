//! Three-engine parity for the sz runtime-fallback diagnostic matrix.
//!
//! Every expected string below is the BABEL lane's exact output for the same
//! source, captured from `transformSourceCode` — not hand-written. The suite
//! exists to hold the ADR 0011 contract: flipping `build.parser` must not
//! change one byte of the build log. A failure here is an engine divergence,
//! not a wording preference.

#![cfg(feature = "native-engine")]
// Babel-captured JSX sources legitimately contain `{...}` sequences.
#![allow(clippy::literal_string_with_formatting_args)]

use csszyx_core::transform::{transform_batch, TransformFile};

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
fn babel_parity_member() {
    let result = run("export const A = () => <div sz={cfg.x} />;");
    let expected: Vec<String> = vec![
            String::from("sz fallback at 1:33: member expression is not statically resolvable.\n  Suggestion: Extract the value to a module-level const. For variant-based styling → szv(). For true runtime values → dynamic()."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
}

#[test]
fn babel_parity_member_parens() {
    let result = run("export const A = () => <div sz={(cfg.x)} />;");
    let expected: Vec<String> = vec![
            String::from("sz fallback at 1:34: member expression is not statically resolvable.\n  Suggestion: Extract the value to a module-level const. For variant-based styling → szv(). For true runtime values → dynamic()."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
}

#[test]
fn babel_parity_member_ts_as() {
    let result = run("export const A = () => <div sz={cfg.x as object} />;");
    let expected: Vec<String> = vec![
            String::from("sz fallback at 1:33: expression of type `TSAsExpression` is not statically analyzable.\n  Suggestion: Use a literal sz object or a module-level const. For variant-based styling → szv(). For true runtime values → dynamic()."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
}

#[test]
fn babel_parity_call_named() {
    let result = run("export const A = () => <div sz={makeSz()} />;");
    let expected: Vec<String> = vec![
            String::from("sz fallback at 1:33: function call `makeSz()` result is unknown at build time.\n  Suggestion: If it returns static variants → convert to szv(). If it depends on runtime data → use dynamic()."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
}

#[test]
fn babel_parity_call_member() {
    let result = run("export const A = () => <div sz={theme.build()} />;");
    let expected: Vec<String> = vec![
            String::from("sz fallback at 1:33: function call `build()` result is unknown at build time.\n  Suggestion: If it returns static variants → convert to szv(). If it depends on runtime data → use dynamic()."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
}

#[test]
fn babel_parity_call_computed() {
    let result = run("export const A = () => <div sz={table[key]()} />;");
    let expected: Vec<String> = vec![
            String::from("sz fallback at 1:33: function call `key()` result is unknown at build time.\n  Suggestion: If it returns static variants → convert to szv(). If it depends on runtime data → use dynamic()."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
}

#[test]
fn babel_parity_call_unreadable() {
    let result = run("export const A = ({ c }) => <div sz={(c ? f : g)()} />;");
    let expected: Vec<String> = vec![
            String::from("sz fallback at 1:38: function call `?()` result is unknown at build time.\n  Suggestion: If it returns static variants → convert to szv(). If it depends on runtime data → use dynamic()."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
}

#[test]
fn babel_parity_other_new() {
    let result = run("export const A = () => <div sz={new Sz()} />;");
    let expected: Vec<String> = vec![
            String::from("sz fallback at 1:33: expression of type `NewExpression` is not statically analyzable.\n  Suggestion: Use a literal sz object or a module-level const. For variant-based styling → szv(). For true runtime values → dynamic()."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
}

#[test]
fn babel_parity_other_logical() {
    let result = run("export const A = ({c, o}) => <div sz={c && o} />;");
    let expected: Vec<String> = vec![
            String::from("sz fallback at 1:39: expression of type `LogicalExpression` is not statically analyzable.\n  Suggestion: Use a literal sz object or a module-level const. For variant-based styling → szv(). For true runtime values → dynamic()."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
}

#[test]
fn babel_parity_other_template() {
    let result = run("export const A = ({ v }) => <div sz={`${v}`} />;");
    let expected: Vec<String> = vec![
            String::from("sz fallback at 1:38: expression of type `TemplateLiteral` is not statically analyzable.\n  Suggestion: Use a literal sz object or a module-level const. For variant-based styling → szv(). For true runtime values → dynamic()."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
}

#[test]
fn babel_parity_other_await() {
    let result = run("export const A = async ({ p }) => <div sz={await p} />;");
    let expected: Vec<String> = vec![
            String::from("sz fallback at 1:44: expression of type `AwaitExpression` is not statically analyzable.\n  Suggestion: Use a literal sz object or a module-level const. For variant-based styling → szv(). For true runtime values → dynamic()."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
}

#[test]
fn babel_parity_spread_object() {
    let result = run("export const A = ({o}) => <div sz={{ ...o, p: 4 }} />;");
    let expected: Vec<String> = vec![
            String::from("sz fallback at 1:36: expression of type `ObjectExpression` is not statically analyzable.\n  Suggestion: Use a literal sz object or a module-level const. For variant-based styling → szv(). For true runtime values → dynamic()."),
            String::from("[csszyx] unresolvable sz spread at 1:36: sz={{ ...x }} cannot be resolved at build time and falls back to runtime; it may render no styles in production. Use array form: sz={[x, { ... }]}."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
}

#[test]
fn babel_parity_cond_spread_silent() {
    let result =
        run("const B={p:8}; export const A = ({big}) => <div sz={{ ...(big ? B : {}), m: 2 }} />;");
    let expected: Vec<String> = Vec::<String>::new();
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
}

#[test]
fn columns_count_utf16_units_like_the_js_lanes() {
    // Two astral emoji (2 UTF-16 units each, 4 UTF-8 bytes each) sit before
    // the attribute: a byte-counted column would report 1:49, a code-point
    // one 1:43. Babel reports 1:45 (UTF-16 units) for this exact source —
    // captured, not computed — so this pins the unit, not just the offset
    // arithmetic.
    let source = "export const A = (/* \u{1F600}\u{1F600} */ p) => <div sz={p.x} />;";
    let result = run(source);
    assert_eq!(result.diagnostics.len(), 1, "{:?}", result.diagnostics);
    assert!(
        result.diagnostics[0].starts_with("sz fallback at 1:45:"),
        "got: {}",
        result.diagnostics[0]
    );
}
