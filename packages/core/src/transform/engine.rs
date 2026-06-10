//! Native transform engine assembly.
//!
//! This module connects parser output, class lowering, and the public transform
//! result contract without enabling source rewrite yet.

use super::{
    css_var_planner::apply_css_variable_mangling,
    fast_path::{triage_source, FastPathTriage},
    global_var_aliases::apply_global_var_aliases,
    lower::lower_source_ir_classes,
    parser::parse_source_shell,
    recovery::{generate_inline_recovery_token, offset_to_line_column},
    rewrite::rewrite_static_sz_attributes,
    DynamicCssVarCategory, ParserPath, RecoveryToken, TransformFile, TransformMetadata,
    TransformOptions, TransformProducer, TransformResult, TransformTimings,
};
use std::time::Instant;

/// Transform one file through fast-path triage and parser-backed static rewrite.
pub(super) fn transform_file(file: &TransformFile) -> TransformResult {
    transform_file_with_options(file, TransformOptions::default())
}

/// Transform one file through fast-path triage and parser-backed static rewrite.
pub(super) fn transform_file_with_options(
    file: &TransformFile,
    options: TransformOptions,
) -> TransformResult {
    let total_start = Instant::now();
    let triage_start = Instant::now();
    match triage_source(file) {
        FastPathTriage::Noop(_) => {
            let mut result = noop_result(file);
            result.metadata.timings.triage_ns = elapsed_ns(triage_start);
            result.metadata.timings.total_ns = elapsed_ns(total_start);
            result
        }
        FastPathTriage::StaticIr(ir) => {
            let triage_ns = elapsed_ns(triage_start);
            transform_fast_static_ir_with_options(file, &ir, triage_ns, total_start, &options)
        }
        FastPathTriage::NeedsParser(_) => {
            let triage_ns = elapsed_ns(triage_start);
            transform_static_classes_with_options(file, triage_ns, total_start, options)
        }
    }
}

/// Lower and rewrite AST-free static IR from the conservative fast path.
fn transform_fast_static_ir(
    file: &TransformFile,
    ir: &super::SourceIr,
    triage_ns: u64,
    total_start: Instant,
) -> TransformResult {
    transform_fast_static_ir_with_options(
        file,
        ir,
        triage_ns,
        total_start,
        &TransformOptions::default(),
    )
}

fn transform_fast_static_ir_with_options(
    file: &TransformFile,
    ir: &super::SourceIr,
    triage_ns: u64,
    total_start: Instant,
    options: &TransformOptions,
) -> TransformResult {
    let global_var_aliases = (!options.global_var_aliases.is_empty())
        .then(|| apply_global_var_aliases(ir, &options.global_var_aliases));
    let lower_ir = global_var_aliases
        .as_ref()
        .map_or(ir, |aliases| &aliases.ir);
    let lower_start = Instant::now();
    let lowered = lower_source_ir_classes(lower_ir);
    let lower_ns = elapsed_ns(lower_start);
    let rewrite_start = Instant::now();
    let rewritten_code = rewrite_static_sz_attributes(&file.source, &file.filename, lower_ir).ok();
    let rewrite_ns = elapsed_ns(rewrite_start);
    let transformed = rewritten_code.is_some();

    TransformResult {
        code: rewritten_code.unwrap_or_else(|| file.source.clone()),
        map: None,
        classes: lowered.classes,
        raw_class_names: lowered.raw_class_names,
        diagnostics: Vec::new(),
        recovery_tokens: Vec::new(),
        css_variable_map: global_var_aliases
            .map(|aliases| aliases.variable_map)
            .unwrap_or_default(),
        metadata: TransformMetadata {
            transformed,
            uses_runtime: false,
            uses_merge: false,
            uses_color_var: false,
            producer: TransformProducer::Rust,
            ast_budget_exceeded: false,
            timings: TransformTimings {
                triage_ns,
                lower_ns,
                rewrite_ns,
                total_ns: elapsed_ns(total_start),
                ..TransformTimings::default()
            },
        },
        parser_path: ParserPath::FastRegex,
    }
}

/// Parse and lower a file into the native transform result shape without
/// mutating source code.
fn transform_static_classes(
    file: &TransformFile,
    triage_ns: u64,
    total_start: Instant,
) -> TransformResult {
    transform_static_classes_with_options(file, triage_ns, total_start, TransformOptions::default())
}

