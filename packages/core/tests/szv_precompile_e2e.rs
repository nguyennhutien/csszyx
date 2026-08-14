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

#[test]
fn a_factory_call_inside_an_sz_attribute_keeps_the_runtime_path() {
    // The sz attribute is replaced by a generated expression, so there is no
    // range left to splice the pick into. This used to abort the process at
    // `string_wizard` with no file name; the correct outcome is the runtime
    // path, which the JS lanes reach through the same rule.
    let source = format!(
        "{IMPORTS}{FACTORY}export const P = () => (\n    <div className=\"base\" sz={{[{{ p: 4 }}, szr(cardSz({{ pad: 'sm' }}))]}}>p</div>\n);\n"
    );
    let result = run(&source);
    assert!(
        result.code.contains("_szPart(szr(cardSz({ pad: 'sm' })))"),
        "the authored call must survive untouched, got:\n{}",
        result.code
    );
    assert!(!result.code.contains("__szvPick"));
    assert!(!result.code.contains("__szvT_"));
    // The argument is unproven, so the slim core entry must not be claimed.
    assert!(!result.code.contains("@csszyx/runtime/core"));
}

#[test]
fn a_factory_call_in_a_class_attribute_beside_sz_still_precompiles() {
    // The same element carries both rewrites. Merging around the authored
    // expression instead of over it leaves the call site spliceable.
    let source = format!(
        "{IMPORTS}{FACTORY}export const P = () => (\n    <div className={{szr(cardSz({{ pad: 'sm' }}))}} sz={{{{ position: 'fixed' }}}}>p</div>\n);\n"
    );
    let result = run(&source);
    assert!(
        result
            .code
            .contains("_szMerge(szr(\"rounded-lg p-2 bg-blue-500 text-white\"), \"fixed\")"),
        "the precompile and the sz merge must compose, got:\n{}",
        result.code
    );
    assert!(result.code.contains("@csszyx/runtime/core"));
}

/// The metadata must name every picker the splice actually emitted.
///
/// The bundler injects the picker import from these flags alone; it never
/// re-reads the emitted code. A flag left false beside a spliced
/// `__szvPick(...)` call ships a module that calls an identifier nothing
/// defined, and the first render throws. Both flags are asserted in both
/// directions so neither can be pinned to a constant.
#[test]
fn the_picker_metadata_matches_the_spliced_call() {
    let full = run(&format!(
        "{IMPORTS}{FACTORY}export const x = (sel) => szr(cardSz(sel));\n"
    ));
    assert!(full.code.contains("__szvPick(__szvT_cardSz, sel)"));
    assert!(
        full.metadata.uses_szv_pick,
        "a spliced picker needs its import"
    );
    assert!(!full.metadata.uses_szv_pick1, "the narrow picker is unused");

    let narrow = run(&format!(
        "{IMPORTS}const padSz = szv({{ variants: {{ pad: {{ sm: {{ p: 2 }}, lg: {{ p: 8 }} }} }} }});\nexport const x = (size) => szr(padSz({{ pad: size }}));\n"
    ));
    assert!(narrow
        .code
        .contains("__szvPick1(__szvT_padSz, \"pad\", size)"));
    assert!(
        narrow.metadata.uses_szv_pick1,
        "a spliced narrow picker needs its import"
    );

    // A wholly static selection collapses to a literal, so neither picker is
    // emitted and neither may be claimed.
    let literal = run(&format!(
        "{IMPORTS}{FACTORY}export const x = szr(cardSz({{ pad: 'sm', tone: 'red' }}));\n"
    ));
    assert!(!literal.code.contains("__szvPick"));
    assert!(!literal.metadata.uses_szv_pick);
    assert!(!literal.metadata.uses_szv_pick1);
}

/// A catalog config wrapped for its types is still a catalog.
///
/// `szv({...} as const)` is how the config is written whenever the author
/// wants literal types out of it, which is most of the time. Reading past the
/// wrapper is what lets the config be compiled at all; without it the whole
/// catalog goes to the runtime and not one of its variant classes reaches the
/// safelist, so every variant renders unstyled under `source(none)`.
#[test]
fn a_catalog_config_compiles_through_its_type_wrappers() {
    for (what, config) in [
        (
            "as const",
            "{ variants: { pad: { sm: { p: 2 } } } } as const",
        ),
        (
            "satisfies",
            "{ variants: { pad: { sm: { p: 2 } } } } satisfies Config",
        ),
        ("parentheses", "({ variants: { pad: { sm: { p: 2 } } } })"),
        (
            "a non-null assertion",
            "({ variants: { pad: { sm: { p: 2 } } } })!",
        ),
    ] {
        let result = run(&format!(
            "{IMPORTS}const padSz = szv({config});\nexport const x = szr(padSz({{ pad: 'sm' }}));\n"
        ));
        assert!(
            result.code.contains("\"p-2\""),
            "{what}: the config must compile, got:\n{}",
            result.code
        );
    }
}

/// Negative numbers keep their sign through the compiled table.
///
/// A negative margin or inset is ordinary layout code, and the sign lives in
/// the class name rather than the value, so dropping it produces `m-2` where
/// the author wrote `-2`. That is a real class Tailwind will happily generate,
/// pushing the element the opposite way with nothing to indicate why.
#[test]
fn negative_values_keep_their_sign_in_the_compiled_table() {
    let result = run(&format!(
        "{IMPORTS}const pullSz = szv({{ variants: {{ pull: {{ up: {{ m: -2, top: -4 }} }} }} }});\nexport const x = szr(pullSz({{ pull: 'up' }}));\n"
    ));
    assert!(
        result.code.contains("\"-m-2 -top-4\""),
        "negative classes expected, got:\n{}",
        result.code
    );

    // The same sign question on the SELECTION side: the number the caller
    // passes has to match the variant key it was written against, and a
    // dropped sign quietly picks a different variant or none at all.
    let selected = run(&format!(
        "{IMPORTS}const stepSz = szv({{ variants: {{ step: {{ '-1': {{ m: 1 }}, '1': {{ m: 3 }} }} }} }});\nexport const x = szr(stepSz({{ step: -1 }}));\n"
    ));
    assert!(
        selected.code.contains("\"m-1\""),
        "the negative selection must pick its own variant, got:\n{}",
        selected.code
    );
}

/// A boolean leaf in a catalog reaches the safelist.
///
/// `{ truncate: true }` is the normal way to switch a boolean utility on in a
/// variant. This config does not qualify for the compiled table, so the class
/// reaches CSS only through the lenient catalog walk that collects safelist
/// candidates — and if the boolean leaf is skipped there, the variant renders
/// with a class attribute Tailwind was never told to generate a rule for.
#[test]
fn a_boolean_leaf_in_a_catalog_reaches_the_safelist() {
    let result = run(&format!(
        "{IMPORTS}const clipSz = szv({{ variants: {{ clip: {{ on: {{ truncate: true, italic: false }} }} }} }});\nexport const x = szr(clipSz({{ clip: 'on' }}));\n"
    ));
    assert!(
        result.classes.iter().any(|class| class == "truncate"),
        "the true leaf must be safelisted, got {:?}",
        result.classes
    );
    assert!(
        !result.classes.iter().any(|class| class == "italic"),
        "a false leaf emits nothing, got {:?}",
        result.classes
    );
}
