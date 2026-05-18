//! Native transform recovery-token helpers.

use sha2::{Digest, Sha256};

/// Deterministic inline recovery token matching the TypeScript compiler helper.
pub fn generate_inline_recovery_token(
    filename: &str,
    line: u32,
    column: u32,
    element_type: &str,
) -> String {
    let input = format!("{filename}:{line}:{column}:{element_type}");
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize()).chars().take(12).collect()
}

/// Convert a byte offset into 1-based line and 0-based column.
pub fn offset_to_line_column(source: &str, offset: u32) -> (u32, u32) {
    let end = usize::try_from(offset)
        .ok()
        .map_or(source.len(), |offset| offset.min(source.len()));
    let mut line = 1;
    let mut column = 0;

    for byte in source[..end].bytes() {
        if byte == b'\n' {
            line += 1;
            column = 0;
        } else {
            column += 1;
        }
    }

    (line, column)
}

#[cfg(test)]
mod tests {
    use super::{generate_inline_recovery_token, offset_to_line_column};

    #[test]
    fn inline_recovery_token_matches_compiler_contract_shape() {
        let token = generate_inline_recovery_token("src/App.tsx", 10, 4, "div");

        assert_eq!(token.len(), 12);
        assert!(token.chars().all(|ch| ch.is_ascii_hexdigit()));
        assert_eq!(
            token,
            generate_inline_recovery_token("src/App.tsx", 10, 4, "div")
        );
        assert_ne!(
            token,
            generate_inline_recovery_token("src/App.tsx", 10, 5, "div")
        );
    }

    #[test]
    fn offset_to_line_column_uses_compiler_indexing() {
        assert_eq!(offset_to_line_column("a\n  <div />", 4), (2, 2));
    }
}
