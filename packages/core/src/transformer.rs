use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::transform::lower::lower_static_sz_object;
use crate::transform::{StaticSzObject, StaticSzProperty, StaticSzValue, TextSpan};

/// Value types supported by the sz prop.
#[derive(Serialize, Deserialize, Debug)]
#[serde(untagged)]
pub enum SzValue {
    /// A single primitive value (string, number, or boolean)
    Primitive(PrimitiveValue),
    /// A nested object for variants (hover, focus, etc.). An `IndexMap` keeps the
    /// JS object's insertion order so the emitted class order is deterministic and
    /// matches the static path.
    Nested(IndexMap<String, Self>),
}

/// Primitive values supported by the sz prop.
#[derive(Serialize, Deserialize, Debug)]
#[serde(untagged)]
pub enum PrimitiveValue {
    /// String value (e.g., 'red-500')
    String(String),
    /// Numeric value (e.g., 4)
    Number(f64),
    /// Boolean flag (e.g., true)
    Bool(bool),
}

/// Transforms a csszyx sz object into a Tailwind CSS className string.
///
/// The runtime WASM path is a thin adapter: it deserializes the JS object into an
/// order-preserving map, converts it to the parser's [`StaticSzObject`] IR, and
/// lowers it through the single oracle-gated pipeline in `transform/lower.rs` — the
/// exact same lowering the static build path uses. There is therefore one lowering
/// core and no second implementation to drift (every special case — css, bgImg,
/// color-opacity, supports/data/not/aria/has, group/peer, every property — is
/// handled in one place). The serde boundary, not the lowering, dominates the
/// runtime cost, so the conversion allocation is negligible.
// Native LLVM coverage cannot execute a JsValue boundary. This adapter is
// exercised through pkg-node by the integration and runtime-parity suites.
// coverage:wasm-only:start
#[wasm_bindgen]
pub fn transform_sz(val: JsValue) -> Result<String, JsValue> {
    let sz_prop: IndexMap<String, SzValue> = serde_wasm_bindgen::from_value(val)?;
    let object = convert_runtime_object(&sz_prop);
    Ok(lower_static_sz_object(&object).join(" "))
}
// coverage:wasm-only:end

/// Converts the runtime sz object into the parser's [`StaticSzObject`] IR so the
/// single lowering pipeline can produce the className. Spans are synthetic —
/// runtime input carries no source location and lowering does not read spans.
fn convert_runtime_object(obj: &IndexMap<String, SzValue>) -> StaticSzObject {
    let properties = obj
        .iter()
        .map(|(key, value)| StaticSzProperty {
            key: key.clone(),
            span: TextSpan { start: 0, end: 0 },
            value: convert_runtime_value(value),
        })
        .collect();
    StaticSzObject { properties }
}

/// Maps a single runtime value onto its [`StaticSzValue`] counterpart.
fn convert_runtime_value(value: &SzValue) -> StaticSzValue {
    match value {
        SzValue::Primitive(PrimitiveValue::String(s)) => StaticSzValue::String(s.clone()),
        SzValue::Primitive(PrimitiveValue::Number(n)) => StaticSzValue::Number(*n),
        SzValue::Primitive(PrimitiveValue::Bool(b)) => StaticSzValue::Boolean(*b),
        SzValue::Nested(nested) => StaticSzValue::Object(convert_runtime_object(nested)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Lowers a runtime object through the production adapter path.
    fn lower(pairs: Vec<(&str, SzValue)>) -> Vec<String> {
        let obj: IndexMap<String, SzValue> =
            pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect();
        lower_static_sz_object(&convert_runtime_object(&obj))
    }

    fn s(value: &str) -> SzValue {
        SzValue::Primitive(PrimitiveValue::String(value.to_string()))
    }
    fn n(value: f64) -> SzValue {
        SzValue::Primitive(PrimitiveValue::Number(value))
    }
    fn b(value: bool) -> SzValue {
        SzValue::Primitive(PrimitiveValue::Bool(value))
    }

    #[test]
    fn basic_transform() {
        let classes = lower(vec![("p", n(4.0)), ("bg", s("red-500"))]);
        assert!(classes.contains(&"p-4".to_string()));
        assert!(classes.contains(&"bg-red-500".to_string()));
    }

    #[test]
    fn nested_variants() {
        let mut nested = IndexMap::new();
        nested.insert("bg".to_string(), s("blue-500"));
        let classes = lower(vec![("hover", SzValue::Nested(nested))]);
        assert_eq!(classes, ["hover:bg-blue-500".to_string()]);
    }

    #[test]
    fn generated_property_and_boolean_maps() {
        let classes = lower(vec![("start", n(4.0)), ("display", s("inline-block"))]);
        assert!(classes.contains(&"inset-s-4".to_string()));
        assert!(classes.contains(&"inline-block".to_string()));
    }

    #[test]
    fn drops_removed_sugar_and_lowers_canonical() {
        // Removed boolean sugar emits nothing; canonical string forms emit the bare
        // utility; the flex shorthand is untouched.
        assert!(
            lower(vec![("flex", b(true)), ("italic", b(true))]).is_empty(),
            "removed sugar must emit nothing"
        );

        for (key, value, expected) in [
            ("display", "flex", "flex"),
            ("position", "absolute", "absolute"),
            ("fontStyle", "italic", "italic"),
            ("decoration", "underline", "underline"),
            ("fontSmoothing", "grayscale", "antialiased"),
            ("textTransform", "uppercase", "uppercase"),
        ] {
            assert_eq!(
                lower(vec![(key, s(value))]),
                [expected.to_string()],
                "{key}: {value}"
            );
        }

        assert_eq!(lower(vec![("flex", n(1.0))]), ["flex-1".to_string()]);
    }

    #[test]
    fn negative_values() {
        assert_eq!(lower(vec![("m", n(-4.0))]), ["-m-4".to_string()]);
        let classes = lower(vec![("p", n(4.0)), ("m", n(-2.0))]);
        assert!(classes.contains(&"p-4".to_string()));
        assert!(classes.contains(&"-m-2".to_string()));
    }

    #[test]
    fn slash_opacity_string_suppressed() {
        // String slash opacity must be suppressed — use object form via TS compiler.
        let classes = lower(vec![
            ("bg", s("red-500/50")),
            ("text", s("blue-600/75")),
            ("bg2", s("brand-500/20")),
        ]);
        assert!(!classes.iter().any(|c| c.contains('/')));
    }

    #[test]
    fn color_passthrough() {
        let classes = lower(vec![("bg", s("brand-500")), ("text", s("red-500"))]);
        assert!(classes.contains(&"bg-brand-500".to_string()));
        assert!(classes.contains(&"text-red-500".to_string()));
    }
}
