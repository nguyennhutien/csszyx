//! The values an sz object holds, and JavaScript's reading of numbers.
//!
//! migrate's output is consumed as JSON-shaped data, so the value model is
//! JSON's: booleans, numbers, strings, arrays, null and ordered objects.
//! Numbers follow JavaScript in both directions — `js_number` reads a string
//! the way `Number()` does, and serialisation prints an integral double
//! without a fraction the way `JSON.stringify` does — and objects print their
//! keys in JavaScript's order, integer-like keys first, because the parity
//! corpus is recorded from the TypeScript and compared byte for byte.

use std::fmt;
use std::ops::{Deref, DerefMut};

use indexmap::IndexMap;
use serde::de::{self, Deserializer, MapAccess, SeqAccess, Visitor};
use serde::ser::{Serialize, SerializeMap, SerializeSeq, Serializer};
use serde_json::value::RawValue;

/// An sz object: keys in insertion order, as migrate writes them.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct SzObject(pub IndexMap<String, SzValue>);

impl SzObject {
    /// An empty object.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// The entries in the order JavaScript enumerates them: keys that are
    /// array indices first, ascending, then the rest as inserted.
    pub fn js_ordered(&self) -> impl Iterator<Item = (&String, &SzValue)> {
        let mut indices: Vec<(u64, &String, &SzValue)> = self
            .0
            .iter()
            .filter_map(|(key, value)| array_index(key).map(|index| (index, key, value)))
            .collect();
        indices.sort_by_key(|(index, _, _)| *index);
        indices
            .into_iter()
            .map(|(_, key, value)| (key, value))
            .chain(self.0.iter().filter(|(key, _)| array_index(key).is_none()))
    }
}

impl Deref for SzObject {
    type Target = IndexMap<String, SzValue>;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl DerefMut for SzObject {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

/// Largest key JavaScript treats as an array index: 2^32 - 2.
const MAX_ARRAY_INDEX: u64 = 4_294_967_294;

/// The index a key denotes when JavaScript would enumerate it first: a
/// canonical decimal integer with no leading zero, below 2^32 - 1.
fn array_index(key: &str) -> Option<u64> {
    // Only the digit check earns its place. An empty key is refused by the
    // parse below anyway, while a signed one such as `+12` is not: Rust reads
    // it and JavaScript does not call it an index.
    if !key.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    if key.len() > 1 && key.starts_with('0') {
        return None;
    }
    key.parse::<u64>()
        .ok()
        .filter(|index| *index <= MAX_ARRAY_INDEX)
}

/// One sz value.
#[derive(Clone, Debug, PartialEq)]
pub enum SzValue {
    /// JSON `null`, which only a migration-resolution map can supply.
    Null,
    /// A boolean shorthand: `flex: true`.
    Bool(bool),
    /// A number, as JavaScript holds it.
    Number(f64),
    /// A string value.
    String(String),
    /// A JSON array, which only a migration-resolution map can supply.
    Array(Vec<Self>),
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
            Self::Null => serializer.serialize_none(),
            Self::Bool(value) => serializer.serialize_bool(*value),
            Self::Number(value) => serialize_js_number(*value, serializer),
            Self::String(value) => serializer.serialize_str(value),
            Self::Array(items) => {
                let mut sequence = serializer.serialize_seq(Some(items.len()))?;
                for item in items {
                    sequence.serialize_element(item)?;
                }
                sequence.end()
            }
            Self::Object(object) => object.serialize(serializer),
        }
    }
}

impl Serialize for SzObject {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.len()))?;
        for (key, value) in self.js_ordered() {
            map.serialize_entry(key, value)?;
        }
        map.end()
    }
}

struct SzValueVisitor;

impl<'de> Visitor<'de> for SzValueVisitor {
    type Value = SzValue;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("a JSON value")
    }

    fn visit_bool<E: de::Error>(self, value: bool) -> Result<SzValue, E> {
        Ok(SzValue::Bool(value))
    }

    fn visit_i64<E: de::Error>(self, value: i64) -> Result<SzValue, E> {
        #[allow(clippy::cast_precision_loss)]
        Ok(SzValue::Number(value as f64))
    }

    fn visit_u64<E: de::Error>(self, value: u64) -> Result<SzValue, E> {
        #[allow(clippy::cast_precision_loss)]
        Ok(SzValue::Number(value as f64))
    }

    fn visit_f64<E: de::Error>(self, value: f64) -> Result<SzValue, E> {
        Ok(SzValue::Number(value))
    }

    fn visit_str<E: de::Error>(self, value: &str) -> Result<SzValue, E> {
        Ok(SzValue::from(value))
    }

    fn visit_unit<E: de::Error>(self) -> Result<SzValue, E> {
        Ok(SzValue::Null)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<SzValue, A::Error> {
        let mut items = Vec::new();
        while let Some(item) = sequence.next_element()? {
            items.push(item);
        }
        Ok(SzValue::Array(items))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut entries: A) -> Result<SzValue, A::Error> {
        let mut object = SzObject::new();
        while let Some((key, value)) = entries.next_entry::<String, SzValue>()? {
            object.insert(key, value);
        }
        Ok(SzValue::Object(object))
    }
}

