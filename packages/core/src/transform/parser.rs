use oxc_allocator::Allocator;
use oxc_parser::Parser;
use oxc_span::SourceType;

use super::{SourceIr, TransformFile};

/// Parser shell output before AST walking is implemented.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedSourceShell {
    /// Parser-neutral IR shell for the source file.
    pub ir: SourceIr,
    /// Recoverable parser diagnostics.
    pub diagnostics: Vec<String>,
    /// Whether the parser reported an unrecoverable panic.
    pub panicked: bool,
}

/// Parse a source module with oxc and return an empty IR shell plus diagnostics.
///
/// The AST is intentionally not returned. Future walkers should lower parser
/// nodes into [`SourceIr`] inside this module and keep AST lifetimes private.
pub fn parse_source_shell(file: &TransformFile) -> ParsedSourceShell {
    let allocator = Allocator::default();
    let source_type = source_type_for_path(&file.filename);
    let parsed = Parser::new(&allocator, &file.source, source_type).parse();
    let source_len = u32::try_from(file.source.len()).unwrap_or(u32::MAX);

    ParsedSourceShell {
        ir: SourceIr::empty(file.filename.clone(), source_len),
        diagnostics: parsed
            .errors
            .iter()
            .map(std::string::ToString::to_string)
            .collect(),
        panicked: parsed.panicked,
    }
}

fn source_type_for_path(filename: &str) -> SourceType {
    SourceType::from_path(filename).unwrap_or_else(|_| SourceType::tsx())
}

#[cfg(test)]
mod tests {
    use super::{parse_source_shell, source_type_for_path};
    use crate::transform::TransformFile;

    #[test]
    fn parser_shell_accepts_valid_tsx() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div sz={{ p: 4 }} />;".to_string(),
        };

        let parsed = parse_source_shell(&file);

        assert!(!parsed.panicked);
        assert!(parsed.diagnostics.is_empty());
        assert_eq!(parsed.ir.filename, file.filename);
        assert!(parsed.ir.is_noop());
    }

    #[test]
    fn parser_shell_reports_invalid_tsx() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div sz={{ p: }} />;".to_string(),
        };

        let parsed = parse_source_shell(&file);

        assert!(!parsed.diagnostics.is_empty());
    }

    #[test]
    fn parser_shell_defaults_unknown_extensions_to_tsx() {
        assert!(source_type_for_path("/repo/src/App.unknown").is_jsx());
    }
}
