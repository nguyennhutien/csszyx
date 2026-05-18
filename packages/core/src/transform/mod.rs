//! Native Rust transform contract.
//!
//! This module defines the stable Rust-side request/result shape before the
//! parser and napi bindings land. The current implementation is intentionally a
//! scaffold so callers cannot mistake it for a working native transform.

mod contract;
pub(crate) mod fast_path;
mod ir;
#[cfg(feature = "native-engine")]
#[allow(dead_code)]
pub(crate) mod parser;

use fast_path::{triage_source, FastPathTriage};

pub use contract::{
    ParserPath, RecoveryMode, RecoveryToken, TransformFile, TransformMetadata, TransformProducer,
    TransformResult,
};
pub use ir::{
    ClassAttributeIr, IrError, SourceIr, StaticSzObject, StaticSzProperty, StaticSzValue,
    SzAttributeIr, TextSpan,
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

/// Transforms a batch of files with the future native Rust core.
///
/// # Errors
///
/// Returns [`TransformError::NotImplemented`] until the Rust transform engine
/// lands.
#[allow(clippy::missing_const_for_fn)]
pub fn transform_batch(files: &[TransformFile]) -> Result<Vec<TransformResult>, TransformError> {
    let _needs_parser = files
        .iter()
        .any(|file| matches!(triage_source(file), FastPathTriage::NeedsParser(_)));

    Err(TransformError::NotImplemented)
}

#[cfg(test)]
mod tests {
    use super::{transform_batch, TransformError, TransformFile};

    #[test]
    fn transform_batch_is_an_explicit_scaffold() {
        let files = [TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const App = () => <div sz={{ p: 4 }} />;".to_string(),
        }];

        assert_eq!(transform_batch(&files), Err(TransformError::NotImplemented));
    }
}
