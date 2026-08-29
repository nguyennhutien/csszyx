//! An sz object to the source text migrate writes.
//!
//! `{ p: 4, bg: 'blue-500', hover: { bg: 'blue-600' } }`: up to two entries
//! stay on one line unless one of them is a nested object that is neither a
//! colour-with-opacity nor a gradient; anything else goes one entry per line,
//! indented two spaces per level, trailing commas throughout. Keys that are
//! not identifiers are quoted, and strings are single-quoted with the four
//! escapes a single-quoted JavaScript literal needs.

use super::value::{is_js_whitespace, js_number_to_string, SzObject, SzValue};

/// The object as a JSX expression: `{{ p: 4 }}`.
#[must_use]
pub fn sz_expression(object: &SzObject) -> String {
    format!("{{{}}}", object_to_string(object, 0))
}

/// The object as an HTML attribute value. Without braces the outer pair is
/// stripped so the attribute reads `sz="p: 4, bg: 'blue-500'"`; the runtime
/// wraps it again before parsing.
#[must_use]
pub fn sz_html_value(object: &SzObject, braces: bool) -> String {
    let text = object_to_string(object, 0);
    if braces {
        return text;
    }
    // The text always carries exactly one outer brace pair.
    text[1..text.len() - 1]
        .trim_matches(is_js_whitespace)
        .to_string()
}

/// The object as an object literal: `{ p: 4, bg: 'blue-500' }`.
#[must_use]
pub fn sz_object_literal(object: &SzObject) -> String {
    object_to_string(object, 0)
}

fn object_to_string(object: &SzObject, indent: usize) -> String {
    let entries: Vec<(&String, &SzValue)> = object.js_ordered().collect();
    if entries.is_empty() {
        return "{}".to_string();
    }

    if entries.len() <= 2 && !has_deep_nesting(object) {
        let parts: Vec<String> = entries
            .iter()
            .map(|(key, value)| format!("{}: {}", format_key(key), format_value(value, indent)))
            .collect();
        return format!("{{ {} }}", parts.join(", "));
    }

    let inner = " ".repeat(indent + 2);
    let lines: Vec<String> = entries
        .iter()
        .map(|(key, value)| {
            format!(
                "{inner}{}: {},",
                format_key(key),
                format_value(value, indent + 2)
            )
        })
        .collect();
    format!("{{\n{}\n{}}}", lines.join("\n"), " ".repeat(indent))
}

/// Whether any value is a nested object other than a colour-with-opacity or
/// a gradient, which have their own one-line spellings. An array counts: it
/// is an object to JavaScript.
fn has_deep_nesting(object: &SzObject) -> bool {
    object.values().any(|value| match value {
        SzValue::Array(_) => true,
        SzValue::Object(nested) => !is_color_opacity(nested) && !is_gradient(nested),
        _ => false,
    })
}

fn is_color_opacity(object: &SzObject) -> bool {
    object.contains_key("color") && object.contains_key("op")
}

fn is_gradient(object: &SzObject) -> bool {
    object.contains_key("gradient")
}

/// A key as written: bare when it is an identifier, single-quoted otherwise.
fn format_key(key: &str) -> String {
    if is_identifier(key) {
        return key.to_string();
    }
    quoted(key)
}

/// `^[a-z_$][\w$]*$`, case-insensitive and ASCII, as the TypeScript tests it.
fn is_identifier(key: &str) -> bool {
    let mut bytes = key.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    (first.is_ascii_alphabetic() || first == b'_' || first == b'$')
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$')
}

fn format_value(value: &SzValue, indent: usize) -> String {
    match value {
        SzValue::Bool(true) => "true".to_string(),
        SzValue::Bool(false) => "false".to_string(),
        SzValue::Null => "null".to_string(),
        SzValue::Number(number) => js_number_to_string(*number),
        SzValue::String(text) => quoted(text),
        SzValue::Array(items) => {
            let parts: Vec<String> = items
                .iter()
                .map(|item| format_value(item, indent))
                .collect();
            format!("[{}]", parts.join(", "))
        }
        SzValue::Object(object) => format_object_value(object, indent),
    }
}