#[allow(clippy::too_many_lines, clippy::needless_pass_by_value)]
fn transform_static_classes_with_options(
    file: &TransformFile,
    triage_ns: u64,
    total_start: Instant,
    options: TransformOptions,
) -> TransformResult {
    let parsed = parse_source_shell(file);
    let global_var_aliases = (!options.global_var_aliases.is_empty())
        .then(|| apply_global_var_aliases(&parsed.ir, &options.global_var_aliases));
    let alias_ir = global_var_aliases
        .as_ref()
        .map_or(&parsed.ir, |aliases| &aliases.ir);
    let css_var_mangling = options.mangle_vars.then(|| {
        apply_css_variable_mangling(alias_ir, &file.source, options.mangle_var_hoist_max_depth)
    });
    let lower_ir = css_var_mangling
        .as_ref()
        .map_or(alias_ir, |mangling| &mangling.ir);
    let lower_start = Instant::now();
    let lowered = lower_source_ir_classes(lower_ir);
    let lower_ns = elapsed_ns(lower_start);
    let recovery_start = Instant::now();
    let recovery_tokens = recovery_tokens(file, &parsed.ir);
    let recovery_ns = elapsed_ns(recovery_start);
    let diagnostics_start = Instant::now();
    let mut diagnostics = parsed.diagnostics;
    // Per-element warnings about unsupported sz/szRecover shapes are soft —
    // the rewrite pass already skips those elements individually, so they
    // must not block the rest of the file from transforming. The oxc-JS
    // path has the same contract: a warning on one element keeps the
    // valid ones flowing through className/recovery-token emission.
    let has_parser_errors = !diagnostics.is_empty();
    diagnostics.extend(unsupported_sz_diagnostics(file, &parsed.ir));
    diagnostics.extend(unsupported_recovery_diagnostics(file, &parsed.ir));
    if parsed.ast_budget_exceeded {
        diagnostics.push(format!(
            "[csszyx] Rust native transform at {}: AST budget exceeded; leaving file unchanged for now.",
            file.filename
        ));
    }
    if let Some(mangling) = &css_var_mangling {
        diagnostics.extend(mangling.diagnostics.iter().cloned());
    }
    let diagnostics_ns = elapsed_ns(diagnostics_start);
    let rewrite_start = Instant::now();
    let rewritten_code = if has_parser_errors || parsed.ast_budget_exceeded || parsed.panicked {
        None
    } else {
        rewrite_static_sz_attributes(&file.source, &file.filename, lower_ir).ok()
    };
    let rewrite_ns = elapsed_ns(rewrite_start);
    let transformed = rewritten_code.is_some();

    if parsed.panicked {
        diagnostics.push("oxc parser panicked before csszyx lowering completed".to_string());
    }

    // Any `sz` attribute that fell to the runtime path needs the `_sz`
    // helper at runtime, which downstream import-injection picks up
    // through this flag. Mirroring the oxc-JS pipeline so caches built
    // against one producer stay valid for the other.
    let uses_merge = transformed
        && parsed.ir.jsx_opening_elements.iter().any(|element| {
            if element
                .sz_attribute_indices
                .iter()
                .any(|index| !parsed.ir.sz_attributes[*index].array_parts.is_empty())
            {
                return true;
            }
            let Some(class_index) = element.class_attribute_index else {
                return false;
            };
            let class_attribute = &parsed.ir.class_attributes[class_index];
            let has_runtime_like_sz = element.sz_attribute_indices.iter().any(|index| {
                let attribute = &parsed.ir.sz_attributes[*index];
                attribute.runtime_fallback
                    || attribute.ternary.is_some()
                    || !attribute.array_parts.is_empty()
            });
            let has_static_sz = !element.sz_attribute_indices.is_empty();
            has_runtime_like_sz || (class_attribute.expression_span.is_some() && has_static_sz)
        });
    let uses_runtime = transformed
        && (uses_merge
            || parsed
                .ir
                .sz_attributes
                .iter()
                .any(|attr| attr.runtime_fallback || !attr.array_parts.is_empty()));
    let uses_color_var = transformed
        && parsed.ir.sz_attributes.iter().any(|attr| {
            attr.dynamic_css_vars
                .iter()
                .any(|prop| prop.category == DynamicCssVarCategory::Color)
        });

    TransformResult {
        code: rewritten_code.unwrap_or_else(|| file.source.clone()),
        map: None,
        classes: lowered.classes,
        raw_class_names: lowered.raw_class_names,
        diagnostics,
        recovery_tokens,
        css_variable_map: merge_variable_maps(
            global_var_aliases.map(|aliases| aliases.variable_map),
            css_var_mangling.map(|mangling| mangling.variable_map),
        ),
        metadata: TransformMetadata {
            transformed,
            uses_runtime,
            uses_merge,
            uses_color_var,
            producer: TransformProducer::Rust,
            ast_budget_exceeded: parsed.ast_budget_exceeded,
            timings: TransformTimings {
                triage_ns,
                parse_ns: parsed.timings.parse_ns,
                scope_ns: parsed.timings.scope_ns,
                ir_ns: parsed.timings.ir_ns,
                lower_ns,
                recovery_ns,
                diagnostics_ns,
                rewrite_ns,
                total_ns: elapsed_ns(total_start),
            },
        },
        parser_path: ParserPath::Static,
    }
}

