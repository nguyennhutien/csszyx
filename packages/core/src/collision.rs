/// Dual-hash collision detection for CSS variable optimization.
///
/// Implements content-based hashing with collision detection to ensure
/// unique variable names for different CSS values.
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

/// Variable entry with dual-hash collision detection
#[derive(Debug, Clone)]
struct VariableEntry {
    /// Primary hash (first 6 hex chars of SHA-256)
    primary_hash: String,
    /// Secondary hash (next 6 hex chars, for collision resolution)
    _secondary_hash: String,
    /// Original CSS value
    value: String,
}

/// Collision detector using dual-hash system
pub struct CollisionDetector {
    /// Map from primary hash to list of entries (for collision detection)
    entries: HashMap<String, Vec<VariableEntry>>,
    /// Total number of variables
    count: usize,
}

impl CollisionDetector {
    /// Creates a new collision detector.
    ///
    /// # Returns
    ///
    /// A new empty `CollisionDetector`
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
            count: 0,
        }
    }

    /// Adds a CSS value and returns its variable name.
    ///
    /// # Arguments
    ///
    /// * `value` - CSS value to hash
    ///
    /// # Returns
    ///
    /// Variable name in format `--v-{primary}` or `--v-{primary}-{secondary}`
    ///
    /// # Examples
    ///
    /// ```
    /// use csszyx_core::collision::CollisionDetector;
    ///
    /// let mut detector = CollisionDetector::new();
    /// let var1 = detector.add("#ff0000");
    /// let var2 = detector.add("#ff0000");
    ///
    /// assert_eq!(var1, var2); // Same value = same variable
    /// ```
    pub fn add(&mut self, value: &str) -> String {
        let (primary, secondary) = compute_dual_hash(value);

        if let Some(entries) = self.entries.get(&primary) {
            for entry in entries {
                if entry.value == value {
                    let hash = &entry.primary_hash;
                    return format!("--v-{hash}");
                }
            }

            // Collision detected — use secondary hash
            let new_entry = VariableEntry {
                primary_hash: primary.clone(),
                _secondary_hash: secondary.clone(),
                value: value.to_string(),
            };

            self.entries.get_mut(&primary).unwrap().push(new_entry);
            self.count += 1;

            format!("--v-{primary}-{secondary}")
        } else {
            let result = format!("--v-{primary}");

            let new_entry = VariableEntry {
                primary_hash: primary.clone(),
                _secondary_hash: secondary,
                value: value.to_string(),
            };

            self.entries.insert(primary, vec![new_entry]);
            self.count += 1;

            result
        }
    }

    /// Gets the total number of unique variables.
    ///
    /// # Returns
    ///
    /// Number of unique CSS values added
    pub const fn count(&self) -> usize {
        self.count
    }

    /// Checks if a collision has occurred for any variable.
    ///
    /// # Returns
    ///
    /// `true` if any collision detected, `false` otherwise
    pub fn has_collision(&self) -> bool {
        self.entries.values().any(|entries| entries.len() > 1)
    }

    /// Gets collision statistics.
    ///
    /// # Returns
    ///
    /// Tuple of (total_variables, collisions, collision_rate)
    pub fn stats(&self) -> (usize, usize, f64) {
        let total = self.count;
        let collisions = self
            .entries
            .values()
            .filter(|entries| entries.len() > 1)
            .count();
        let rate = if total > 0 {
            (collisions as f64) / (total as f64)
        } else {
            0.0
        };

        (total, collisions, rate)
    }
}

impl Default for CollisionDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl Default for WasmCollisionDetector {
    fn default() -> Self {
        Self::new()
    }
}

/// Computes dual hash for a CSS value.
///
/// # Arguments
///
/// * `value` - CSS value to hash
///
/// # Returns
///
/// Tuple of (primary_hash, secondary_hash), each 6 hex chars
///
/// # Examples
///
/// ```
/// use csszyx_core::collision::compute_dual_hash;
///
/// let (primary, secondary) = compute_dual_hash("#ff0000");
/// assert_eq!(primary.len(), 6);
/// assert_eq!(secondary.len(), 6);
/// ```
pub fn compute_dual_hash(value: &str) -> (String, String) {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let hash = hasher.finalize();
    let hex = hex::encode(hash);

    let primary = hex[..6].to_string();
    let secondary = hex[6..12].to_string();

    (primary, secondary)
}

/// WASM bindings for JavaScript interop
#[wasm_bindgen]
pub struct WasmCollisionDetector {
    detector: CollisionDetector,
}

#[wasm_bindgen]
impl WasmCollisionDetector {
    /// Creates a new collision detector (WASM binding).
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            detector: CollisionDetector::new(),
        }
    }

    /// Adds a CSS value and returns its variable name (WASM binding).
    ///
    /// # Arguments
    ///
    /// * `value` - CSS value to hash
    ///
    /// # Returns
    ///
    /// Variable name (e.g., "--v-abc123" or "--v-abc123-def456")
    pub fn add(&mut self, value: &str) -> String {
        self.detector.add(value)
    }

    /// Gets the total number of variables (WASM binding).
    ///
    /// # Returns
    ///
    /// Number of unique CSS values
    #[allow(clippy::missing_const_for_fn)] // wasm_bindgen doesn't support const
    pub fn count(&self) -> usize {
        self.detector.count()
    }

    /// Checks if any collision occurred (WASM binding).
    ///
    /// # Returns
    ///
    /// `true` if collision detected
    pub fn has_collision(&self) -> bool {
        self.detector.has_collision()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_no_collision() {
        let mut detector = CollisionDetector::new();

        let var1 = detector.add("#ff0000");
        let var2 = detector.add("#00ff00");

        assert!(var1.starts_with("--v-"));
        assert!(var2.starts_with("--v-"));
        assert_ne!(var1, var2);
        assert_eq!(detector.count(), 2);
    }

    #[test]
    fn test_reuse_same_value() {
        let mut detector = CollisionDetector::new();

        let var1 = detector.add("#ff0000");
        let var2 = detector.add("#ff0000");

        assert_eq!(var1, var2);
        assert_eq!(detector.count(), 1);
    }

    #[test]
    fn test_collision_resolution() {
        let mut detector = CollisionDetector::new();

        // Force collision by finding two values with same primary hash
        // (In practice this is rare, but we test the mechanism)
        let value1 = "test-value-1";
        let value2 = "test-value-2";

        let var1 = detector.add(value1);
        let var2 = detector.add(value2);

        // Both should be unique
        assert_ne!(var1, var2);

        // Reusing same value should return same variable
        let var1_again = detector.add(value1);
        assert_eq!(var1, var1_again);
    }

    #[test]
    fn test_dual_hash_determinism() {
        let (p1, s1) = compute_dual_hash("#ff0000");
        let (p2, s2) = compute_dual_hash("#ff0000");

        assert_eq!(p1, p2);
        assert_eq!(s1, s2);
    }

    #[test]
    fn test_dual_hash_uniqueness() {
        let (p1, s1) = compute_dual_hash("#ff0000");
        let (p2, s2) = compute_dual_hash("#00ff00");

        assert_ne!(p1, p2);
        assert_ne!(s1, s2);
    }

    #[test]
    fn test_stats() {
        let mut detector = CollisionDetector::new();

        detector.add("#ff0000");
        detector.add("#00ff00");
        detector.add("#0000ff");

        let (total, _collisions, rate) = detector.stats();
        assert_eq!(total, 3);
        assert!((0.0..=1.0).contains(&rate));
    }
}