/// A colour-with-opacity and a gradient have fixed one-line spellings; any
/// other object is written like the top level.
fn format_object_value(object: &SzObject, indent: usize) -> String {
    if is_color_opacity(object) {
        let color = object.get("color").unwrap_or(&SzValue::Null);
        let opacity = match object.get("op").unwrap_or(&SzValue::Null) {
            SzValue::Number(number) => js_number_to_string(*number),
            other => quoted(&js_string(other)),
        };
        return format!("{{ color: {}, op: {opacity} }}", quoted(&js_string(color)));
    }
    if !is_gradient(object) {
        return object_to_string(object, indent);
    }
    let gradient = object.get("gradient").unwrap_or(&SzValue::Null);
    let mut parts = vec![format!("gradient: {}", quoted(&js_string(gradient)))];
    if let Some(direction) = object.get("dir") {
        let direction = match direction {
            SzValue::Number(number) => js_number_to_string(*number),
            other => quoted(&js_string(other)),
        };
        parts.push(format!("dir: {direction}"));
    }
    if let Some(interpolation) = object.get("in") {
        parts.push(format!("in: {}", quoted(&js_string(interpolation))));
    }
    format!("{{ {} }}", parts.join(", "))
}

/// A single-quoted JavaScript string literal.
pub(super) fn quoted(text: &str) -> String {
    format!("'{}'", escape_single_quoted(text))
}

/// The four escapes a single-quoted literal needs, backslashes first so the
/// ones the other three add are not doubled.
fn escape_single_quoted(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\r', "\\r")
        .replace('\n', "\\n")
}

