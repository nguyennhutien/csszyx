//! Static csszyx IR lowering.
//!
//! This module converts parser-neutral static sz IR into ordered class names.
//! It is kept separate from rewrite so class-generation parity can be tested
//! before any source mutation ships.

use super::{
    generated::tables::{boolean_class, property_prefix, variant_prefix},
    SourceIr, StaticSzObject, StaticSzValue,
};

/// Class data lowered from parser-neutral source IR.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoweredSourceClasses {
    /// Generated csszyx/Tailwind classes from static `sz` attributes.
    pub classes: Vec<String>,
    /// Static class/className strings discovered in source order.
    pub raw_class_names: Vec<String>,
}

/// Lower parser-neutral source IR into class lists without rewriting source.
pub fn lower_source_ir_classes(ir: &SourceIr) -> LoweredSourceClasses {
    let classes = ir
        .sz_attributes
        .iter()
        .flat_map(lower_sz_attribute_classes)
        .collect();
    let raw_class_names = ir
        .class_attributes
        .iter()
        .map(|attr| attr.value.clone())
        .collect();

    LoweredSourceClasses {
        classes,
        raw_class_names,
    }
}

/// Lower one static `sz` attribute into classes.
///
/// For a ternary `sz={cond ? A : B}` attribute both branches contribute to the
/// reported class list so `result.classes` matches what oxc-JS reports today
/// (both possible runtime outcomes flow back as static knowledge for the
/// className manifest). The rewrite layer keeps the two branches separate
/// when it emits source.
pub fn lower_sz_attribute_classes(attribute: &super::SzAttributeIr) -> Vec<String> {
    let mut classes = attribute
        .literal_class_name
        .as_deref()
        .into_iter()
        .flat_map(str::split_whitespace)
        .filter(|class_name| !class_name.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    classes.extend(lower_static_sz_object(&attribute.object));
    if let Some(ternary) = &attribute.ternary {
        classes.extend(ternary.consequent_classes.iter().cloned());
        classes.extend(ternary.alternate_classes.iter().cloned());
    }
    classes
}

/// Lower a static sz object into Tailwind/csszyx class names in source order.
pub fn lower_static_sz_object(object: &StaticSzObject) -> Vec<String> {
    let mut classes = Vec::with_capacity(object.properties.len());
    lower_object_into(object, "", &mut classes);
    classes
}

fn lower_object_into(object: &StaticSzObject, prefix: &str, classes: &mut Vec<String>) {
    for property in &object.properties {
        match &property.value {
            StaticSzValue::Object(nested) => {
                let variant = variant_prefix(&property.key).unwrap_or(&property.key);
                let mut next_prefix = String::with_capacity(prefix.len() + property.key.len() + 1);
                next_prefix.push_str(prefix);
                next_prefix.push_str(variant);
                next_prefix.push(':');
                lower_object_into(nested, &next_prefix, classes);
            }
            StaticSzValue::Boolean(false) => {
                if let Some(class_name) = false_boolean_class(&property.key) {
                    classes.push(format!("{prefix}{class_name}"));
                }
            }
            value => {
                if let Some(class_name) = format_static_class(&property.key, value, prefix) {
                    classes.push(class_name);
                }
            }
        }
    }
}

fn false_boolean_class(key: &str) -> Option<&'static str> {
    match key {
        "italic" => Some("not-italic"),
        "antialiased" => Some("subpixel-antialiased"),
        _ => None,
    }
}

fn format_static_class(key: &str, value: &StaticSzValue, prefix: &str) -> Option<String> {
    let class_key = property_prefix(key).unwrap_or(key);

    match value {
        StaticSzValue::Boolean(true) => Some(format!(
            "{prefix}{}",
            boolean_class(key).unwrap_or(class_key)
        )),
        StaticSzValue::Boolean(false) | StaticSzValue::Object(_) => None,
        StaticSzValue::Number(value) => Some(format_number_class(class_key, *value, prefix)),
        StaticSzValue::String(value) => {
            if has_slash_opacity(value) {
                return None;
            }

            let is_negative = value.starts_with('-');
            let base_value = if is_negative { &value[1..] } else { value };
            let final_value = if needs_brackets(base_value) {
                format!("[{base_value}]")
            } else {
                base_value.to_string()
            };

            if is_negative {
                Some(format!("{prefix}-{class_key}-{final_value}"))
            } else {
                Some(format!("{prefix}{class_key}-{final_value}"))
            }
        }
    }
}

fn format_number_class(key: &str, value: f64, prefix: &str) -> String {
    let is_negative = value < 0.0;
    let abs_value = value.abs();
    let final_value = if abs_value.fract() == 0.0 {
        #[allow(clippy::cast_possible_truncation)]
        (abs_value as i64).to_string()
    } else {
        abs_value.to_string()
    };

    if is_negative {
        format!("{prefix}-{key}-{final_value}")
    } else {
        format!("{prefix}{key}-{final_value}")
    }
}

const CSS_UNITS: &[&str] = &[
    "px", "rem", "em", "%", "vh", "vw", "ch", "dvh", "dvw", "svh", "svw", "lvh", "lvw", "cqw",
    "cqh", "deg", "rad", "turn", "grad", "ms", "s", "fr",
];

