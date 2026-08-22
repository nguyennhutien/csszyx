//! The values an sz object holds, and JavaScript's reading of numbers.
//!
//! migrate's output is consumed as JSON-shaped data, so the value model is
//! JSON's: booleans, numbers, strings and ordered objects. Numbers follow
//! JavaScript in both directions — `js_number` reads a string the way
//! `Number()` does, and serialisation prints an integral double without a
//! fraction the way `JSON.stringify` does — because the parity corpus is
//! recorded from the TypeScript and compared byte for byte.

use indexmap::IndexMap;
use serde::ser::{Serialize, SerializeMap, Serializer};

/// An sz object: keys in insertion order, as migrate writes them.
pub type SzObject = IndexMap<String, SzValue>;

/// One sz value.
#[derive(Clone, Debug, PartialEq)]
pub enum SzValue {
    /// A boolean shorthand: `flex: true`.
    Bool(bool),
    /// A number, as JavaScript holds it.
    Number(f64),
    /// A string value.
    String(String),
    /// A nested object: variants, `{ color, op }`, a gradient.
    Object(SzObject),
}

impl From<&str> for SzValue {
    fn from(value: &str) -> Self {
        Self::String(value.to_string())
    }
}

impl From<String> for SzValue {
    fn from(value: String) -> Self {
        Self::String(value)
    }
}

impl From<bool> for SzValue {
    fn from(value: bool) -> Self {
        Self::Bool(value)
    }
}

impl Serialize for SzValue {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Bool(value) => serializer.serialize_bool(*value),
            Self::Number(value) => serialize_js_number(*value, serializer),
            Self::String(value) => serializer.serialize_str(value),
            Self::Object(map) => {
                let mut object = serializer.serialize_map(Some(map.len()))?;
                for (key, value) in map {
                    object.serialize_entry(key, value)?;
                }
                object.end()
            }
        }
    }
}

/// Largest double JavaScript prints as an integer without an exponent.
const JS_EXPONENT_THRESHOLD: f64 = 1e21;

/// Serialise a number the way `JSON.stringify` prints it: an integral double
/// carries no fraction, and a non-finite one is `null`.
fn serialize_js_number<S: Serializer>(value: f64, serializer: S) -> Result<S::Ok, S::Error> {
    if !value.is_finite() {
        return serializer.serialize_none();
    }
    // An integral double below 2^63 is exactly an i64, which prints without
    // a fraction or an exponent, as JavaScript prints it up to 1e21.
    if value.fract() == 0.0 && value.abs() < 9_223_372_036_854_775_808.0 {
        // Integral and in range: the cast is exact.
        #[allow(clippy::cast_possible_truncation)]
        return serializer.serialize_i64(value as i64);
    }
    serializer.serialize_f64(value)
}

/// Format a number the way JavaScript's `String(number)` does.
///
/// Only the forms migrate can produce are spelled out: integers, short
/// decimals, the exponent forms JavaScript switches to below `1e-6` and at
/// `1e21`, and the three non-finite words.
pub fn js_number_to_string(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    if value == 0.0 {
        return "0".to_string();
    }
    let magnitude = value.abs();
    if !(1e-6..JS_EXPONENT_THRESHOLD).contains(&magnitude) {
        // Rust writes `1e21`; JavaScript writes `1e+21`.
        let exponent = format!("{value:e}");
        return match exponent.split_once('e') {
            Some((mantissa, power)) if !power.starts_with('-') => format!("{mantissa}e+{power}"),
            _ => exponent,
        };
    }
    if value.fract() == 0.0 {
        return format!("{value:.0}");
    }
    format!("{value}")
}

/// Read a string the way JavaScript's `Number()` does.
///
/// Whitespace is trimmed, the empty string is zero, the infinities are
/// spelled out, `0x`/`0o`/`0b` are unsigned radix literals, and anything else
/// must be a decimal literal: an optional sign, digits with an optional
/// fraction, an optional exponent. Everything else is `NaN`, returned as
/// `None` so callers cannot forget the case.
pub fn js_number(text: &str) -> Option<f64> {
    let trimmed = text.trim_matches(is_js_whitespace);
    if trimmed.is_empty() {
        return Some(0.0);
    }
    match trimmed {
        "Infinity" | "+Infinity" => return Some(f64::INFINITY),
        "-Infinity" => return Some(f64::NEG_INFINITY),
        _ => {}
    }
    for (marker, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0o", 8),
        ("0O", 8),
        ("0b", 2),
        ("0B", 2),
    ] {
        if let Some(digits) = trimmed.strip_prefix(marker) {
            return radix_digits(digits, radix);
        }
    }
    if !is_js_decimal_literal(trimmed) {
        return None;
    }
    trimmed.parse::<f64>().ok()
}

/// The value of an unsigned radix literal's digits, or `None` when a digit
/// is outside the radix. Digits beyond `u64` still read as their double.
fn radix_digits(digits: &str, radix: u32) -> Option<f64> {
    if digits.is_empty() {
        return None;
    }
    let mut value = 0.0_f64;
    for digit in digits.chars() {
        let digit = digit.to_digit(radix)?;
        value = value.mul_add(f64::from(radix), f64::from(digit));
    }
    Some(value)
}

