//! Character classes JavaScript defines, for engine code that reads source
//! text or a value the way the JS lanes do.

/// Whether JavaScript's `\s` matches `c`: the `WhiteSpace` and
/// `LineTerminator` productions. That is Unicode White_Space without U+0085
/// (NEL), which Rust's `char::is_whitespace` includes, plus U+FEFF (the
/// byte-order mark), which it does not.
pub const fn is_js_whitespace(c: char) -> bool {
    c == '\u{feff}' || (c.is_whitespace() && c != '\u{85}')
}

/// Where a `class` attribute splits: ASCII whitespace (tab, line feed, form
/// feed, carriage return, space), as a browser splits one and as the runtime's
/// `HTML_CLASS_SPACE` reads it. Migrate reads a class list the DOM applies as
/// written, so a NEL or an NBSP joins two names into one class that styles
/// nothing, and migrating it into sz keys would add styling the page never
/// had. The engine splits an authored `className` it merges `sz` into the
/// same way, so such a class stays one class. An `sz` value is not a class
/// list the DOM reads: it splits on Unicode White_Space. Not [`is_js_whitespace`] either: that set holds a byte-order mark,
/// which would cut a class holding one in two.
pub const fn is_class_space(character: char) -> bool {
    matches!(character, '\t' | '\n' | '\u{000C}' | '\r' | ' ')
}

#[cfg(test)]
mod tests {
    use super::is_js_whitespace;

    /// ECMA-262 `WhiteSpace` (TAB, VT, FF, ZWNBSP, every `Zs`) and
    /// `LineTerminator` (LF, CR, LS, PS), written out from the spec.
    const SPEC: &[char] = &[
        '\t', '\u{b}', '\u{c}', '\u{feff}', ' ', '\u{a0}', '\u{1680}', '\u{2000}', '\u{2001}',
        '\u{2002}', '\u{2003}', '\u{2004}', '\u{2005}', '\u{2006}', '\u{2007}', '\u{2008}',
        '\u{2009}', '\u{200a}', '\u{202f}', '\u{205f}', '\u{3000}', '\n', '\r', '\u{2028}',
        '\u{2029}',
    ];

    #[test]
    fn matches_javascript_whitespace_on_every_code_point() {
        let differing: Vec<char> = (0..=u32::from(char::MAX))
            .filter_map(char::from_u32)
            .filter(|&c| is_js_whitespace(c) != SPEC.contains(&c))
            .collect();
        assert!(differing.is_empty(), "{differing:?}");
    }
}
