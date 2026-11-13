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

/// The issue an `sz` attribute reports for the string `detail` names.
fn sz_lone(detail: &str) -> String {
    format!(
        r#"fallback-missing-css {{"site":"sz","shape":"lone-surrogate","detail":"{detail}","path":""}}"#
    )
}

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
    assert_eq!(
        lines(&result),
        [
            sz_lone(r"red\\ud800"),
            sz_lone(r"p\\ud800"),
            sz_lone(r"red\\udc00"),
            sz_lone(r"a\\ud800"),
            sz_lone(r"a\\ud800"),
            sz_lone(r"a\\ud800"),
        ]
    );
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
    assert_eq!(lines(&result), [sz_lone(r"a\\ud800"), sz_lone(r"b\\ud800")]);
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
            r#"fallback-missing-css {"site":"szv","shape":"lone-surrogate","detail":"a\\ud800","path":""}"#,
            r#"fallback-missing-css {"site":"szr","shape":"lone-surrogate","detail":"a\\ud800","path":""}"#,
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

#[test]
fn the_readable_classes_beside_a_lone_surrogate_are_collected() {
    let result = run(concat!(
        "const s = \"p-5 a\\uD800\";\n",
        "export const A = ({ c }) => <>",
        r#"<div sz={["p-4", { m: 2 }, "a\uD800"]} />"#,
        r#"<div sz={"p-1 a\uD800 m-1\uD800 b-1"} />"#,
        r#"<div sz={c ? "p-2" : "a\uD800"} />"#,
        r#"<div sz={[c && "p-3", "\uD800a m-3", s, s, x]} />"#,
        "</>;",
    ));

    let mut classes = result.classes.clone();
    classes.sort();
    assert_eq!(
        classes,
        ["b-1", "m-2", "m-3", "p-1", "p-2", "p-3", "p-4", "p-5"]
    );
    assert!(!invents_text(&result), "{:?}", result.classes);
}

#[test]
fn a_call_no_static_reader_reads_keeps_the_call_nudge() {
    let result = run(concat!(
        "const m = { a: { p: 4 } };\n",
        "const make = () => ({});\n",
        "export const A = () => <>",
        r#"<div sz={makeSz("\uD800")} />"#,
        r#"<div sz={make("\uD800")} />"#,
        r#"<div sz={m["a\uD800"]} />"#,
        "</>;",
    ));

    assert_eq!(
        lines(&result),
        [
            r#"fallback-nudge {"site":"sz","shape":"call","detail":"makeSz","path":""}"#,
            r#"fallback-nudge {"site":"sz","shape":"call","detail":"make","path":""}"#,
            r#"fallback-nudge {"site":"sz","shape":"member","detail":"","path":""}"#,
        ]
    );
}

#[test]
fn an_szv_variant_call_with_a_lone_surrogate_reports_it() {
    let result = run(concat!(
        "import { szv } from '@csszyx/runtime';\n",
        "const b = szv({ base: { p: 4 }, variants: { s: { a: { m: 2 } } } });\n",
        r#"export const A = () => <div sz={b({ s: "a\uD800" })} />;"#,
    ));

    assert_eq!(lines(&result), [sz_lone(r"a\\ud800")]);
}

#[test]
fn a_map_key_beside_a_lone_surrogate_compiles() {
    let result = run(concat!(
        "const theme = { ...{ z: 1 }, a: { bg: \"a\\uD800\" }, b: { p: 4 }, ",
        "n: { x: { bg: \"b\\uD800\" }, y: { m: 2 } }, w: { mt: 1 } };\n",
        "const deep = { k: theme.n };\n",
        "export const A = () => <>",
        "<div sz={theme.b} /><div sz={deep.k.y} /><div sz={{ mt: theme.w.mt }} />",
        "<div sz={theme.a} /><div sz={theme.q} /><div sz={deep.zz} />",
        "</>;",
    ));

    assert!(
        result.code.contains(r#"<div className="p-4" />"#),
        "{}",
        result.code
    );
    assert!(
        result.code.contains(r#"<div className="m-2" />"#),
        "{}",
        result.code
    );
    assert!(
        result.code.contains(r#"<div className="mt-1" />"#),
        "{}",
        result.code
    );
    assert!(
        result.code.contains("className={_sz(theme.a)}"),
        "{}",
        result.code
    );
    assert!(
        result.code.contains("className={_sz(theme.q)}"),
        "{}",
        result.code
    );
    assert_eq!(
        lines(&result),
        [
            sz_lone(r"a\\ud800"),
            sz_lone(r"a\\ud800"),
            sz_lone(r"b\\ud800")
        ]
    );
}

#[test]
fn a_scan_reads_every_token_beside_a_lone_surrogate() {
    use csszyx_core::transform::global_var_usages::{scan_global_var_usages, GlobalVarUsageQuery};
    use csszyx_core::transform::module_links::{scan_module_links, ModuleLinksQuery};

    let file = TransformFile {
        filename: "/repo/src/App.tsx".to_string(),
        source: concat!(
            "const html = '<style>.x-1 {} .y { content: \"\\uD800\" }</style>';\n",
            "export const A = ({ x }) => <>",
            r#"<div className={'bg-[var(--brand)] \uD800'} />"#,
            r#"<div className={`text-[var(--ink)] \uD800 ${x}`} />"#,
            r#"<style>{'.p-4 { content: "\uD800" } .m-2 {}'}</style>"#,
            r#"<style>{`.q-1 { content: "\uD800" } .r-2 {}`}</style>"#,
            "</>;",
        )
        .to_string(),
    };
    let usages =
        scan_global_var_usages(std::slice::from_ref(&file), &GlobalVarUsageQuery::default());
    let names: Vec<_> = usages[0].iter().map(|usage| usage.name.as_str()).collect();
    assert_eq!(names, ["--brand", "--ink"]);

    let links = scan_module_links(
        std::slice::from_ref(&file),
        ModuleLinksQuery {
            style_texts: true,
            ..ModuleLinksQuery::default()
        },
    )
    .remove(0);
    assert_eq!(
        links.style_markup,
        [r#"<style>.x-1 {} .y { content: "\ud800" }</style>"#]
    );
    assert_eq!(
        links.style_css,
        [
            r#".p-4 { content: "\ud800" } .m-2 {}"#,
            r#".q-1 { content: "\ud800" } .r-2 {}"#,
        ]
    );
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

#[cfg(feature = "migrate")]
#[test]
fn migrate_leaves_a_class_whose_inner_string_holds_a_lone_surrogate() {
    use csszyx_core::migrate::{transform_source, TransformOptions};

    for source in [
        "const A = ({ c }) => <p className={`p-4 ${c ? 'a\\uD800' : 'm-2'}`} />;",
        "const A = ({ c }) => <p className={`p-4 ${c ? 'm-2' : 'a\\uD800'}`} />;",
        "const A = ({ c }) => <p className={`p-4 ${c && 'a\\uD800'}`} />;",
        "const A = ({ c }) => <p className={clsx('p-4', 'a\\uD800')} />;",
    ] {
        let result = transform_source(source, "a.tsx", &TransformOptions::default());
        assert_eq!(result.code, source);
    }
}
