/// Mangle map checksum generation for SSR/CSR integrity verification.
///
/// This module provides cryptographic checksums for mangle maps to ensure
/// that the client-side and server-side mangle maps are identical, preventing
/// hydration mismatches in SSR applications.
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

/// Mangle map type: original class name -> mangled class name
pub type MangleMap = HashMap<String, String>;

/// Computes a deterministic SHA-256 checksum for a mangle map.
///
/// The checksum is designed to be:
/// 1. **Deterministic**: Same map always produces same checksum
/// 2. **Collision-resistant**: Different maps produce different checksums
/// 3. **Compact**: 16-character hex string (64 bits of SHA-256)
///
/// # Algorithm
///
/// 1. Sort all entries by original class name (determinism)
/// 2. Create canonical string: "<len>:<orig>:<len>:<mangle>|..." — the lengths
///    keep it decodable one way only, because a class name can hold a colon
/// 3. Compute SHA-256 hash
/// 4. Take first 16 hex characters (64 bits, ~1.8e19 possible values)
///
/// # Arguments
///
/// * `map` - The mangle map to checksum
///
/// # Returns
///
/// A 16-character hex string checksum
///
/// # Performance
///
/// - Time complexity: O(n log n) for sorting + O(n) for hashing
/// - Space complexity: O(n) for canonical string
/// - Typical runtime: ~10-50µs for 1000 entries (10-15x faster than JS)
///
/// # Security
///
/// While we only use 64 bits of SHA-256, this provides sufficient collision
/// resistance for our use case (detecting accidental mismatches, not
/// cryptographic attacks). Birthday paradox gives us ~4 billion hashes
/// before 50% collision probability.
///
/// # Examples
///
/// ```ignore
/// // This function is wasm_bindgen — call from JS, not Rust directly.
/// // Use compute_checksum_internal() for pure-Rust usage.
/// let checksum = compute_mangle_checksum(js_map);
/// ```
// Native LLVM coverage cannot execute a JsValue boundary. This adapter is
// exercised through pkg-node in tests/integration.test.ts.
// coverage:wasm-only:start
#[wasm_bindgen]
pub fn compute_mangle_checksum(map: JsValue) -> Result<String, JsValue> {
    // Deserialize JavaScript object to HashMap
    let mangle_map: MangleMap = serde_wasm_bindgen::from_value(map)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse mangle map: {e}")))?;

    Ok(compute_checksum_internal(&mangle_map))
}
// coverage:wasm-only:end

/// Internal checksum computation (native Rust, no WASM overhead).
///
/// # Arguments
///
/// * `map` - The mangle map to checksum
///
/// # Returns
///
/// A 16-character hex string checksum
pub fn compute_checksum_internal(map: &MangleMap) -> String {
    // Step 1: Collect and sort entries for determinism
    let mut entries: Vec<(&String, &String)> = map.iter().collect();
    entries.sort_by(|a, b| a.0.cmp(b.0));

    // Step 2: Create canonical string representation.
    //
    // Format: "<origLen>:<orig>:<mangleLen>:<mangle>" per entry, joined by "|".
    //
    // The lengths are what make the form injective, and they are not
    // decoration. Class names carry the separators: every variant class has a
    // colon in it, and arbitrary content can carry a pipe. Without lengths,
    // {"a:b": "c"} and {"a": "b:c"} both render "a:b:c" and hash the same, so
    // two different maps share a checksum. With them, a reader knows exactly
    // how far the name runs and the form can be decoded one way only.
    //
    // Lengths count UTF-16 code units, which JavaScript reads for free off
    // `String.prototype.length`. Counting them here costs a pass over a string
    // this build already holds, and the browser is the side worth sparing.
    let canonical = entries
        .iter()
        .map(|(orig, mangled)| {
            format!(
                "{}:{orig}:{}:{mangled}",
                orig.encode_utf16().count(),
                mangled.encode_utf16().count()
            )
        })
        .collect::<Vec<_>>()
        .join("|");

    // Step 3: Compute SHA-256 hash
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    let hash = hasher.finalize();

    // Step 4: Convert to hex and take first 16 characters (64 bits)
    let hex_full = hex::encode(hash);
    hex_full[..16].to_string()
}

/// Verifies a checksum against a mangle map.
///
/// # Arguments
///
/// * `map` - The mangle map to verify
/// * `expected_checksum` - The expected checksum
///
/// # Returns
///
/// `true` if checksum matches, `false` otherwise
///
/// # Examples
///
/// ```
/// use csszyx_core::mangle::{compute_checksum_internal, verify_checksum_internal, MangleMap};
/// use std::collections::HashMap;
///
/// let mut map = HashMap::new();
/// map.insert("p-4".to_string(), "a".to_string());
///
/// let checksum = compute_checksum_internal(&map);
/// assert!(verify_checksum_internal(&map, &checksum));
/// assert!(!verify_checksum_internal(&map, "invalid"));
/// ```
pub fn verify_checksum_internal(map: &MangleMap, expected_checksum: &str) -> bool {
    let actual = compute_checksum_internal(map);
    actual == expected_checksum
}

