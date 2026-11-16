//! The value of a JSX attribute string as the JSX transform reads it.
//!
//! oxc keeps the source text of a JSX attribute string and decodes no
//! character reference, while every JSX transform that later compiles the
//! module does: `<div sz="p-4&#32;m-2" />` renders `class="p-4 m-2"`. Classes
//! read from the source text would be `p-4&#32;m-2`, which no stylesheet
//! serves. The decoding here is oxc's own (`oxc_syntax::xml_entities`), the one
//! its JSX transform uses, ported from TypeScript's.
//!
//! `n` = the attribute's length. One pass over it, and only when it holds `&`;
//! a string without one is returned borrowed.

use std::borrow::Cow;

use oxc_allocator::Allocator;
use oxc_str::{JSStr, JSStrBuilder};
use oxc_syntax::xml_entities::decode_entities;

/// What JSX reads from an attribute string.
enum JsxRead {
    /// The text as written.
    AsWritten,
    /// Other text, all of it valid UTF-8.
    Text(String),
    /// Other text holding a lone surrogate, which a `str` cannot: each one
    /// is spelled as the reference `&#xHHHH;`.
    LoneSurrogate(String),
}

/// Read `raw` as JSX does.
fn jsx_read(raw: &str) -> JsxRead {
    if !raw.contains('&') {
        return JsxRead::AsWritten;
    }
    let allocator = Allocator::default();
    let mut decoded = None;
    decode_entities(raw, &mut decoded, raw.len(), &allocator);
    let Some(text) = decoded.map(JSStrBuilder::into_js_str) else {
        return JsxRead::AsWritten;
    };
    match text.as_str() {
        Some(text) if text == raw => JsxRead::AsWritten,
        Some(text) => JsxRead::Text(text.to_owned()),
        None => JsxRead::LoneSurrogate(spell_lone_surrogates(text, raw.len())),
    }
}

/// `text` with each lone surrogate written as `&#xHHHH;`.
fn spell_lone_surrogates(text: JSStr<'_>, capacity: usize) -> String {
    let mut spelled = String::with_capacity(capacity);
    for character in text.chars() {
        if let Some(character) = character.to_char() {
            spelled.push(character);
            continue;
        }
        let unit = character.to_u32();
        spelled.push_str("&#x");
        for shift in [12, 8, 4, 0] {
            let digit = char::from_digit((unit >> shift) & 0xF, 16);
            spelled.push(digit.map_or('0', |digit| digit.to_ascii_uppercase()));
        }
        spelled.push(';');
    }
    spelled
}

/// The text JSX reads from an attribute string written as `raw`.
///
/// A reference to a lone surrogate (`&#xD800;`) is kept as `&#xD800;`, one
/// reference at a time, as oxc keeps a name it does not know: no class can
/// carry a lone surrogate, and every other reference in the string is still
/// decoded.
pub fn decode_jsx_attribute_text(raw: &str) -> Cow<'_, str> {
    let text = match jsx_read(raw) {
        JsxRead::AsWritten => return Cow::Borrowed(raw),
        JsxRead::Text(text) | JsxRead::LoneSurrogate(text) => text,
    };
    if text == raw {
        Cow::Borrowed(raw)
    } else {
        Cow::Owned(text)
    }
}

/// Whether `text` can be written between the quotes of a JSX attribute string
/// and read back unchanged: no `"` to end it early, nothing JSX would decode,
/// and no control character, which a JavaScript string spells as an escape.
pub fn fits_jsx_attribute_string(text: &str) -> bool {
    !text.contains('"')
        && !text.chars().any(char::is_control)
        && matches!(jsx_read(text), JsxRead::AsWritten)
}

#[cfg(test)]
mod tests {
    use super::{decode_jsx_attribute_text, fits_jsx_attribute_string};

    #[test]
    fn decodes_numeric_and_named_references() {
        assert_eq!(decode_jsx_attribute_text("p-4&#32;m-2"), "p-4 m-2");
        assert_eq!(decode_jsx_attribute_text("p-4&#x20;m-2"), "p-4 m-2");
        assert_eq!(decode_jsx_attribute_text("a&quot;b&amp;c"), "a\"b&c");
        assert_eq!(decode_jsx_attribute_text("&amp;lt;"), "&lt;");
        assert_eq!(decode_jsx_attribute_text("&#xD83D;&#xDE00;"), "\u{1F600}");
    }

    #[test]
    fn leaves_what_jsx_leaves() {
        assert_eq!(decode_jsx_attribute_text("p-4 m-2"), "p-4 m-2");
        assert_eq!(decode_jsx_attribute_text("[&_p]:m-2"), "[&_p]:m-2");
        assert_eq!(decode_jsx_attribute_text("a&bogus;b"), "a&bogus;b");
        assert_eq!(decode_jsx_attribute_text(""), "");
    }

    /// A lone surrogate stays a reference; the rest of the string decodes.
    #[test]
    fn keeps_a_lone_surrogate_reference_and_decodes_the_rest() {
        assert_eq!(decode_jsx_attribute_text("a&#xD800;b"), "a&#xD800;b");
        assert_eq!(
            decode_jsx_attribute_text("a&#xD800;b p-4&#32;m-2"),
            "a&#xD800;b p-4 m-2"
        );
        assert_eq!(decode_jsx_attribute_text("&#55296;&#32;x"), "&#xD800; x");
    }

    #[test]
    fn an_attribute_string_holds_only_what_reads_back_the_same() {
        assert!(fits_jsx_attribute_string("p-4 m-2"));
        assert!(fits_jsx_attribute_string("[&_p]:m-2"));
        assert!(fits_jsx_attribute_string("a&bogus;b"));
        assert!(fits_jsx_attribute_string("x\u{a0}y"));
        assert!(!fits_jsx_attribute_string("content-['&lt;']"));
        assert!(!fits_jsx_attribute_string("content-[\"x\"]"));
        assert!(!fits_jsx_attribute_string("p-4 &#xD800; content-[&lt;]"));
        // Decoding keeps this text as written, yet JSX reads a lone surrogate.
        assert!(!fits_jsx_attribute_string("a&#xD800;b"));
        assert!(!fits_jsx_attribute_string("\u{1b}p-4"));
    }

    /// Decoding is total and never grows the text: a reference is longer than
    /// what it stands for, an unknown one is kept as written, and a lone
    /// surrogate is spelled as the shortest reference to it.
    #[test]
    fn is_total_and_never_longer() {
        const ALPHABET: [&str; 14] = [
            "&", "#", "x", ";", "3", "2", "a", "m", "p", " ", "q", "\u{e9}", "D800", "55296",
        ];
        let mut rng = crate::transform::test_rng::Rng::new(0x5eed_0032);
        for _ in 0..20_000 {
            let length = rng.below(24);
            let text: String = (0..length).map(|_| *rng.pick(&ALPHABET)).collect();
            let decoded = decode_jsx_attribute_text(&text);
            assert!(decoded.len() <= text.len(), "{text:?} → {decoded:?}");
        }
    }
}
