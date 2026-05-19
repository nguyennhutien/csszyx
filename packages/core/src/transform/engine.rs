//! Native transform engine assembly.
//!
//! This module connects parser output, class lowering, and the public transform
//! result contract without enabling source rewrite yet.

use super::{
    fast_path::{triage_source, FastPathTriage},
    lower::lower_source_ir_classes,
    parser::parse_source_shell,
    recovery::{generate_inline_recovery_token, offset_to_line_column},
    rewrite::rewrite_static_sz_attributes,
    ParserPath, RecoveryToken, TransformFile, TransformMetadata, TransformProducer,
    TransformResult,
};

/// Transform one file through fast-path triage and parser-backed static rewrite.
pub(super) fn transform_file(file: &TransformFile) -> TransformResult {
    match triage_source(file) {
        FastPathTriage::Noop(_) => noop_result(file),
        FastPathTriage::NeedsParser(_) => transform_static_classes(file),
    }
}

/// Parse and lower a file into the native transform result shape without
/// mutating source code.
fn transform_static_classes(file: &TransformFile) -> TransformResult {
    let parsed = parse_source_shell(file);
    let lowered = lower_source_ir_classes(&parsed.ir);
    let recovery_tokens = recovery_tokens(file, &parsed.ir);
    let mut diagnostics = parsed.diagnostics;
    diagnostics.extend(unsupported_sz_diagnostics(file, &parsed.ir));
    diagnostics.extend(unsupported_recovery_diagnostics(file, &parsed.ir));
    if parsed.ast_budget_exceeded {
        diagnostics.push(format!(
            "[csszyx] Rust native transform at {}: AST budget exceeded; leaving file unchanged for now.",
            file.filename
        ));
    }
    let rewritten_code = if diagnostics.is_empty() {
        rewrite_static_sz_attributes(&file.source, &file.filename, &parsed.ir).ok()
    } else {
        None
    };
    let transformed = rewritten_code.is_some();

    if parsed.panicked {
        diagnostics.push("oxc parser panicked before csszyx lowering completed".to_string());
    }

    // Any `sz` attribute that fell to the runtime path needs the `_sz`
    // helper at runtime, which downstream import-injection picks up
    // through this flag. Mirroring the oxc-JS pipeline so caches built
    // against one producer stay valid for the other.
    let uses_runtime = transformed
        && parsed
            .ir
            .sz_attributes
            .iter()
            .any(|attr| attr.runtime_fallback);

    TransformResult {
        code: rewritten_code.unwrap_or_else(|| file.source.clone()),
        map: None,
        classes: lowered.classes,
        raw_class_names: lowered.raw_class_names,
        diagnostics,
        recovery_tokens,
        metadata: TransformMetadata {
            transformed,
            uses_runtime,
            uses_merge: false,
            uses_color_var: false,
            producer: TransformProducer::Rust,
            ast_budget_exceeded: parsed.ast_budget_exceeded,
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
        metadata: TransformMetadata {
            transformed: false,
            uses_runtime: false,
            uses_merge: false,
            uses_color_var: false,
            producer: TransformProducer::Rust,
            ast_budget_exceeded: false,
        },
        parser_path: ParserPath::FastRegex,
    }
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

        let result = transform_static_classes(&file);

        assert_eq!(
            result.code,
            "export const App = () => <div className=\"inset-s-4 hover:bg-red-500\" />;"
        );
        assert!(result.metadata.transformed);
        assert_eq!(result.metadata.producer, TransformProducer::Rust);
        assert_eq!(result.parser_path, ParserPath::Static);
        assert_eq!(result.classes, ["inset-s-4", "hover:bg-red-500"]);
        assert!(result.raw_class_names.is_empty());
        assert!(result.diagnostics.is_empty());
        assert!(result.recovery_tokens.is_empty());
    }

    #[test]
    fn static_engine_collects_existing_classes_without_rewriting_source() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div className=\"block\" sz={{ p: 4 }} />;"
                .to_string(),
        };

        let result = transform_static_classes(&file);

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

        let result = transform_static_classes(&file);

        assert!(!result.diagnostics.is_empty());
        assert!(result.classes.is_empty());
        assert!(!result.metadata.transformed);
    }

    #[test]
    fn static_engine_reports_unsupported_dynamic_sz_without_rewrite() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = ({ styles }) => <div sz={styles} />;".to_string(),
        };

        let result = transform_static_classes(&file);

        assert_eq!(result.code, file.source);
        assert!(!result.metadata.transformed);
        assert!(result.classes.is_empty());
        assert_eq!(result.diagnostics.len(), 1);
        assert!(result.diagnostics[0].contains("unsupported dynamic sz attribute"));
    }

    #[test]
    fn static_engine_avoids_partial_rewrite_when_any_sz_is_unsupported() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source:
                "export const App = ({ styles }) => <><div sz={{ p: 4 }} /><span sz={styles} /></>;"
                    .to_string(),
        };

        let result = transform_static_classes(&file);

        assert_eq!(result.code, file.source);
        assert!(!result.metadata.transformed);
        assert_eq!(result.classes, ["p-4"]);
        assert_eq!(result.diagnostics.len(), 1);
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

        let result = transform_static_classes(&file);

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

        let result = transform_static_classes(&file);

        assert_eq!(
            result.code,
            "const BASE = { p: 4 } as const;\nconst X = ({ big }) => <div className={_sz({ ...BASE, ...(big ? { p: 8 } : {}) })} />;"
        );
        assert!(result.metadata.transformed);
        assert!(result.metadata.uses_runtime);
        assert!(result.classes.is_empty());
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn static_engine_emits_recovery_token() {
        let file = TransformFile {
            filename: "src/App.tsx".to_string(),
            source: "export const App = () => <div szRecover=\"csr\">x</div>;".to_string(),
        };

        let result = transform_static_classes(&file);

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

        let result = transform_static_classes(&file);

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

        let result = transform_static_classes(&file);

        assert_eq!(result.code, file.source);
        assert!(!result.metadata.transformed);
        assert!(result.recovery_tokens.is_empty());
        assert!(result.diagnostics.is_empty());
    }
}
