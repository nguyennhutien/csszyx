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
        .extracted_classes
        .iter()
        .cloned()
        .chain(ir.sz_attributes.iter().flat_map(lower_sz_attribute_classes))
        .collect();
    let raw_class_names = ir
        .class_attributes
        .iter()
        .filter(|attr| attr.expression_span.is_none())
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
    classes.extend(attribute.candidate_classes.iter().cloned());
    classes.extend(attribute.dynamic_css_vars.iter().map(|prop| {
        let variant = prop
            .variant_prefix
            .as_ref()
            .map_or_else(String::new, |prefix| format!("{prefix}:"));
        format!("{variant}{}-({})", prop.class_prefix, prop.var_name)
    }));
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
                if property.key == "bgImg" {
                    if let Some(class_name) = format_bg_img_object(nested, prefix) {
                        classes.push(class_name);
                    }
                    continue;
                }

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
            if key == "bgImg" {
                return Some(format_bg_img_string(value, prefix));
            }
            if key == "bgSize" {
                return Some(format_bg_size(value, prefix));
            }
            if key == "bgRepeat" || key == "backgroundRepeat" {
                return Some(format_bg_repeat(value, prefix));
            }
            if key == "content" {
                return Some(format_content(value, prefix));
            }
            // display / position / visibility carry their value as the bare
            // Tailwind utility (`flex`, `grid`, `absolute`, `visible`), not a
            // `display-flex` style prefix-value pair. This mirrors the Babel/oxc
            // transform so both parser paths emit classes Tailwind actually
            // generates.
            if key == "display" {
                return Some(if value == "none" {
                    format!("{prefix}hidden")
                } else {
                    format!("{prefix}{value}")
                });
            }
            if key == "position" {
                return Some(format!("{prefix}{value}"));
            }
            if key == "visibility" {
                return Some(if value == "hidden" {
                    format!("{prefix}invisible")
                } else {
                    format!("{prefix}{value}")
                });
            }

            if has_slash_opacity(value) {
                return None;
            }

            if value.starts_with("--") {
                return Some(css_var_type_hint(key).map_or_else(
                    || format!("{prefix}{class_key}-({value})"),
                    |type_hint| format!("{prefix}{class_key}-({type_hint}:{value})"),
                ));
            }

            let is_negative = value.starts_with('-');
            let base_value = if is_negative { &value[1..] } else { value };
            let final_value = if needs_brackets(base_value) {
                // Tailwind arbitrary values cannot contain raw spaces (the class
                // attribute would split into separate tokens), so collapse
                // whitespace to underscores, matching the Babel/oxc transform.
                format!("[{}]", normalize_arbitrary_value(base_value))
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

fn css_var_type_hint(key: &str) -> Option<&'static str> {
    match key {
        "fontFamily" => Some("family-name"),
        "fontWeight" => Some("weight"),
        "text" => Some("length"),
        _ => None,
    }
}