impl<'de> serde::Deserialize<'de> for SzValue {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(SzValueVisitor)
    }
}

impl<'de> serde::Deserialize<'de> for SzObject {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        match SzValue::deserialize(deserializer)? {
            SzValue::Object(object) => Ok(object),
            other => Err(de::Error::custom(format!(
                "expected an object, got {other:?}"
            ))),
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
    // Write the digits JavaScript would, rather than letting the JSON layer
    // choose. Its float writer switches to an exponent from 2^63 up, while
    // JavaScript keeps writing digits until 1e21 — so the two disagree on
    // every integral value in between, and on 1e20.
    let text = js_number_to_string(value);
    match RawValue::from_string(text) {
        Ok(raw) => raw.serialize(serializer),
        // Unreachable for a finite double, which always formats as valid JSON.
        Err(_) => serializer.serialize_f64(value),
    }
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
        return if value.is_sign_positive() {
            "Infinity"
        } else {
            "-Infinity"
        }
        .to_string();
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
    // Display is shortest-round-trip, which is the rule JavaScript prints by.
    // Formatting an integral value as a fixed decimal instead writes its exact
    // expansion, and above 2^53 the two part company: 2^63 is exactly
    // 9223372036854775808, and JavaScript writes 9223372036854776000.
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

pub fn is_js_whitespace(character: char) -> bool {
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
    fn spells_out_which_literals_javascript_accepts() {
        // This mirrors JavaScript's grammar on purpose, rather than leaning on
        // Rust's own parser to agree. The two happen to refuse the same
        // strings today, so nothing downstream notices when this is wrong —
        // which is exactly why it is pinned here rather than through a caller.
        for text in ["1", "1.5", ".5", "5.", "1e5", "1E-5", "+1.5", "-1.5e+5"] {
            assert!(
                is_js_decimal_literal(text),
                "{text} is a JavaScript literal"
            );
        }
        for text in [
            "1.x", "x.1", ".", "1.2.3", "", "1e", "1e+", "inf", "nan", "1_000",
        ] {
            assert!(
                !is_js_decimal_literal(text),
                "{text} is not a JavaScript literal"
            );
        }
    }

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
        object.insert("10".to_string(), SzValue::Null);
        object.insert(
            "2".to_string(),
            SzValue::Array(vec![SzValue::Number(1.0), SzValue::Null]),
        );
        object.insert("02".to_string(), SzValue::from("not an index"));
        object.insert("4294967295".to_string(), SzValue::from("too large"));
        object.insert("4294967294".to_string(), SzValue::from("largest index"));
        assert_eq!(
            serde_json::to_string(&SzValue::Object(object)).unwrap(),
            r#"{"2":[1,null],"10":null,"4294967294":"largest index","z":2,"a":0.5,"n":null,"big":100000000000000000,"b":true,"s":"x","02":"not an index","4294967295":"too large"}"#
        );
    }

    #[test]
    fn reads_json_back_in_its_order() {
        let text = r#"{"z":{"y":[1,2.5,true,null,"s",{"k":false}]},"a":-3,"0":"first"}"#;
        let value: SzValue = serde_json::from_str(text).unwrap();
        let SzValue::Object(object) = &value else {
            panic!("an object");
        };
        let keys: Vec<&String> = object.keys().collect();
        assert_eq!(keys, ["z", "a", "0"]);
        assert_eq!(
            serde_json::to_string(&value).unwrap(),
            r#"{"0":"first","z":{"y":[1,2.5,true,null,"s",{"k":false}]},"a":-3}"#
        );
        let object: SzObject = serde_json::from_str(text).unwrap();
        assert_eq!(object.len(), 3);
        assert!(serde_json::from_str::<SzObject>("[1]").is_err());
    }

    /// A deserializer handing the visitor a kind JSON has no spelling for
    /// is refused with the visitor's own description of what it reads.
    #[test]
    fn refuses_a_value_kind_json_cannot_hold() {
        use serde::de::value::{BytesDeserializer, Error};
        use serde::Deserialize;

        let error = SzValue::deserialize(BytesDeserializer::<Error>::new(b"raw")).unwrap_err();
        assert_eq!(
            error.to_string(),
            "invalid type: byte array, expected a JSON value"
        );
    }
}