/// WASM-exposed checksum verification.
///
/// # Arguments
///
/// * `map` - JavaScript object representing the mangle map
/// * `expected_checksum` - The expected checksum string
///
/// # Returns
///
/// `true` if checksum matches, `false` otherwise
// Native LLVM coverage cannot execute a JsValue boundary. This adapter is
// exercised through pkg-node in tests/integration.test.ts.
// coverage:wasm-only:start
#[wasm_bindgen]
pub fn verify_mangle_checksum(map: JsValue, expected_checksum: &str) -> Result<bool, JsValue> {
    let mangle_map: MangleMap = serde_wasm_bindgen::from_value(map)
        .map_err(|e| JsValue::from_str(&format!("Failed to parse mangle map: {e}")))?;

    Ok(verify_checksum_internal(&mangle_map, expected_checksum))
}
// coverage:wasm-only:end

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_map() {
        let map = HashMap::new();
        let checksum = compute_checksum_internal(&map);
        assert_eq!(checksum.len(), 16);
    }

    #[test]
    fn test_determinism() {
        let mut map = HashMap::new();
        map.insert("p-4".to_string(), "z".to_string());
        map.insert("m-2".to_string(), "y".to_string());

        let checksum1 = compute_checksum_internal(&map);
        let checksum2 = compute_checksum_internal(&map);

        assert_eq!(checksum1, checksum2);
    }

    #[test]
    fn test_order_independence() {
        let mut map1 = HashMap::new();
        map1.insert("p-4".to_string(), "z".to_string());
        map1.insert("m-2".to_string(), "y".to_string());

        let mut map2 = HashMap::new();
        map2.insert("m-2".to_string(), "y".to_string());
        map2.insert("p-4".to_string(), "z".to_string());

        let checksum1 = compute_checksum_internal(&map1);
        let checksum2 = compute_checksum_internal(&map2);

        assert_eq!(checksum1, checksum2);
    }

    #[test]
    fn test_different_maps_different_checksums() {
        let mut map1 = HashMap::new();
        map1.insert("p-4".to_string(), "z".to_string());

        let mut map2 = HashMap::new();
        map2.insert("m-2".to_string(), "y".to_string());

        let checksum1 = compute_checksum_internal(&map1);
        let checksum2 = compute_checksum_internal(&map2);

        assert_ne!(checksum1, checksum2);
    }

    #[test]
    fn test_value_change_changes_checksum() {
        let mut map1 = HashMap::new();
        map1.insert("p-4".to_string(), "z".to_string());

        let mut map2 = HashMap::new();
        map2.insert("p-4".to_string(), "y".to_string());

        let checksum1 = compute_checksum_internal(&map1);
        let checksum2 = compute_checksum_internal(&map2);

        assert_ne!(checksum1, checksum2);
    }

    #[test]
    fn test_verification() {
        let mut map = HashMap::new();
        map.insert("p-4".to_string(), "z".to_string());

        let checksum = compute_checksum_internal(&map);

        assert!(verify_checksum_internal(&map, &checksum));
        assert!(!verify_checksum_internal(&map, "invalid"));
    }

    #[test]
    fn test_large_map_performance() {
        let mut map = HashMap::new();
        for i in 0..1000 {
            map.insert(format!("class-{i}"), format!("{i}"));
        }

        let start = std::time::Instant::now();
        let checksum = compute_checksum_internal(&map);
        let elapsed = start.elapsed();

        assert_eq!(checksum.len(), 16);
        // Loose ceiling only — guards against accidental quadratic blowup, not
        // real performance (typically <5ms in debug builds). A tight wall-clock
        // bound is flaky on loaded CI runners.
        assert!(elapsed.as_millis() < 500);
    }

    /// Two different maps must not share a checksum just because a class name
    /// carries the character the canonical form separates fields with. Every
    /// variant class does: `hover:bg-red-500` is a name with a colon in it.
    #[test]
    fn a_name_carrying_a_separator_does_not_collide_with_a_value_carrying_it() {
        let colon_in_key: MangleMap = [("a:b".to_string(), "c".to_string())].into();
        let colon_in_value: MangleMap = [("a".to_string(), "b:c".to_string())].into();
        assert_ne!(
            compute_checksum_internal(&colon_in_key),
            compute_checksum_internal(&colon_in_value)
        );

        let pipe_in_key: MangleMap = [("a|b".to_string(), "c".to_string())].into();
        let two_entries: MangleMap = [
            ("a".to_string(), "b".to_string()),
            ("c".to_string(), "d".to_string()),
        ]
        .into();
        assert_ne!(
            compute_checksum_internal(&pipe_in_key),
            compute_checksum_internal(&two_entries)
        );
    }

    /// A real variant class still checksums, and still answers the same thing
    /// every time — the separator fix must not cost determinism.
    #[test]
    fn a_variant_class_checksums_the_same_way_twice() {
        let map: MangleMap = [
            ("hover:bg-red-500".to_string(), "a".to_string()),
            ("md:focus:ring-2".to_string(), "b".to_string()),
        ]
        .into();
        assert_eq!(
            compute_checksum_internal(&map),
            compute_checksum_internal(&map)
        );
        assert_eq!(compute_checksum_internal(&map).len(), 16);
    }
}