fn has_slash_opacity(value: &str) -> bool {
    value.find('/').is_some_and(|pos| {
        pos > 0
            && value
                .as_bytes()
                .get(pos - 1)
                .is_some_and(u8::is_ascii_digit)
    })
}

fn needs_brackets(value: &str) -> bool {
    if value.starts_with('[') && value.ends_with(']') {
        return false;
    }

    if value.starts_with('#')
        || value.starts_with("rgb")
        || value.starts_with("hsl")
        || value.starts_with("oklch")
        || value.starts_with("color(")
        || value.starts_with("hwb(")
        || value.starts_with("lab(")
        || value.starts_with("lch(")
        || value.starts_with("oklab(")
    {
        return true;
    }

    if value.contains("calc(")
        || value.contains("var(")
        || value.contains("attr(")
        || value.contains("url(")
        || value.contains("clamp(")
        || value.contains("min(")
        || value.contains("max(")
        || value.contains(' ')
    {
        return true;
    }

    if value.starts_with('.') && value.len() > 1 && value.as_bytes()[1].is_ascii_digit() {
        return true;
    }

    CSS_UNITS.iter().any(|unit| {
        value.strip_suffix(unit).is_some_and(|prefix| {
            !prefix.is_empty() && prefix.chars().all(|c| c.is_ascii_digit() || c == '.')
        })
    })
}

#[cfg(test)]
mod tests {
    use super::{lower_source_ir_classes, lower_static_sz_object};
    use crate::transform::{
        ClassAttributeIr, SourceIr, StaticSzObject, StaticSzProperty, StaticSzValue, SzAttributeIr,
        TextSpan,
    };

    fn property(key: &str, value: StaticSzValue) -> StaticSzProperty {
        StaticSzProperty {
            key: key.to_string(),
            span: TextSpan { start: 0, end: 0 },
            value,
        }
    }

    #[test]
    fn lowers_primitives_in_source_order() {
        let object = StaticSzObject {
            properties: vec![
                property("p", StaticSzValue::Number(4.0)),
                property("bg", StaticSzValue::String("red-500".to_string())),
                property("italic", StaticSzValue::Boolean(true)),
            ],
        };

        assert_eq!(
            lower_static_sz_object(&object),
            ["p-4", "bg-red-500", "italic"]
        );
    }

    #[test]
    fn uses_generated_property_and_boolean_maps() {
        let object = StaticSzObject {
            properties: vec![
                property("start", StaticSzValue::Number(4.0)),
                property("inlineBlock", StaticSzValue::Boolean(true)),
                property("bgImg", StaticSzValue::String("url(/hero.png)".to_string())),
            ],
        };

        assert_eq!(
            lower_static_sz_object(&object),
            ["inset-s-4", "inline-block", "bg-[url(/hero.png)]"]
        );
    }

    #[test]
    fn lowers_nested_variants() {
        let object = StaticSzObject {
            properties: vec![property(
                "hover",
                StaticSzValue::Object(StaticSzObject {
                    properties: vec![property(
                        "bg",
                        StaticSzValue::String("blue-500".to_string()),
                    )],
                }),
            )],
        };

        assert_eq!(lower_static_sz_object(&object), ["hover:bg-blue-500"]);
    }

    #[test]
    fn lowers_negative_and_false_boolean_special_cases() {
        let object = StaticSzObject {
            properties: vec![
                property("m", StaticSzValue::Number(-2.0)),
                property("italic", StaticSzValue::Boolean(false)),
                property("hidden", StaticSzValue::Boolean(false)),
            ],
        };

        assert_eq!(lower_static_sz_object(&object), ["-m-2", "not-italic"]);
    }

    #[test]
    fn brackets_arbitrary_values_and_suppresses_slash_opacity() {
        let object = StaticSzObject {
            properties: vec![
                property("w", StaticSzValue::String("12px".to_string())),
                property("bg", StaticSzValue::String("red-500/50".to_string())),
            ],
        };

        assert_eq!(lower_static_sz_object(&object), ["w-[12px]"]);
    }

    #[test]
    fn lowers_source_ir_classes_in_source_order() {
        let ir = SourceIr {
            filename: "/repo/src/App.tsx".to_string(),
            source_span: TextSpan::new(0, 80).expect("valid span"),
            sz_attributes: vec![SzAttributeIr {
                attribute_span: TextSpan::new(10, 26).expect("valid span"),
                value_span: TextSpan::new(14, 25).expect("valid span"),
                object: StaticSzObject {
                    properties: vec![StaticSzProperty {
                        key: "start".to_string(),
                        span: TextSpan::new(17, 25).expect("valid span"),
                        value: StaticSzValue::Number(4.0),
                    }],
                },
                literal_class_name: None,
                rewrites_empty_class: false,
                ternary: None,
                runtime_fallback: false,
            }],
            unsupported_sz_attribute_spans: Vec::new(),
            class_attributes: vec![ClassAttributeIr {
                attribute_span: TextSpan::new(28, 46).expect("valid span"),
                value_span: TextSpan::new(39, 44).expect("valid span"),
                value: "block".to_string(),
            }],
            recovery_attributes: Vec::new(),
            unsupported_recovery_attribute_spans: Vec::new(),
            jsx_opening_elements: Vec::new(),
        };

        let lowered = lower_source_ir_classes(&ir);

        assert_eq!(lowered.classes, ["inset-s-4"]);
        assert_eq!(lowered.raw_class_names, ["block"]);
    }
}
