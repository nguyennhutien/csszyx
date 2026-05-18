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

/// NAPI entrypoints for the future Node-native transform package.
#[cfg(feature = "native")]
pub mod native;

// Re-export main APIs
pub use collision::{compute_dual_hash, CollisionDetector, WasmCollisionDetector};
pub use encoder::encode;
pub use mangle::{compute_checksum_internal, compute_mangle_checksum, verify_mangle_checksum};
pub use token::{generate_token, verify_token, ComponentInfo};
pub use transform::{
    transform_batch, ClassAttributeIr, IrError, ParserPath, RecoveryMode, RecoveryToken, SourceIr,
    StaticSzObject, StaticSzProperty, StaticSzValue, SzAttributeIr, TextSpan, TransformError,
    TransformFile, TransformMetadata, TransformProducer, TransformResult,
};
pub use transformer::transform_sz;

use wasm_bindgen::prelude::*;

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
    // Initialization placeholder - can be extended with panic hooks if needed
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version() {
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

    #[test]
    fn test_collision_integration() {
        let mut detector = WasmCollisionDetector::new();
        let var1 = detector.add("#ff0000");
        let var2 = detector.add("#ff0000");
        assert_eq!(var1, var2);
        assert_eq!(detector.count(), 1);
    }
}