fn format_bg_img_object(object: &StaticSzObject, prefix: &str) -> Option<String> {
    let gradient = object_string_property(object, "gradient")?;
    let mut class_name = match gradient {
        "linear" => match object.properties.iter().find(|prop| prop.key == "dir") {
            Some(prop) => match &prop.value {
                StaticSzValue::Number(value) if *value < 0.0 => {
                    format!("-bg-linear-{}", format_abs_number(*value))
                }
                StaticSzValue::Number(value) => format!("bg-linear-{}", format_abs_number(*value)),
                StaticSzValue::String(value) if value.starts_with("--") => {
                    format!("bg-linear-({value})")
                }
                StaticSzValue::String(value) if value.starts_with("to-") => {
                    format!("bg-linear-{value}")
                }
                StaticSzValue::String(value) => {
                    format!("bg-linear-[{}]", normalize_arbitrary_value(value))
                }
                _ => return None,
            },
            None => "bg-linear-to-r".to_string(),
        },
        "radial" => match object_string_property(object, "dir") {
            Some(value) if value.starts_with("--") => format!("bg-radial-({value})"),
            Some(value) => format!("bg-radial-[{}]", normalize_arbitrary_value(value)),
            None => "bg-radial".to_string(),
        },
        "conic" => match object.properties.iter().find(|prop| prop.key == "dir") {
            Some(prop) => match &prop.value {
                StaticSzValue::Number(value) if *value < 0.0 => {
                    format!("-bg-conic-{}", format_abs_number(*value))
                }
                StaticSzValue::Number(value) => format!("bg-conic-{}", format_abs_number(*value)),
                StaticSzValue::String(value) if value.starts_with("--") => {
                    format!("bg-conic-({value})")
                }
                StaticSzValue::String(value) => {
                    format!("bg-conic-[{}]", normalize_arbitrary_value(value))
                }
                _ => return None,
            },
            None => "bg-conic".to_string(),
        },
        _ => return None,
    };

    if let Some(interpolation) = object_string_property(object, "in") {
        class_name.push('/');
        class_name.push_str(interpolation);
    }

    Some(format!("{prefix}{class_name}"))
}

fn object_string_property<'a>(object: &'a StaticSzObject, key: &str) -> Option<&'a str> {
    object
        .properties
        .iter()
        .find(|prop| prop.key == key)
        .and_then(|prop| match &prop.value {
            StaticSzValue::String(value) => Some(value.as_str()),
            _ => None,
        })
}

fn format_bg_img_string(value: &str, prefix: &str) -> String {
    let value = value.trim();
    if value == "none" {
        return format!("{prefix}bg-none");
    }

    let normalized = value.strip_prefix('-').unwrap_or(value);
    if normalized.starts_with("repeating-") {
        return format!("{prefix}bg-[{}]", normalize_arbitrary_value(value));
    }
    if normalized.starts_with("linear-")
        || normalized.starts_with("radial")
        || normalized.starts_with("conic")
        || normalized.starts_with("gradient-to-")
    {
        let mapped = normalized.replace("gradient-to-", "linear-to-");
        if value.starts_with('-') {
            return format!("{prefix}-bg-{mapped}");
        }
        return format!("{prefix}bg-{mapped}");
    }
    if value.starts_with("--") {
        return format!("{prefix}bg-(image:{value})");
    }
    if value.starts_with("url(") {
        return format!("{prefix}bg-[{value}]");
    }
    format!("{prefix}bg-[url({value})]")
}

fn format_bg_size(value: &str, prefix: &str) -> String {
    match value {
        "auto" | "cover" | "contain" => format!("{prefix}bg-{value}"),
        value if value.starts_with("--") => format!("{prefix}bg-size-({value})"),
        value => format!("{prefix}bg-size-[{}]", normalize_arbitrary_value(value)),
    }
}

fn format_bg_repeat(value: &str, prefix: &str) -> String {
    match value {
        "repeat" => format!("{prefix}bg-repeat"),
        "no-repeat" => format!("{prefix}bg-no-repeat"),
        value => {
            let suffix = value.strip_prefix("repeat-").unwrap_or(value);
            format!("{prefix}bg-repeat-{suffix}")
        }
    }
}

fn format_content(value: &str, prefix: &str) -> String {
    if value == "none" {
        return format!("{prefix}content-none");
    }
    if value.starts_with("--") {
        return format!("{prefix}content-({value})");
    }
    let inner = if value.starts_with('"') && value.ends_with('"') && value.len() >= 2 {
        format!("'{}'", &value[1..value.len() - 1])
    } else {
        value.to_string()
    };
    format!("{prefix}content-[{inner}]")
}

fn format_number_class(key: &str, value: f64, prefix: &str) -> String {
    let is_negative = value < 0.0;
    let final_value = format_abs_number(value);

    if is_negative {
        format!("{prefix}-{key}-{final_value}")
    } else {
        format!("{prefix}{key}-{final_value}")
    }
}

