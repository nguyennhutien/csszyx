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
#[cfg(any(feature = "native-engine", feature = "migrate"))]
pub const fn is_class_space(character: char) -> bool {
    matches!(character, '\t' | '\n' | '\u{000C}' | '\r' | ' ')
}

/// Whether `c` continues a longer attribute name: Alphabetic or Numeric
/// (`char::is_alphanumeric`, the set the `TypeScript` reader names as
/// `\p{Alphabetic}\p{N}`), `_`, `$`, the joiners ZWNJ and ZWJ, or the `-`
/// JSX names allow (`data-sz`, `xsz`). Not `:`: Vue binds an attribute as
/// `:sz` or `v-bind:sz`, and that is still `sz`.
fn is_jsx_name_char(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '$' | '-' | '\u{200c}' | '\u{200d}')
}

/// Whether the text at `at` starts a JSX attribute name rather than
/// continuing a longer one: `sz` in `<i sz` and `}sz` does, in `data-sz`
/// and `xsz` it does not.
pub fn starts_jsx_name(text: &str, at: usize) -> bool {
    !text[..at].chars().next_back().is_some_and(is_jsx_name_char)
}

/// Each JSX attribute named `name` in `text`, as `(start, value)`: where the
/// name starts and where its value starts. JSX allows JavaScript whitespace
/// on both sides of the `=` (`sz = {{…}}`), and a value is a `{…}`
/// expression, a string or an element, so it opens with `{`, `"`, `'` or
/// `<`; that keeps `sz == x` and `const sz = 1` out. A comment may sit
/// before the value (`sz=/* c */"p-4"`), so `/` counts as an opener too: no
/// JSX value starts with one, and reading one too many costs a parse.
///
/// A text scan, not a parse: an attribute spelled inside a string or a
/// comment counts too. Every caller gates or bails on the answer, where a
/// match too many costs one file the parser and a match too few ships it
/// unlowered, so the scan errs toward matching. `TypeScript`'s
/// `jsxAttributes` in `@csszyx/tailwind-oracle` reads the same way, held to
/// it by `tests/fixtures/jsx-attribute-cases.json`.
///
/// `n` = `text.len()`, `m` = `name.len()`: `match_indices` finds each
/// occurrence in O(n + m) (Two-Way), and each is checked in O(1) plus the
/// whitespace it skips. Total on any `&str`. `memchr::memmem` measured ten
/// times faster on 1.76 MB of this repo's sources (0.25 ms against 2.4 ms)
/// but added 1,457 gzip bytes to the wasm artifact, for about 0.01 ms a file.
pub fn jsx_attributes<'a>(
    text: &'a str,
    name: &'a str,
) -> impl Iterator<Item = (usize, usize)> + 'a {
    text.match_indices(name).filter_map(move |(start, _)| {
        if !starts_jsx_name(text, start) {
            return None;
        }
        let value = text[start + name.len()..]
            .trim_start_matches(is_js_whitespace)
            .strip_prefix('=')?
            .trim_start_matches(is_js_whitespace);
        value
            .starts_with(['{', '"', '\'', '<', '/'])
            .then(|| (start, text.len() - value.len()))
    })
}

/// Whether `text` holds a JSX attribute named `name` ([`jsx_attributes`]).
pub fn has_jsx_attribute(text: &str, name: &str) -> bool {
    jsx_attributes(text, name).next().is_some()
}

#[cfg(test)]
mod tests {
    use super::{is_js_whitespace, jsx_attributes};

    /// The cases the `TypeScript` reader runs too.
    #[test]
    fn finds_the_attributes_the_shared_cases_name() {
        let cases: Vec<serde_json::Value> =
            serde_json::from_str(include_str!("../tests/fixtures/jsx-attribute-cases.json"))
                .expect("cases parse");
        for case in cases {
            let text = case["text"].as_str().expect("text");
            let name = case["name"].as_str().expect("name");
            let want: Vec<(usize, usize)> = case["found"]
                .as_array()
                .expect("found")
                .iter()
                .map(|pair| {
                    let at = |i: usize| {
                        usize::try_from(pair[i].as_u64().expect("offset")).expect("usize")
                    };
                    (at(0), at(1))
                })
                .collect();
            // The fixture counts UTF-16 units, as JavaScript does.
            let utf16 = |byte: usize| text[..byte].encode_utf16().count();
            let got: Vec<(usize, usize)> = jsx_attributes(text, name)
                .map(|(start, value)| (utf16(start), utf16(value)))
                .collect();
            assert_eq!(got, want, "{name} in {text:?}");
        }
    }

    /// The scan steps once per occurrence, so a text of nothing but the name
    /// is linear: four times the text, about four times the steps.
    #[test]
    fn walks_a_text_of_nothing_but_the_name_in_one_pass() {
        let text = "sz".repeat(200_000);
        assert_eq!(jsx_attributes(&text, "sz").count(), 0);
        let found = format!("{} sz={{}}", "sz".repeat(200_000));
        assert_eq!(jsx_attributes(&found, "sz").count(), 1);
    }

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
