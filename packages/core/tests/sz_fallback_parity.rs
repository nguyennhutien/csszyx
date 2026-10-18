//! Golden wording for the sz runtime-fallback diagnostic matrix.
//!
//! Each `fallback_golden_*` source was first captured from the removed Babel
//! lane's `transformSourceCode`. The reason and the advice still come from that
//! capture through the shared matrix; the body around them is the one the
//! diagnostic registry renders (ADR 0031), and the position moved from the text
//! to the issue's byte offset. The suite holds the ADR 0011 contract: which
//! artifact (native or wasm) a build loads must not change one byte of the
//! build log. A failure here is an engine regression, not a wording preference.

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
    let expected: Vec<String> = vec![
            String::from("`sz` falls back to the runtime: member expression is not statically resolvable.\n  help: Extract the value to a module-level const. For variant-based styling → szv(). For true runtime values → dynamic().\n  note: the runtime `_sz` helper still lowers the value."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [32]);
}

#[test]
fn fallback_golden_member_parens() {
    let result = run("export const A = () => <div sz={(cfg.x)} />;");
    let expected: Vec<String> = vec![
            String::from("`sz` falls back to the runtime: member expression is not statically resolvable.\n  help: Extract the value to a module-level const. For variant-based styling → szv(). For true runtime values → dynamic().\n  note: the runtime `_sz` helper still lowers the value."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [33]);
}

#[test]
fn fallback_golden_member_ts_as() {
    let result = run("export const A = () => <div sz={cfg.x as object} />;");
    let expected: Vec<String> = vec![
            String::from("`sz` falls back to the runtime: expression of type `TSAsExpression` is not statically analyzable.\n  help: Use a literal sz object or a module-level const. For variant-based styling → szv(). For true runtime values → dynamic().\n  note: the runtime `_sz` helper still lowers the value."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [32]);
}

#[test]
fn fallback_golden_call_named() {
    let result = run("export const A = () => <div sz={makeSz()} />;");
    let expected: Vec<String> = vec![
            String::from("`sz` falls back to the runtime: function call `makeSz()` result is unknown at build time.\n  help: If it returns static variants → convert to szv(). If it depends on runtime data → use dynamic().\n  note: the runtime `_sz` helper still lowers the value."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [32]);
}

#[test]
fn fallback_golden_call_member() {
    let result = run("export const A = () => <div sz={theme.build()} />;");
    let expected: Vec<String> = vec![
            String::from("`sz` falls back to the runtime: function call `build()` result is unknown at build time.\n  help: If it returns static variants → convert to szv(). If it depends on runtime data → use dynamic().\n  note: the runtime `_sz` helper still lowers the value."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [32]);
}

#[test]
fn fallback_golden_call_computed() {
    let result = run("export const A = () => <div sz={table[key]()} />;");
    let expected: Vec<String> = vec![
            String::from("`sz` falls back to the runtime: function call `key()` result is unknown at build time.\n  help: If it returns static variants → convert to szv(). If it depends on runtime data → use dynamic().\n  note: the runtime `_sz` helper still lowers the value."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [32]);
}

#[test]
fn fallback_golden_call_unreadable() {
    let result = run("export const A = ({ c }) => <div sz={(c ? f : g)()} />;");
    let expected: Vec<String> = vec![
            String::from("`sz` falls back to the runtime: function call `?()` result is unknown at build time.\n  help: If it returns static variants → convert to szv(). If it depends on runtime data → use dynamic().\n  note: the runtime `_sz` helper still lowers the value."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [37]);
}

#[test]
fn fallback_golden_other_new() {
    let result = run("export const A = () => <div sz={new Sz()} />;");
    let expected: Vec<String> = vec![
            String::from("`sz` falls back to the runtime: expression of type `NewExpression` is not statically analyzable.\n  help: Use a literal sz object or a module-level const. For variant-based styling → szv(). For true runtime values → dynamic().\n  note: the runtime `_sz` helper still lowers the value."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [32]);
}

#[test]
fn fallback_golden_other_logical() {
    let result = run("export const A = ({c, o}) => <div sz={c && o} />;");
    let expected: Vec<String> = vec![
            String::from("`sz` falls back to the runtime: expression of type `LogicalExpression` is not statically analyzable.\n  help: Use a literal sz object or a module-level const. For variant-based styling → szv(). For true runtime values → dynamic().\n  note: the runtime `_sz` helper still lowers the value."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [38]);
}

#[test]
fn fallback_golden_other_template() {
    let result = run("export const A = ({ v }) => <div sz={`${v}`} />;");
    let expected: Vec<String> = vec![
            String::from("`sz` falls back to the runtime: expression of type `TemplateLiteral` is not statically analyzable.\n  help: Use a literal sz object or a module-level const. For variant-based styling → szv(). For true runtime values → dynamic().\n  note: the runtime `_sz` helper still lowers the value."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [37]);
}

#[test]
fn fallback_golden_other_await() {
    let result = run("export const A = async ({ p }) => <div sz={await p} />;");
    let expected: Vec<String> = vec![
            String::from("`sz` falls back to the runtime: expression of type `AwaitExpression` is not statically analyzable.\n  help: Use a literal sz object or a module-level const. For variant-based styling → szv(). For true runtime values → dynamic().\n  note: the runtime `_sz` helper still lowers the value."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [43]);
}

#[test]
fn fallback_golden_spread_object() {
    let result = run("export const A = ({o}) => <div sz={{ ...o, p: 4 }} />;");
    let expected: Vec<String> = vec![
            String::from("`sz` falls back to the runtime: expression of type `ObjectExpression` is not statically analyzable.\n  help: Use a literal sz object or a module-level const. For variant-based styling → szv(). For true runtime values → dynamic().\n  note: the runtime `_sz` helper still lowers the value."),
            String::from("`sz={{ ...x }}` cannot be resolved at build time and falls back to the runtime; it may render no styles in production.\n  help: use the array form: `sz={[x, { ... }]}`."),
        ];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
    assert_eq!(starts(&result), [35, 35]);
}

#[test]
fn fallback_golden_cond_spread_silent() {
    let result =
        run("const B={p:8}; export const A = ({big}) => <div sz={{ ...(big ? B : {}), m: 2 }} />;");
    let expected: Vec<String> = Vec::<String>::new();
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
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
    assert_eq!(result.diagnostics.len(), 1, "{:?}", result.diagnostics);
    assert!(
        result.diagnostics[0].starts_with("`sz` falls back to the runtime: "),
        "got: {}",
        result.diagnostics[0]
    );
    // The engine reports the UTF-8 byte offset (48: four bytes per emoji);
    // the consumer turns it into UTF-16 column 45.
    let at = u32::try_from(source.find("p.x").expect("the value")).expect("small");
    assert_eq!((starts(&result), at), (vec![48], 48));
}

#[test]
fn szr_disqualified_szv_factory_names_the_config_path() {
    // Not a captured golden: this wording shipped after the Babel lane was
    // removed, so the pin holds both artifacts (native and wasm) to one
    // byte-exact string, the same contract the captures above hold.
    let result = run(concat!(
        "import { szr, szv } from 'csszyx';\n",
        "const t = szv({ base: { color: 'red-500' }, variants: { c: { blue: { color: 'blue-500' } } } });\n",
        "export const A = () => <div className={szr(t({ c: 'blue' }))} />;",
    ));
    let expected: Vec<String> = vec![String::from(
        "`szr` falls back to the runtime: szv factory `t()` did not precompile — its config disqualified at `base.color`.\n  help: Every variant value must be a static sz object literal with canonical keys and non-overlapping branches. Fix the value at that path. For runtime data → dynamic().\n  note: its classes were not collected, so Tailwind generates CSS for them only if another source names them.",
    )];
    assert_eq!(result.diagnostics, expected, "code was: {}", result.code);
    // Line 3, column 44.
    assert_eq!(starts(&result), [175]);
}