fn format_abs_number(value: f64) -> String {
    let abs_value = value.abs();
    if abs_value.fract() == 0.0 {
        #[allow(clippy::cast_possible_truncation)]
        (abs_value as i64).to_string()
    } else {
        abs_value.to_string()
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

fn normalize_arbitrary_value(value: &str) -> String {
    let stripped = value
        .strip_prefix('[')
        .and_then(|inner| inner.strip_suffix(']'))
        .unwrap_or(value);
    stripped.split_whitespace().collect::<Vec<_>>().join("_")
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
    fn lowers_background_image_object_syntax() {
        let object = StaticSzObject {
            properties: vec![property(
                "bgImg",
                StaticSzValue::Object(StaticSzObject {
                    properties: vec![
                        property("gradient", StaticSzValue::String("linear".to_string())),
                        property("dir", StaticSzValue::String("to-br".to_string())),
                    ],
                }),
            )],
        };

        assert_eq!(lower_static_sz_object(&object), ["bg-linear-to-br"]);
    }

    #[test]
    fn lowers_background_size_and_content_special_cases() {
        let object = StaticSzObject {
            properties: vec![property(
                "before",
                StaticSzValue::Object(StaticSzObject {
                    properties: vec![
                        property("bgSize", StaticSzValue::String("24px 24px".to_string())),
                        property("bgRepeat", StaticSzValue::String("no-repeat".to_string())),
                        property("content", StaticSzValue::String("''".to_string())),
                    ],
                }),
            )],
        };

        assert_eq!(
            lower_static_sz_object(&object),
            [
                "before:bg-size-[24px_24px]",
                "before:bg-no-repeat",
                "before:content-['']"
            ]
        );
    }

    #[test]
    fn lowers_display_position_visibility_to_bare_utilities() {
        let object = StaticSzObject {
            properties: vec![
                property("display", StaticSzValue::String("flex".to_string())),
                property("position", StaticSzValue::String("absolute".to_string())),
                property("visibility", StaticSzValue::String("visible".to_string())),
            ],
        };
        assert_eq!(
            lower_static_sz_object(&object),
            ["flex", "absolute", "visible"]
        );
    }

    #[test]
    fn lowers_display_none_and_visibility_hidden_to_aliases() {
        let object = StaticSzObject {
            properties: vec![
                property("display", StaticSzValue::String("none".to_string())),
                property("visibility", StaticSzValue::String("hidden".to_string())),
                property("display", StaticSzValue::String("inline-flex".to_string())),
            ],
        };
        assert_eq!(
            lower_static_sz_object(&object),
            ["hidden", "invisible", "inline-flex"]
        );
    }

    #[test]
    fn escapes_spaces_in_arbitrary_values() {
        let object = StaticSzObject {
            properties: vec![property(
                "gridCols",
                StaticSzValue::String("280px minmax(0,1fr)".to_string()),
            )],
        };
        assert_eq!(
            lower_static_sz_object(&object),
            ["grid-cols-[280px_minmax(0,1fr)]"]
        );
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
                candidate_classes: Vec::new(),
                dynamic_css_vars: Vec::new(),
            }],
            unsupported_sz_attribute_spans: Vec::new(),
            class_attributes: vec![ClassAttributeIr {
                attribute_span: TextSpan::new(28, 46).expect("valid span"),
                value_span: TextSpan::new(39, 44).expect("valid span"),
                value: "block".to_string(),
                expression_span: None,
            }],
            extracted_classes: Vec::new(),
            style_attributes: Vec::new(),
            recovery_attributes: Vec::new(),
            unsupported_recovery_attribute_spans: Vec::new(),
            jsx_opening_elements: Vec::new(),
        };

        let lowered = lower_source_ir_classes(&ir);

        assert_eq!(lowered.classes, ["inset-s-4"]);
        assert_eq!(lowered.raw_class_names, ["block"]);
    }
}
