//! Native Rust transform contract.
//!
//! This module defines the stable Rust-side request/result shape before the
//! parser and napi bindings land. The current implementation is intentionally a
//! scaffold so callers cannot mistake it for a working native transform.

mod contract;
#[cfg(feature = "native-engine")]
#[allow(dead_code)]
pub(crate) mod engine;
pub(crate) mod fast_path;
pub(crate) mod generated;
mod ir;
pub mod lower;
#[cfg(feature = "native-engine")]
#[allow(dead_code)]
pub(crate) mod parser;
#[cfg(feature = "native-engine")]
pub(crate) mod recovery;
#[cfg(feature = "native-engine")]
#[allow(dead_code)]
pub(crate) mod rewrite;
#[cfg(feature = "native-engine")]
#[allow(dead_code)]
pub(crate) mod scope;

#[cfg(not(feature = "native-engine"))]
use fast_path::{triage_source, FastPathTriage};
#[cfg(feature = "native-engine")]
use rayon::prelude::*;

pub use contract::{
    ParserPath, RecoveryMode, RecoveryToken, TransformFile, TransformMetadata, TransformProducer,
    TransformResult, TransformTimings,
};
pub use ir::{
    ClassAttributeIr, IrError, JsxOpeningElementIr, RecoveryAttributeIr, SourceIr, StaticSzObject,
    StaticSzProperty, StaticSzValue, StaticTernaryIr, SzAttributeIr, TextSpan,
};

/// Error returned by the Rust transform scaffold.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransformError {
    /// The native transform core has not been implemented yet.
    NotImplemented,
}

impl std::fmt::Display for TransformError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotImplemented => {
                f.write_str("csszyx Rust transform core is not implemented yet")
            }
        }
    }
}

impl std::error::Error for TransformError {}

/// Transforms a batch of files with the native Rust core.
///
/// # Errors
///
/// Returns [`TransformError::NotImplemented`] unless the native engine feature is enabled.
#[allow(clippy::missing_const_for_fn)]
pub fn transform_batch(files: &[TransformFile]) -> Result<Vec<TransformResult>, TransformError> {
    #[cfg(feature = "native-engine")]
    {
        Ok(files.par_iter().map(engine::transform_file).collect())
    }

    #[cfg(not(feature = "native-engine"))]
    {
        let _needs_parser = files
            .iter()
            .any(|file| matches!(triage_source(file), FastPathTriage::NeedsParser(_)));
        Err(TransformError::NotImplemented)
    }
}

#[cfg(test)]
mod tests {
    #[cfg(not(feature = "native-engine"))]
    use super::TransformError;
    use super::{transform_batch, TransformFile};

    #[cfg(not(feature = "native-engine"))]
    #[test]
    fn transform_batch_is_an_explicit_scaffold() {
        let files = [TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const App = () => <div sz={{ p: 4 }} />;".to_string(),
        }];

        assert_eq!(transform_batch(&files), Err(TransformError::NotImplemented));
    }

    #[cfg(feature = "native-engine")]
    #[test]
    fn transform_batch_uses_native_engine_when_enabled() {
        let files = [
            TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source: "const App = () => <div sz={{ p: 4 }} />;".to_string(),
            },
            TransformFile {
                filename: "/repo/src/Plain.tsx".to_string(),
                source: "const Plain = () => <div className=\"x\" />;".to_string(),
            },
        ];

        let results = transform_batch(&files).expect("native engine result");

        assert_eq!(results.len(), 2);
        assert_eq!(
            results[0].code,
            "const App = () => <div className=\"p-4\" />;"
        );
        assert!(results[0].metadata.transformed);
        assert_eq!(results[0].classes, ["p-4"]);
        assert_eq!(results[1].code, files[1].source);
        assert!(!results[1].metadata.transformed);
        assert!(results[1].classes.is_empty());
    }
}
