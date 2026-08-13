#![doc = "csszyx-core: Performance-critical core for csszyx CSS-in-JS framework"]
#![allow(
    clippy::must_use_candidate,
    clippy::missing_panics_doc,
    clippy::missing_errors_doc,
    clippy::missing_docs_in_private_items,
    clippy::doc_markdown,
    clippy::cast_precision_loss,
    clippy::missing_fields_in_debug,
    clippy::cargo_common_metadata,
    clippy::empty_line_after_doc_comments
)]

/// csszyx-core: Performance-critical core for csszyx CSS-in-JS framework.
///
/// Provides high-performance WASM modules for:
/// - Reversed tier-based encoding (z→y→x→...→a)
/// - Cryptographic token generation (SHA-256)
/// - Dual-hash collision detection for CSS variables
///
/// # Performance
///
/// This Rust/WASM implementation provides 10-15x speedup over pure JavaScript:
/// - Encoding: ~5ns vs ~50ns (10x faster)
/// - Token generation: ~20ns vs ~300ns (15x faster)
/// - Collision detection: ~10ns vs ~80ns (8x faster)
///
/// # Architecture
///
/// The core is compiled to WASM and consumed by TypeScript packages:
/// - `@csszyx/compiler` - Build-time transforms
/// - `@csszyx/runtime` - Runtime helpers
///
/// # Examples
///
/// ```
/// use csszyx_core::{encode, generate_token, WasmCollisionDetector};
///
/// // Encoding (Tier 1: single letter)
/// let id = encode(42);
/// assert_eq!(id, "J");
///
/// // Encoding (Tier 2: letter + digit)
/// let id2 = encode(52);
/// assert_eq!(id2, "z9");
///
/// // Token generation
/// let token = generate_token("Component", "/src/Component.tsx", 42, 8, "csr", "build123");
/// assert_eq!(token.len(), 12);
///
/// // Collision detection
/// let mut detector = WasmCollisionDetector::new();
/// let var1 = detector.add("#ff0000");
/// let var2 = detector.add("#ff0000");
/// assert_eq!(var1, var2);
/// ```

/// Collision detection module for CSS variable name uniqueness.
pub mod collision;

/// Reversed tier-based encoding module for compact class names.
pub mod encoder;

/// Cryptographic token generation module for SSR hydration.
pub mod token;

/// High-performance sz prop transformation module.
pub mod transformer;

/// Native Rust transform contract.
pub mod transform;

/// Mangle map checksum module for SSR/CSR integrity.
pub mod mangle;

/// NAPI entrypoints for the Node-native transform package.
#[cfg(feature = "native")]
pub mod native;

// Re-export main APIs
pub use collision::{compute_dual_hash, CollisionDetector, WasmCollisionDetector};
pub use encoder::encode;
pub use mangle::{compute_checksum_internal, compute_mangle_checksum, verify_mangle_checksum};
pub use token::{generate_token, verify_token, ComponentInfo};
pub use transform::{
    transform_batch, ClassAttributeIr, CssVariableMapEntry, IrError, ParserPath, RecoveryMode,
    RecoveryToken, SourceIr, StaticSzObject, StaticSzProperty, StaticSzValue, SzAttributeIr,
    TextSpan, TransformError, TransformFile, TransformMetadata, TransformOptions,
    TransformProducer, TransformResult,
};
pub use transformer::transform_sz;

use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn error(msg: &str);
}

/// Initializes the WASM module.
///
/// Should be called once before using any functions.
///
/// # Examples
///
/// ```javascript
/// import init, { encode } from 'csszyx-core';
///
/// await init();
/// const id = encode(42);
/// ```
#[allow(clippy::missing_const_for_fn)] // wasm_bindgen(start) doesn't support const
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(target_arch = "wasm32")]
    std::panic::set_hook(Box::new(|info| {
        error(&format!("WASM PANIC: {info}"));
    }));
}

/// Gets the version of csszyx-core.
///
/// # Returns
///
/// Version string
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Whole-file source transform across the WASM boundary.
///
/// One string in, one JSON string out per FILE: crossing the boundary once
/// per file amortises the serde cost that makes the per-object runtime path
/// unviable (measured before this shipped).
///
/// # Errors
///
/// Returns the transform error message when the engine refuses the file.
#[cfg(feature = "native-engine")]
#[wasm_bindgen]
pub fn transform_source(filename: String, source: String) -> Result<String, JsValue> {
    let files = [transform::TransformFile { filename, source }];
    let results =
        transform::transform_batch(&files).map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_json::to_string(&results[0]).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Whole-BATCH transform with full options across the WASM boundary.
///
/// The lane's main entry: cross-module registries, mangling and recovery all
/// arrive through `TransformOptions`, and the batch crosses the boundary once
/// for the whole file set.
///
/// # Errors
///
/// Returns the decode or transform error message.
#[cfg(feature = "native-engine")]
#[wasm_bindgen]
pub fn transform_batch_json(files_json: &str, options_json: &str) -> Result<String, JsValue> {
    let files: Vec<transform::TransformFile> =
        serde_json::from_str(files_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let options: transform::TransformOptions =
        serde_json::from_str(options_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let results = transform::transform_batch_with_options(&files, options)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_json::to_string(&results).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version() {
        init();
        let ver = version();
        assert!(!ver.is_empty());
    }

    #[test]
    fn test_encode_integration() {
        assert_eq!(encode(0), "z");
        assert_eq!(encode(1), "y");
        assert_eq!(encode(51), "A");
    }

    #[test]
    fn test_token_integration() {
        let token = generate_token("Test", "/test.tsx", 1, 1, "csr", "build");
        assert_eq!(token.len(), 12);
        assert!(verify_token(
            &token,
            "Test",
            "/test.tsx",
            1,
            1,
            "csr",
            "build"
        ));
    }

    #[cfg(feature = "native-engine")]
    #[test]
    fn transform_source_crosses_the_boundary_as_json() {
        let json = transform_source(
            "/repo/src/App.tsx".to_string(),
            "export const A = () => <div sz={{ p: 4 }} />;".to_string(),
        )
        .expect("engine is available under native-engine");
        let value: serde_json::Value =
            serde_json::from_str(&json).expect("boundary payload is JSON");
        assert_eq!(
            value["code"].as_str().unwrap(),
            "export const A = () => <div className=\"p-4\" />;"
        );
        assert_eq!(value["classes"][0], "p-4");
    }

    #[cfg(feature = "native-engine")]
    #[test]
    fn transform_batch_json_decodes_options_and_keeps_input_order() {
        let files = r#"[
            {"filename":"/a.tsx","source":"export const A = () => <div sz={{ p: 2 }} />;"},
            {"filename":"/b.tsx","source":"export const B = () => <div className=\"x\" />;"}
        ]"#;
        let options = r#"{"mangle_vars":false,"mangle_var_hoist_max_depth":null,
            "global_var_aliases":[],"root_dir":null,"ast_budget":null,
            "cross_module_statics_json":null,"cross_module_sz_objects_json":null}"#;

        let json = transform_batch_json(files, options).expect("engine is available");
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert_eq!(value.as_array().unwrap().len(), 2);
        assert_eq!(value[0]["classes"][0], "p-2");
        assert_eq!(value[1]["metadata"]["transformed"], false);
    }

    #[test]
    fn test_collision_integration() {
        let mut detector = WasmCollisionDetector::new();
        let var1 = detector.add("#ff0000");
        let var2 = detector.add("#ff0000");
        assert_eq!(var1, var2);
        assert_eq!(detector.count(), 1);
    }
}
