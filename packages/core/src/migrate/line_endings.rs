//! The line-ending convention of a file, and generated text in that
//! convention.
//!
//! Generated text is written with `\n`; a CRLF file must not end up with two
//! conventions, so each insertion is converted as it lands. Only the inserted
//! text is converted — the lines the pass did not touch are already in the
//! file's own convention.

/// The convention the file's first line break uses: CRLF when the first
/// `\n` follows a `\r`, LF otherwise.
pub fn detect_line_ending(source: &str) -> &'static str {
    match source.find('\n') {
        Some(lf) if lf > 0 && source.as_bytes()[lf - 1] == b'\r' => "\r\n",
        _ => "\n",
    }
}

/// Bare `\n` in generated text rewritten to the file's convention. A `\n`
/// already preceded by `\r` passes through, so a double `\r` cannot appear.
pub fn with_line_ending(text: &str, eol: &str) -> String {
    if eol == "\n" {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len() + 8);
    let mut previous = None;
    for character in text.chars() {
        if character == '\n' && previous != Some('\r') {
            out.push_str(eol);
        } else {
            out.push(character);
        }
        previous = Some(character);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_the_first_break_and_converts_only_bare_breaks() {
        assert_eq!(detect_line_ending("a\r\nb\n"), "\r\n");
        assert_eq!(detect_line_ending("a\nb\r\n"), "\n");
        assert_eq!(detect_line_ending("\nb"), "\n");
        assert_eq!(detect_line_ending("no break"), "\n");
        assert_eq!(with_line_ending("a\nb\r\nc\n", "\r\n"), "a\r\nb\r\nc\r\n");
        assert_eq!(with_line_ending("a\nb", "\n"), "a\nb");
    }
}
