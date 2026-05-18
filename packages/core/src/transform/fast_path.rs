use super::{SourceIr, TransformFile};

/// Conservative parser triage result for a source file.
#[derive(Debug, Clone, PartialEq)]
pub enum FastPathTriage {
    /// The file cannot affect csszyx transform output and can skip parsing.
    Noop(SourceIr),
    /// The file contains a possible csszyx marker and must use the parser path.
    NeedsParser(FastPathBailout),
}

/// Reason a source file could not use the AST-free path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FastPathBailout {
    /// Source filename.
    pub filename: String,
    /// Conservative reason.
    pub reason: FastPathBailoutReason,
}

/// Conservative fast-path bailout reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FastPathBailoutReason {
    /// Source contains the `sz` marker somewhere. It may be a prop, local name,
    /// comment, or string; the parser owns that distinction.
    ContainsSzMarker,
}

/// Triage a source file before invoking a parser.
///
/// This only accepts the zero-risk no-`sz` path. Every source that contains the
/// marker falls through to the parser, including comments and strings.
pub fn triage_source(file: &TransformFile) -> FastPathTriage {
    if file.source.contains("sz") {
        return FastPathTriage::NeedsParser(FastPathBailout {
            filename: file.filename.clone(),
            reason: FastPathBailoutReason::ContainsSzMarker,
        });
    }

    let source_len = u32::try_from(file.source.len()).unwrap_or(u32::MAX);
    FastPathTriage::Noop(SourceIr::empty(file.filename.clone(), source_len))
}

#[cfg(test)]
mod tests {
    use super::{triage_source, FastPathBailoutReason, FastPathTriage};
    use crate::transform::TransformFile;

    #[test]
    fn source_without_sz_is_noop_without_parse() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div className=\"p-4\" />;".to_string(),
        };

        let FastPathTriage::Noop(ir) = triage_source(&file) else {
            panic!("expected no-op fast path");
        };

        assert_eq!(ir.filename, file.filename);
        assert_eq!(
            ir.source_span.len(),
            u32::try_from(file.source.len()).expect("fixture length fits u32")
        );
        assert!(ir.is_noop());
    }

    #[test]
    fn source_with_sz_prop_bails_to_parser() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div sz={{ p: 4 }} />;".to_string(),
        };

        assert_eq!(
            triage_source(&file),
            FastPathTriage::NeedsParser(super::FastPathBailout {
                filename: file.filename,
                reason: FastPathBailoutReason::ContainsSzMarker,
            })
        );
    }

    #[test]
    fn source_with_sz_in_comment_still_bails_to_parser() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "/* sz={{ p: 4 }} */ export const App = () => <div />;".to_string(),
        };

        assert!(matches!(
            triage_source(&file),
            FastPathTriage::NeedsParser(super::FastPathBailout {
                reason: FastPathBailoutReason::ContainsSzMarker,
                ..
            })
        ));
    }
}
