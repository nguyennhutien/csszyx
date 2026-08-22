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
fn quoted(text: &str) -> String {
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

    #[test]
    fn wraps_the_expression_and_keeps_the_braces_when_asked() {
        let mut object = SzObject::new();
        object.insert("p".to_string(), SzValue::Number(4.0));
        assert_eq!(sz_expression(&object), "{{ p: 4 }}");
        assert_eq!(sz_html_value(&object, true), "{ p: 4 }");
        assert_eq!(sz_html_value(&object, false), "p: 4");
        assert_eq!(sz_html_value(&SzObject::new(), false), "");
    }
}