/// JavaScript's `String(value)`: what the codegen writes when a map supplied
/// a colour, opacity or gradient part that is not the string it expected.
fn js_string(value: &SzValue) -> String {
    match value {
        SzValue::Null => "null".to_string(),
        SzValue::Bool(flag) => flag.to_string(),
        SzValue::Number(number) => js_number_to_string(*number),
        SzValue::String(text) => text.clone(),
        // Arrays join their elements with commas, nested arrays flatten, and
        // a null element is empty.
        SzValue::Array(items) => items
            .iter()
            .map(|item| match item {
                SzValue::Null => String::new(),
                other => js_string(other),
            })
            .collect::<Vec<_>>()
            .join(","),
        SzValue::Object(_) => "[object Object]".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spells_a_value_the_way_javascript_string_does() {
        let nested = SzValue::Array(vec![
            SzValue::Null,
            SzValue::Array(vec![SzValue::Number(1.0), SzValue::Number(2.0)]),
            SzValue::Bool(true),
            SzValue::Object(SzObject::new()),
        ]);
        assert_eq!(js_string(&nested), ",1,2,true,[object Object]");
        assert_eq!(js_string(&SzValue::Bool(false)), "false");
    }

    /// Build an object from `(key, value)` pairs, in order.
    fn object(entries: &[(&str, SzValue)]) -> SzObject {
        let mut object = SzObject::new();
        for (key, value) in entries {
            object.insert((*key).to_string(), value.clone());
        }
        object
    }

    /// A string value.
    fn text(value: &str) -> SzValue {
        SzValue::String(value.to_string())
    }

    #[test]
    fn writes_a_small_object_on_one_line() {
        assert_eq!(
            sz_expression(&object(&[
                ("p", SzValue::Number(4.0)),
                ("bg", text("blue-500"))
            ])),
            "{{ p: 4, bg: 'blue-500' }}"
        );
        assert_eq!(
            sz_expression(&object(&[
                ("display", text("flex")),
                ("position", text("relative")),
            ])),
            "{{ display: 'flex', position: 'relative' }}"
        );
    }

    #[test]
    fn keeps_a_number_a_number_including_a_negative_one() {
        let written = sz_expression(&object(&[
            ("p", SzValue::Number(4.0)),
            ("opacity", SzValue::Number(50.0)),
        ]));
        assert!(written.contains("p: 4"), "{written}");
        assert!(written.contains("opacity: 50"), "{written}");
        assert!(
            sz_expression(&object(&[("mt", SzValue::Number(-4.0))])).contains("mt: -4"),
            "a negative number keeps its sign"
        );
    }

    #[test]
    fn quotes_a_key_that_is_not_a_javascript_identifier() {
        for key in ["@md", "display:grid"] {
            let written = sz_expression(&object(&[(
                key,
                SzValue::Object(object(&[("display", text("flex"))])),
            )]));
            assert!(written.contains(&format!("'{key}'")), "{written}");
        }
    }

    #[test]
    fn writes_a_nested_value_object_inline() {
        let colour = sz_expression(&object(&[(
            "bg",
            SzValue::Object(object(&[
                ("color", text("blue-500")),
                ("op", SzValue::Number(50.0)),
            ])),
        )]));
        assert!(colour.contains("color: 'blue-500'"), "{colour}");
        assert!(colour.contains("op: 50"), "{colour}");

        let gradient = sz_expression(&object(&[(
            "bgImg",
            SzValue::Object(object(&[
                ("gradient", text("linear")),
                ("dir", text("to-r")),
                ("in", text("hsl")),
            ])),
        )]));
        assert!(gradient.contains("gradient: 'linear'"), "{gradient}");
        assert!(gradient.contains("dir: 'to-r'"), "{gradient}");
        assert!(gradient.contains("in: 'hsl'"), "{gradient}");

        let numeric_dir = sz_expression(&object(&[(
            "bgImg",
            SzValue::Object(object(&[
                ("gradient", text("linear")),
                ("dir", SzValue::Number(45.0)),
            ])),
        )]));
        assert!(numeric_dir.contains("dir: 45"), "{numeric_dir}");
    }

    #[test]
    fn breaks_across_lines_once_the_object_is_no_longer_small() {
        let written = sz_expression(&object(&[
            ("p", SzValue::Number(4.0)),
            ("bg", text("blue-500")),
            (
                "hover",
                SzValue::Object(object(&[("bg", text("blue-600"))])),
            ),
        ]));
        assert!(written.contains('\n'), "{written}");
    }

    #[test]
    fn escapes_a_quote_a_backslash_and_a_newline_rather_than_emitting_them_raw() {
        // The output is pasted back into a source file, so a raw line break
        // or an unescaped quote would not parse where it lands.
        assert_eq!(
            sz_expression(&object(&[("custom'key", text("one\\two\nthree"))])),
            "{{ 'custom\\'key': 'one\\\\two\\nthree' }}"
        );

        let gradient = sz_expression(&object(&[(
            "bgImg",
            SzValue::Object(object(&[
                ("gradient", text("lin'ear")),
                ("dir", text("to\\right")),
                ("in", text("ok\nlab")),
            ])),
        )]));
        assert!(gradient.contains("gradient: 'lin\\'ear'"), "{gradient}");
        assert!(gradient.contains("dir: 'to\\\\right'"), "{gradient}");
        assert!(gradient.contains("in: 'ok\\nlab'"), "{gradient}");
    }

    #[test]
    fn wraps_the_expression_and_keeps_the_braces_when_asked() {
        let mut object = SzObject::new();
        object.insert("p".to_string(), SzValue::Number(4.0));
        assert_eq!(sz_expression(&object), "{{ p: 4 }}");
        assert_eq!(sz_html_value(&object, true), "{ p: 4 }");
        assert_eq!(sz_html_value(&object, false), "p: 4");

        // An attribute with nothing in it still has to be writable.
        let empty = SzObject::new();
        assert_eq!(sz_expression(&empty), "{{}}");
        assert_eq!(sz_html_value(&empty, false), "");

        // `false` is a value, not an absence: dropping it would turn an
        // explicit off into a default.
        let mut flags = SzObject::new();
        flags.insert("on".to_string(), SzValue::Bool(false));
        flags.insert("off".to_string(), SzValue::Bool(true));
        assert_eq!(sz_object_literal(&flags), "{ on: false, off: true }");
        assert_eq!(sz_html_value(&SzObject::new(), false), "");
    }
}
