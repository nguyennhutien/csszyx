//! Native transform engine assembly.
//!
//! This module connects parser output, class lowering, and the public transform
//! result contract without enabling source rewrite yet.

use super::{
    lower::lower_source_ir_classes, parser::parse_source_shell, ParserPath, TransformFile,
    TransformMetadata, TransformProducer, TransformResult,
};

/// Parse and lower a file into the native transform result shape without
/// mutating source code.
pub(super) fn transform_static_classes(file: &TransformFile) -> TransformResult {
    let parsed = parse_source_shell(file);
    let lowered = lower_source_ir_classes(&parsed.ir);
    let mut diagnostics = parsed.diagnostics;

    if parsed.panicked {
        diagnostics.push("oxc parser panicked before csszyx lowering completed".to_string());
    }

    TransformResult {
        code: file.source.clone(),
        map: None,
        classes: lowered.classes,
        raw_class_names: lowered.raw_class_names,
        diagnostics,
        recovery_tokens: Vec::new(),
        metadata: TransformMetadata {
            transformed: false,
            uses_runtime: false,
            uses_merge: false,
            uses_color_var: false,
            producer: TransformProducer::Rust,
            ast_budget_exceeded: false,
        },
        parser_path: ParserPath::Static,
    }
}

#[cfg(test)]
mod tests {
    use super::transform_static_classes;
    use crate::transform::{ParserPath, TransformFile, TransformProducer};

    #[test]
    fn static_engine_collects_classes_without_rewriting_source() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div className=\"block\" sz={{ start: 4, hover: { bg: 'red-500' } }} />;"
                .to_string(),
        };

        let result = transform_static_classes(&file);

        assert_eq!(result.code, file.source);
        assert!(!result.metadata.transformed);
        assert_eq!(result.metadata.producer, TransformProducer::Rust);
        assert_eq!(result.parser_path, ParserPath::Static);
        assert_eq!(result.classes, ["inset-s-4", "hover:bg-red-500"]);
        assert_eq!(result.raw_class_names, ["block"]);
        assert!(result.diagnostics.is_empty());
        assert!(result.recovery_tokens.is_empty());
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
}