/// Whether text is a JavaScript `StrDecimalLiteral`, which is what Rust's
/// `f64::from_str` can then read; Rust alone would also accept `inf` and `nan`.
fn is_js_decimal_literal(text: &str) -> bool {
    let unsigned = text.strip_prefix(['+', '-']).unwrap_or(text);
    let (mantissa, exponent) = match unsigned.split_once(['e', 'E']) {
        Some((mantissa, exponent)) => (mantissa, Some(exponent)),
        None => (unsigned, None),
    };
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit());
    let mantissa_ok = match mantissa.split_once('.') {
        Some((whole, fraction)) => {
            (whole.is_empty() || digits(whole))
                && (fraction.is_empty() || digits(fraction))
                && !(whole.is_empty() && fraction.is_empty())
        }
        None => digits(mantissa),
    };
    let exponent_ok = exponent
        .is_none_or(|exponent| digits(exponent.strip_prefix(['+', '-']).unwrap_or(exponent)));
    mantissa_ok && exponent_ok
}

/// JavaScript's `WhiteSpace` and `LineTerminator` characters outside the
/// U+2000..U+200A run, which `Number()` trims. They are not Rust's
/// `char::is_whitespace`: JavaScript includes the byte-order mark and
/// excludes U+0085.
const JS_WHITESPACE: &[char] = &[
    '\t', '\n', '\u{000B}', '\u{000C}', '\r', ' ', '\u{00A0}', '\u{1680}', '\u{2028}', '\u{2029}',
    '\u{202F}', '\u{205F}', '\u{3000}', '\u{FEFF}',
];

fn is_js_whitespace(character: char) -> bool {
    JS_WHITESPACE.contains(&character) || ('\u{2000}'..='\u{200A}').contains(&character)
}

/// One Tailwind utility read as an sz prop and value.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedClass {
    /// The sz key.
    pub prop: String,
    /// The sz value.
    pub value: SzValue,
    /// The single CSS property the utility sets, when the variant parser
    /// needs to refuse two classes that fight over it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub css_property: Option<String>,
    /// A companion prop emitted alongside `prop`: `text-sm/6` is `text` plus
    /// `leading`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extra: Option<Extra>,
}

impl ParsedClass {
    /// A prop with a value and nothing else.
    pub fn new(prop: &str, value: impl Into<SzValue>) -> Self {
        Self {
            prop: prop.to_string(),
            value: value.into(),
            css_property: None,
            extra: None,
        }
    }
}

/// The companion prop of a two-token utility.
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Extra {
    /// The companion key.
    pub prop: String,
    /// Its value.
    pub value: SzValue,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_numbers_the_way_javascript_does() {
        for (text, expected) in [
            ("4", 4.0),
            ("-4", -4.0),
            ("+5", 5.0),
            (".5", 0.5),
            ("5.", 5.0),
            ("1e3", 1000.0),
            ("1E-2", 0.01),
            ("", 0.0),
            ("  7 ", 7.0),
            ("\u{FEFF}7", 7.0),
            ("\u{2003}7\u{3000}", 7.0),
            ("0x10", 16.0),
            ("0X1f", 31.0),
            ("0o17", 15.0),
            ("0b101", 5.0),
            ("Infinity", f64::INFINITY),
            ("-Infinity", f64::NEG_INFINITY),
        ] {
            assert_eq!(js_number(text), Some(expected), "{text:?}");
        }
        for text in [
            "1_000",
            "0x",
            "0xg",
            "-0x10",
            "inf",
            "nan",
            "NaN",
            "1e",
            "e5",
            ".",
            "+",
            "-",
            "1.2.3",
            "px",
            "\u{0085}7",
            "1 2",
        ] {
            assert_eq!(js_number(text), None, "{text:?}");
        }
    }

    #[test]
    fn prints_numbers_the_way_javascript_does() {
        for (value, expected) in [
            (4.0, "4"),
            (-4.0, "-4"),
            (0.5, "0.5"),
            (-0.0, "0"),
            (1e20, "100000000000000000000"),
            (1e21, "1e+21"),
            (1.5e-7, "1.5e-7"),
            (f64::NAN, "NaN"),
            (f64::INFINITY, "Infinity"),
            (f64::NEG_INFINITY, "-Infinity"),
        ] {
            assert_eq!(js_number_to_string(value), expected);
        }
    }

    #[test]
    fn serialises_like_json_stringify() {
        let mut object = SzObject::new();
        object.insert("z".to_string(), SzValue::Number(2.0));
        object.insert("a".to_string(), SzValue::Number(0.5));
        object.insert("n".to_string(), SzValue::Number(f64::INFINITY));
        object.insert("big".to_string(), SzValue::Number(1e17));
        object.insert("b".to_string(), SzValue::Bool(true));
        object.insert("s".to_string(), SzValue::from("x"));
        assert_eq!(
            serde_json::to_string(&SzValue::Object(object)).unwrap(),
            r#"{"z":2,"a":0.5,"n":null,"big":100000000000000000,"b":true,"s":"x"}"#
        );
    }
}