fn recovery_tokens(file: &TransformFile, ir: &super::SourceIr) -> Vec<RecoveryToken> {
    ir.jsx_opening_elements
        .iter()
        .filter(|element| !element.has_recovery_token_attribute)
        .filter_map(|element| {
            let recovery_index = element.recovery_attribute_index?;
            let recovery = &ir.recovery_attributes[recovery_index];
            let (line, column) = offset_to_line_column(&file.source, recovery.attribute_span.start);
            let token =
                generate_inline_recovery_token(&file.filename, line, column, &element.element_name);

            Some(RecoveryToken {
                token,
                mode: recovery.mode,
                component: element.element_name.clone(),
                path: format!("{}:{line}:{column}", file.filename),
            })
        })
        .collect()
}

fn merge_variable_maps(
    first: Option<Vec<super::CssVariableMapEntry>>,
    second: Option<Vec<super::CssVariableMapEntry>>,
) -> Vec<super::CssVariableMapEntry> {
    let mut merged = Vec::new();
    for entry in first
        .into_iter()
        .flatten()
        .chain(second.into_iter().flatten())
    {
        if merged.iter().any(|existing: &super::CssVariableMapEntry| {
            existing.original == entry.original && existing.mangled == entry.mangled
        }) {
            continue;
        }
        merged.push(entry);
    }
    merged
}

fn unsupported_sz_diagnostics(file: &TransformFile, ir: &super::SourceIr) -> Vec<String> {
    ir.unsupported_sz_attribute_spans
        .iter()
        .map(|span| {
            format!(
                "[csszyx] Rust native transform at {}:{}: unsupported dynamic sz attribute; leaving file unchanged for now.",
                file.filename, span.start
            )
        })
        .collect()
}

fn unsupported_recovery_diagnostics(file: &TransformFile, ir: &super::SourceIr) -> Vec<String> {
    ir.unsupported_recovery_attribute_spans
        .iter()
        .map(|span| {
            format!(
                "[csszyx] szRecover at {}:{}: only static string-literal values \"csr\" or \"dev-only\" are supported. Token emission skipped.",
                file.filename, span.start
            )
        })
        .collect()
}

fn noop_result(file: &TransformFile) -> TransformResult {
    TransformResult {
        code: file.source.clone(),
        map: None,
        classes: Vec::new(),
        raw_class_names: Vec::new(),
        diagnostics: Vec::new(),
        recovery_tokens: Vec::new(),
        css_variable_map: Vec::new(),
        metadata: TransformMetadata {
            transformed: false,
            uses_runtime: false,
            uses_merge: false,
            uses_color_var: false,
            producer: TransformProducer::Rust,
            ast_budget_exceeded: false,
            timings: TransformTimings::default(),
        },
        parser_path: ParserPath::FastRegex,
    }
}

