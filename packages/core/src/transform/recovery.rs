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

/// Clamp a byte offset into the source, saturating past the end.
fn clamp_offset(source: &str, offset: u32) -> usize {
    usize::try_from(offset)
        .ok()
        .map_or(source.len(), |offset| offset.min(source.len()))
}

/// Byte offset of every line start, for position lookups.
///
/// Diagnostics and recovery tokens arrive in batches: one file can emit an
/// unknown key, a dead spacing step and a property-object warning per `sz`
/// attribute, and a token for every `szRecover` element. Scanning the source
/// before each position made that `O(k·n)` for `k` positions in `n` bytes:
/// 160 ms for the 3000 elements a file still under the AST budget can hold,
/// which only a file built to hold them reaches. The table costs one pass,
/// `O(n)`, and each lookup a binary search over the `L` lines,
/// `O(log L)`: `O(n + k log L)` for the file. Worst case for the table is a
/// source of only newlines, one entry per byte.
///
/// Construct it lazily, through [`SourceLines`]: a file that emits no
/// position must not pay for a table nobody reads, so that the diagnostic
/// machinery costs nothing when it finds nothing. Both engine artifacts,
/// native and wasm, place through it.
pub struct LineIndex {
    /// Byte offset where each line begins; always starts with 0.
    starts: Vec<u32>,
}

impl LineIndex {
    /// Build the table with a single pass over the source.
    ///
    /// # Arguments
    /// * `source` - Full source text the offsets refer to.
    pub fn new(source: &str) -> Self {
        let mut starts = vec![0u32];
        for (index, byte) in source.bytes().enumerate() {
            if byte == b'\n' {
                // A line starts after the newline; saturate rather than wrap on
                // sources beyond u32 (the parser rejects those far earlier).
                starts.push(u32::try_from(index + 1).unwrap_or(u32::MAX));
            }
        }
        Self { starts }
    }

    /// Resolve a byte offset to 1-based line and 0-based column.
    ///
    /// # Arguments
    /// * `source` - The same source the table was built from.
    /// * `offset` - Byte offset to resolve.
    pub fn line_column(&self, source: &str, offset: u32) -> (u32, u32) {
        let clamped = u32::try_from(clamp_offset(source, offset)).unwrap_or(u32::MAX);
        // `partition_point` gives the count of starts at or before the offset;
        // that count minus one is the containing line's index. `starts` always
        // holds a leading 0, so the subtraction cannot underflow.
        let line_index = self.starts.partition_point(|start| *start <= clamped) - 1;
        (
            u32::try_from(line_index + 1).unwrap_or(u32::MAX),
            clamped - self.starts[line_index],
        )
    }
}

/// One source and its [`LineIndex`], built on the first position asked for.
///
/// Every caller that places several positions in one file goes through this,
/// so the table is built at most once per file and never for a file that
/// places none.
pub struct SourceLines<'s> {
    source: &'s str,
    index: Option<LineIndex>,
}

impl<'s> SourceLines<'s> {
    /// Lines of `source`, not yet indexed.
    pub const fn new(source: &'s str) -> Self {
        Self {
            source,
            index: None,
        }
    }

    /// 1-based line and 0-based byte column of `offset`, clamped to the end.
    pub fn line_column(&mut self, offset: u32) -> (u32, u32) {
        let source = self.source;
        self.index
            .get_or_insert_with(|| LineIndex::new(source))
            .line_column(source, offset)
    }
}

#[cfg(test)]
mod tests {
    use super::{clamp_offset, generate_inline_recovery_token, LineIndex};

    /// The scanning form the table replaced, kept as the table's oracle:
    /// 1-based line and 0-based byte column, counted from the start.
    fn offset_to_line_column(source: &str, offset: u32) -> (u32, u32) {
        let end = clamp_offset(source, offset);
        let mut line = 1;
        let mut column = 0;
        for byte in source.bytes().take(end) {
            if byte == b'\n' {
                line += 1;
                column = 0;
            } else {
                column += 1;
            }
        }
        (line, column)
    }

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
    fn line_index_uses_compiler_indexing() {
        let source = "a\n  <div />";
        assert_eq!(LineIndex::new(source).line_column(source, 4), (2, 2));
    }

    #[test]
    fn line_index_agrees_with_the_scanning_form_at_every_offset() {
        // The table replaces the scan wherever several positions are resolved,
        // so the two must be indistinguishable — including at the newline
        // itself, at line starts, and past the end of the source.
        let sources = [
            "",
            "\n",
            "a",
            "a\n  <div />",
            "\n\n\nx",
            "one\ntwo\n\nfour\n",
            "trailing newline\n",
            "no trailing newline",
            "multi\u{00e9}byte \u{4f60}\u{597d}\nsecond line",
        ];
        for source in sources {
            let index = LineIndex::new(source);
            // `len + 2` so clamping past the end is covered as well.
            let past_end = u32::try_from(source.len()).expect("test source fits in u32") + 2;
            for offset in 0..=past_end {
                assert_eq!(
                    index.line_column(source, offset),
                    offset_to_line_column(source, offset),
                    "source {source:?} offset {offset}"
                );
            }
        }
    }

    #[test]
    fn line_index_resolves_positions_on_the_last_line() {
        let source = "first\nsecond\nthird";
        let index = LineIndex::new(source);

        assert_eq!(index.line_column(source, 0), (1, 0));
        assert_eq!(index.line_column(source, 6), (2, 0));
        assert_eq!(index.line_column(source, 13), (3, 0));
        assert_eq!(index.line_column(source, 17), (3, 4));
    }
}
