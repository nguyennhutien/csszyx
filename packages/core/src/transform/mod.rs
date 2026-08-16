//! Native Rust transform contract.
//!
//! This module defines the stable Rust-side request/result shape shared by the
//! native engine, NAPI bindings, and JavaScript wrapper.

mod contract;
#[cfg(feature = "native-engine")]
pub(crate) mod css_var_hoist_planner;
#[cfg(feature = "native-engine")]
pub(crate) mod css_var_planner;
#[cfg(feature = "native-engine")]
#[allow(dead_code)]
pub(crate) mod engine;
pub(crate) mod fast_path;
pub(crate) mod generated;
#[cfg(feature = "native-engine")]
pub(crate) mod global_var_aliases;
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
#[cfg(feature = "native-engine")]
pub(crate) mod szv_precompile;

#[cfg(not(feature = "native-engine"))]
use fast_path::{triage_source, FastPathTriage};
#[cfg(feature = "native-engine")]
use rayon::prelude::*;

pub use contract::{
    CssVariableMapEntry, GlobalVarAliasEntry, ParserPath, RecoveryMode, RecoveryToken,
    TransformFile, TransformMetadata, TransformOptions, TransformProducer, TransformResult,
    TransformTimings,
};
pub use ir::{
    ClassAttributeIr, DynamicCssVarCategory, DynamicCssVarIr, IrError, JsxOpeningElementIr,
    RecoveryAttributeIr, RemovedSzKeyIr, RuntimeFallbackDiagnosticIr, RuntimeFallbackKindIr,
    SafeStyleSpreadExpressionIr, SafeStyleSpreadIr, SafeStyleSpreadObjectIr,
    SafeStyleSpreadValueIr, SiteFallbackIr, SourceIr, StaticArrayPartIr, StaticSzObject,
    StaticSzProperty, StaticSzValue, StaticTernaryIr, StyleAttributeIr, SzAttributeIr,
    SzFallbackSiteIr, SzrImportRewriteIr, SzsAttributeIr, SzsSlotEntryIr, SzvReplacementIr,
    SzvTableInsertionIr, TextSpan, UnsupportedRecoveryIr,
};

/// Error returned when the Rust transform engine cannot run in this build.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TransformError {
    /// The native transform requires the `native-engine` Cargo feature.
    NotImplemented,
}

impl std::fmt::Display for TransformError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotImplemented => {
                f.write_str("csszyx Rust transform core requires the native-engine feature")
            }
        }
    }
}

impl std::error::Error for TransformError {}

/// Transforms a batch of files with the native Rust core.
///
/// # Errors
///
/// Returns [`TransformError::NotImplemented`] when this crate was built without
/// the native engine feature.
#[allow(clippy::missing_const_for_fn)]
pub fn transform_batch(files: &[TransformFile]) -> Result<Vec<TransformResult>, TransformError> {
    transform_batch_with_options(files, TransformOptions::default())
}

/// Transforms a batch of files with explicit native options.
///
/// # Errors
///
/// Returns [`TransformError::NotImplemented`] when this crate was built without
/// the native engine feature.
#[allow(clippy::missing_const_for_fn, clippy::needless_pass_by_value)]
pub fn transform_batch_with_options(
    files: &[TransformFile],
    options: TransformOptions,
) -> Result<Vec<TransformResult>, TransformError> {
    #[cfg(feature = "native-engine")]
    {
        Ok(files
            .par_iter()
            .map(|file| engine::transform_file_with_options(file, options.clone()))
            .collect())
    }

    #[cfg(not(feature = "native-engine"))]
    {
        let _ = options;
        let _needs_parser = files
            .iter()
            .any(|file| matches!(triage_source(file), FastPathTriage::NeedsParser(_)));
        Err(TransformError::NotImplemented)
    }
}

#[cfg(test)]
mod tests {
    use super::TransformError;
    use super::{transform_batch, TransformFile};

    #[test]
    fn transform_error_has_a_stable_public_message() {
        let error = TransformError::NotImplemented;

        assert_eq!(
            error.to_string(),
            "csszyx Rust transform core requires the native-engine feature"
        );
        assert!(std::error::Error::source(&error).is_none());
    }

    #[cfg(not(feature = "native-engine"))]
    #[test]
    fn transform_batch_requires_native_engine_feature() {
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