fn elapsed_ns(start: Instant) -> u64 {
    u64::try_from(start.elapsed().as_nanos()).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::{transform_file, transform_static_classes};
    use crate::transform::{ParserPath, TransformFile, TransformProducer};

    #[test]
    fn transform_file_skips_parser_for_no_sz_sources() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div className=\"block\" />;".to_string(),
        };

        let result = transform_file(&file);

        assert_eq!(result.code, file.source);
        assert!(!result.metadata.transformed);
        assert_eq!(result.parser_path, ParserPath::FastRegex);
        assert!(result.metadata.timings.total_ns > 0);
        assert!(result.metadata.timings.triage_ns > 0);
        assert_eq!(result.metadata.timings.parse_ns, 0);
        assert!(result.classes.is_empty());
        assert!(result.raw_class_names.is_empty());
    }

    #[test]
    fn static_engine_rewrites_single_static_sz_attribute() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div sz={{ start: 4, hover: { bg: 'red-500' } }} />;"
                .to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(
            result.code,
            "export const App = () => <div className=\"inset-s-4 hover:bg-red-500\" />;"
        );
        assert!(result.metadata.transformed);
        assert_eq!(result.metadata.producer, TransformProducer::Rust);
        assert_eq!(result.parser_path, ParserPath::Static);
        assert_eq!(result.classes, ["inset-s-4", "hover:bg-red-500"]);
        assert!(result.metadata.timings.total_ns > 0);
        assert!(result.metadata.timings.parse_ns > 0);
        assert!(result.metadata.timings.scope_ns > 0);
        assert!(result.metadata.timings.ir_ns > 0);
        assert!(result.metadata.timings.lower_ns > 0);
        assert!(result.metadata.timings.rewrite_ns > 0);
        assert!(result.raw_class_names.is_empty());
        assert!(result.diagnostics.is_empty());
        assert!(result.recovery_tokens.is_empty());
    }

    #[test]
    fn transform_file_uses_ast_free_path_for_flat_static_sz_attribute() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div id=\"x\" sz={{ p: 4, bg: 'red-500', italic: true }} />;"
                .to_string(),
        };

        let result = transform_file(&file);

        assert_eq!(
            result.code,
            "export const App = () => <div id=\"x\" className=\"p-4 bg-red-500 italic\" />;"
        );
        assert!(result.metadata.transformed);
        assert_eq!(result.parser_path, ParserPath::FastRegex);
        assert_eq!(result.classes, ["p-4", "bg-red-500", "italic"]);
        assert_eq!(result.metadata.timings.parse_ns, 0);
        assert_eq!(result.metadata.timings.scope_ns, 0);
        assert_eq!(result.metadata.timings.ir_ns, 0);
        assert!(result.metadata.timings.lower_ns > 0);
        assert!(result.metadata.timings.rewrite_ns > 0);
    }

    #[test]
    fn static_engine_collects_existing_classes_without_rewriting_source() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div className=\"block\" sz={{ p: 4 }} />;"
                .to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(
            result.code,
            "export const App = () => <div className=\"block p-4\" />;"
        );
        assert!(result.metadata.transformed);
        assert_eq!(result.classes, ["p-4"]);
        assert_eq!(result.raw_class_names, ["block"]);
    }

    #[test]
    fn static_engine_keeps_parse_diagnostics_in_result_contract() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div sz={{ p: }} />;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert!(!result.diagnostics.is_empty());
        assert!(result.classes.is_empty());
        assert!(!result.metadata.transformed);
    }

    #[test]
    fn static_engine_emits_runtime_helper_for_dynamic_sz_identifier() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = ({ styles }) => <div sz={styles} />;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(
            result.code,
            "export const App = ({ styles }) => <div className={_sz(styles)} />;"
        );
        assert!(result.metadata.transformed);
        assert!(result.metadata.uses_runtime);
        assert!(result.classes.is_empty());
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn static_engine_rewrites_static_and_runtime_fallback_elements_together() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source:
                "export const App = ({ styles }) => <><div sz={{ p: 4 }} /><span sz={styles} /></>;"
                    .to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(
            result.code,
            "export const App = ({ styles }) => <><div className=\"p-4\" /><span className={_sz(styles)} /></>;"
        );
        assert!(result.metadata.transformed);
        assert!(result.metadata.uses_runtime);
        assert_eq!(result.classes, ["p-4"]);
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn static_engine_reports_ast_budget_without_rewrite() {
        let source = format!(
            "export const App = () => <>{}</>;",
            "<span />".repeat(crate::transform::parser::AST_BUDGET + 1)
        );
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source,
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(result.code, file.source);
        assert!(!result.metadata.transformed);
        assert!(result.metadata.ast_budget_exceeded);
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.contains("AST budget exceeded")));
    }

    #[test]
    fn static_engine_emits_runtime_helper_for_conditional_spread() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const BASE = { p: 4 } as const;\nconst X = ({ big }) => <div sz={{ ...BASE, ...(big ? { p: 8 } : {}) }} />;"
                .to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(
            result.code,
            "const BASE = { p: 4 } as const;\nconst X = ({ big }) => <div className={_sz({ ...BASE, ...(big ? { p: 8 } : {}) })} />;"
        );
        assert!(result.metadata.transformed);
        assert!(result.metadata.uses_runtime);
        assert_eq!(result.classes, ["p-4", "p-8"]);
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn static_engine_emits_runtime_helper_for_dynamic_identifier() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const X = ({ styles }) => <div sz={styles} />;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(
            result.code,
            "const X = ({ styles }) => <div className={_sz(styles)} />;"
        );
        assert!(result.metadata.transformed);
        assert!(result.metadata.uses_runtime);
        assert!(result.classes.is_empty());
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn static_engine_emits_merge_helper_for_runtime_fallback_with_static_classname() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const X = ({ styles }) => <div className=\"existing\" sz={styles} />;"
                .to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(
            result.code,
            "const X = ({ styles }) => <div className={_szMerge(\"existing\", _sz(styles))} />;"
        );
        assert!(result.metadata.transformed);
        assert!(result.metadata.uses_runtime);
        assert!(result.metadata.uses_merge);
        assert!(result.classes.is_empty());
        assert_eq!(result.raw_class_names, ["existing"]);
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn static_engine_emits_merge_helper_for_runtime_fallback_with_dynamic_classname() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const X = ({ styles }) => <div className={getClass()} sz={styles} />;"
                .to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(
            result.code,
            "const X = ({ styles }) => <div className={_szMerge(getClass(), _sz(styles))} />;"
        );
        assert!(result.metadata.transformed);
        assert!(result.metadata.uses_runtime);
        assert!(result.metadata.uses_merge);
        assert!(result.classes.is_empty());
        assert!(result.raw_class_names.is_empty());
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn static_engine_emits_merge_helper_for_static_sz_with_dynamic_classname() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const X = () => <div className={getClass()} sz={{ p: 4 }} />;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(
            result.code,
            "const X = () => <div className={_szMerge(getClass(), \"p-4\")} />;"
        );
        assert!(result.metadata.transformed);
        assert!(result.metadata.uses_runtime);
        assert!(result.metadata.uses_merge);
        assert_eq!(result.classes, ["p-4"]);
        assert!(result.raw_class_names.is_empty());
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn static_engine_emits_recovery_token() {
        let file = TransformFile {
            filename: "src/App.tsx".to_string(),
            source: "export const App = () => <div szRecover=\"csr\">x</div>;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert!(result.metadata.transformed);
        assert!(result.code.contains("data-sz-recovery-token="));
        assert_eq!(result.recovery_tokens.len(), 1);
        assert_eq!(
            result.recovery_tokens[0].mode,
            crate::transform::RecoveryMode::Csr
        );
        assert_eq!(result.recovery_tokens[0].component, "div");
        assert_eq!(result.recovery_tokens[0].path, "src/App.tsx:1:30");
        assert_eq!(result.recovery_tokens[0].token.len(), 12);
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn static_engine_reports_unsupported_recovery_without_token() {
        let file = TransformFile {
            filename: "src/App.tsx".to_string(),
            source: "export const App = ({ mode }) => <div szRecover={mode}>x</div>;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(result.code, file.source);
        assert!(!result.metadata.transformed);
        assert!(result.recovery_tokens.is_empty());
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.contains("szRecover")));
    }

    #[test]
    fn static_engine_skips_already_tagged_recovery() {
        let file = TransformFile {
            filename: "src/App.tsx".to_string(),
            source:
                "export const App = () => <div szRecover=\"csr\" data-sz-recovery-token=\"abc\">x</div>;"
                    .to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(result.code, file.source);
        assert!(!result.metadata.transformed);
        assert!(result.recovery_tokens.is_empty());
        assert!(result.diagnostics.is_empty());
    }
}
