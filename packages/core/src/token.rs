/// Cryptographic token generation for recovery verification.
///
/// Generates SHA-256 based tokens for securing recovery declarations
/// against tampering and corruption.
use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::*;

/// Component information for token generation
#[derive(Debug, Clone)]
pub struct ComponentInfo {
    /// Component name
    pub name: String,
    /// Absolute file path
    pub path: String,
    /// Line number
    pub line: u32,
    /// Column number
    pub column: u32,
    /// Recovery mode ('csr' or 'dev-only')
    pub mode: String,
    /// Build ID (git hash or timestamp)
    pub build_id: String,
}

/// Generates a cryptographic token for a recovery declaration.
///
/// # Arguments
///
/// * `component` - Component name
/// * `path` - Absolute file path
/// * `line` - Line number in source
/// * `column` - Column number in source
/// * `mode` - Recovery mode ('csr' or 'dev-only')
/// * `build_id` - Build identifier (git hash or timestamp)
///
/// # Returns
///
/// A 12-character Base62 encoded token (first 12 chars of SHA-256 hash)
///
/// # Security
///
/// - Uses SHA-256 for cryptographic strength
/// - Includes source location for uniqueness
/// - Build ID ensures different builds have different tokens
/// - Base62 encoding for URL safety
///
/// # Examples
///
/// ```
/// use csszyx_core::token::generate_token;
///
/// let token = generate_token(
///     "DataTable",
///     "/src/components/DataTable.tsx",
///     42,
///     8,
///     "csr",
///     "abc123def456"
/// );
///
/// assert_eq!(token.len(), 12);
/// ```
#[wasm_bindgen]
pub fn generate_token(
    component: &str,
    path: &str,
    line: u32,
    column: u32,
    mode: &str,
    build_id: &str,
) -> String {
    let info = ComponentInfo {
        name: component.to_string(),
        path: path.to_string(),
        line,
        column,
        mode: mode.to_string(),
        build_id: build_id.to_string(),
    };

    generate_token_from_info(&info)
}

/// Generates token from ComponentInfo struct.
///
/// # Arguments
///
/// * `info` - Component information
///
/// # Returns
///
/// A 12-character Base62 token
pub fn generate_token_from_info(info: &ComponentInfo) -> String {
    // Create deterministic input string
    let input = format!(
        "{}:{}:{}:{}:{}:{}",
        info.name, info.path, info.line, info.column, info.mode, info.build_id
    );

    // Generate SHA-256 hash
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let hash = hasher.finalize();

    // Convert to hex string
    let hex_string = hex::encode(hash);

    // Take first 12 characters and convert to Base62
    hex_to_base62(&hex_string[..24])
}

/// Converts hex string to Base62 encoding.
///
/// # Arguments
///
/// * `hex` - Hex string to convert
///
/// # Returns
///
/// Base62 encoded string (12 characters)
fn hex_to_base62(hex: &str) -> String {
    const BASE62: &str = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

    // Convert hex to u128
    let num = u128::from_str_radix(hex, 16).unwrap_or(0);

    // Convert to Base62
    let mut result = String::new();
    let mut n = num;

    for _ in 0..12 {
        let idx = (n % 62) as usize;
        result.push(BASE62.chars().nth(idx).unwrap());
        n /= 62;
    }

    result.chars().rev().collect()
}

/// Verifies a token against component information.
///
/// # Arguments
///
/// * `token` - Token to verify
/// * `component` - Component name
/// * `path` - File path
/// * `line` - Line number
/// * `column` - Column number
/// * `mode` - Recovery mode
/// * `build_id` - Build identifier
///
/// # Returns
///
/// `true` if token matches, `false` otherwise
#[wasm_bindgen]
pub fn verify_token(
    token: &str,
    component: &str,
    path: &str,
    line: u32,
    column: u32,
    mode: &str,
    build_id: &str,
) -> bool {
    let expected = generate_token(component, path, line, column, mode, build_id);
    token == expected
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_generation() {
        let token = generate_token("Component", "/src/Component.tsx", 42, 8, "csr", "build123");

        assert_eq!(token.len(), 12);
        assert!(token.chars().all(char::is_alphanumeric));
    }

    #[test]
    fn test_token_determinism() {
        let token1 = generate_token("Component", "/src/Component.tsx", 42, 8, "csr", "build123");
        let token2 = generate_token("Component", "/src/Component.tsx", 42, 8, "csr", "build123");

        assert_eq!(token1, token2);
    }

    #[test]
    fn test_token_uniqueness() {
        let token1 = generate_token("ComponentA", "/src/A.tsx", 42, 8, "csr", "build123");
        let token2 = generate_token("ComponentB", "/src/B.tsx", 42, 8, "csr", "build123");

        assert_ne!(token1, token2);
    }

    #[test]
    fn test_different_modes_different_tokens() {
        let token1 = generate_token("Component", "/src/Component.tsx", 42, 8, "csr", "build123");
        let token2 = generate_token(
            "Component",
            "/src/Component.tsx",
            42,
            8,
            "dev-only",
            "build123",
        );

        assert_ne!(token1, token2);
    }

    #[test]
    fn test_different_builds_different_tokens() {
        let token1 = generate_token("Component", "/src/Component.tsx", 42, 8, "csr", "build123");
        let token2 = generate_token("Component", "/src/Component.tsx", 42, 8, "csr", "build456");

        assert_ne!(token1, token2);
    }

    #[test]
    fn test_token_verification() {
        let token = generate_token("Component", "/src/Component.tsx", 42, 8, "csr", "build123");

        assert!(verify_token(
            &token,
            "Component",
            "/src/Component.tsx",
            42,
            8,
            "csr",
            "build123"
        ));

        assert!(!verify_token(
            &token,
            "WrongComponent",
            "/src/Component.tsx",
            42,
            8,
            "csr",
            "build123"
        ));
    }
}
