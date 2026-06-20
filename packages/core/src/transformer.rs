use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

use crate::transform::generated::tables::{
    boolean_class, is_removed_boolean_sugar, property_prefix, variant_prefix,
};
use crate::transform::lower::{
    format_font_stretch, gradient_stop_prefix, is_decimal_ratio, is_integer_percent,
    normalize_arbitrary_value,
};

/// Value types supported by the sz prop.
#[derive(Serialize, Deserialize, Debug)]
#[serde(untagged)]
pub enum SzValue {
    /// A single primitive value (string, number, or boolean)
    Primitive(PrimitiveValue),
    /// A nested object for variants (hover, focus, etc.)
    Nested(HashMap<String, Self>),
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

/// Transforms a csszyx sz object into a Tailwind CSS className string in Rust for maximum performance.
///
/// Phase 3 Enhancements:
/// - Handles nested variants (hover, focus, md, etc.)
/// - Handles negative values (m: -4 -> -m-4)
/// - Handles boolean flags
#[wasm_bindgen]
pub fn transform_sz(val: JsValue) -> Result<String, JsValue> {
    let sz_prop: HashMap<String, SzValue> = serde_wasm_bindgen::from_value(val)?;
    let mut classes = Vec::new();

    process_sz_object(&sz_prop, "", &mut classes);

    Ok(classes.join(" "))
}

fn process_sz_object(obj: &HashMap<String, SzValue>, prefix: &str, classes: &mut Vec<String>) {
    for (key, value) in obj {
        match value {
            SzValue::Primitive(prim) => {
                let class_name = format_primitive_class(key, prim, prefix);
                if !class_name.is_empty() {
                    classes.push(class_name);
                }
            }
            SzValue::Nested(nested_obj) => {
                let variant = variant_prefix(key).unwrap_or(key);
                let new_prefix = if prefix.is_empty() {
                    format!("{variant}:")
                } else {
                    format!("{prefix}{variant}:")
                };
                process_sz_object(nested_obj, &new_prefix, classes);
            }
        }
    }
}

fn format_primitive_class(key: &str, value: &PrimitiveValue, prefix: &str) -> String {
    let class_key = property_prefix(key).unwrap_or(key);

    match value {
        // Removed boolean-sugar aliases (flex/absolute/italic/...) emit nothing;
        // the canonical key with a value is the only spelling now.
        PrimitiveValue::Bool(true) if is_removed_boolean_sugar(key) => String::new(),
        PrimitiveValue::Bool(true) => {
            let class_name = boolean_class(key).unwrap_or(class_key);
            format!("{prefix}{class_name}")
        }
        PrimitiveValue::Bool(false) => String::new(),
        PrimitiveValue::Number(n) => {
            // Gradient color-stop positions render as a bare percent: from-50%.
            if let Some(grad) = gradient_stop_prefix(key) {
                let pct = if n.fract() == 0.0 {
                    #[allow(clippy::cast_possible_truncation)]
                    let int_val = *n as i64;
                    int_val.to_string()
                } else {
                    n.to_string()
                };
                return format!("{prefix}{grad}-{pct}%");
            }
            // Correct negative value handling: m: -4 -> -m-4
            if *n < 0.0 {
                let abs_val = n.abs();
                if abs_val.fract() == 0.0 {
                    #[allow(clippy::cast_possible_truncation)]
                    let int_val = abs_val as i64; // Safe: CSS values are small integers
                    format!("{prefix}-{class_key}-{int_val}")
                } else {
                    format!("{prefix}-{class_key}-{abs_val}")
                }
            } else if n.fract() == 0.0 {
                #[allow(clippy::cast_possible_truncation)]
                let int_val = *n as i64; // Safe: CSS values are small integers
                format!("{prefix}{class_key}-{int_val}")
            } else {
                format!("{prefix}{class_key}-{n}")
            }
        }
        PrimitiveValue::String(s) => {
            // String slash opacity ("blue-500/20") is not supported.
            // Use { color, op } object form via the TypeScript compiler.
            // Warning is emitted at the TypeScript boundary (compiler.ts)
            // before transform_sz is called, so we only suppress here.
            if has_slash_opacity(s) {
                return String::new();
            }

            // Single-property utilities carry their value as a bare Tailwind
            // class (`flex`, `absolute`, `uppercase`, `italic`, `underline`,
            // `antialiased`), not a `display-flex` prefix-value pair. Mirrors the
            // static lowering path (transform/lower.rs).
            if let Some(class_name) = single_property_class(key, s) {
                return format!("{prefix}{class_name}");
            }

            // Bracket the whole value (sign included) when it needs arbitrary
            // syntax, then hoist a surviving leading `-` to the utility prefix —
            // a negative length stays inside the bracket (top-[-1px]) while a bare
            // negative fraction hoists (-inset-1/2). Mirrors transform/lower.rs.
            let final_val = if key == "aspect" && is_decimal_ratio(s) {
                format!("[{s}]")
            } else if needs_brackets(s) {
                format!("[{}]", normalize_arbitrary_value(s))
            } else {
                s.clone()
            };

            final_val.strip_prefix('-').map_or_else(
                || format!("{prefix}{class_key}-{final_val}"),
                |stripped| format!("{prefix}-{class_key}-{stripped}"),
            )
        }
    }
}

/// Maps a single-property utility (display/position/visibility/isolation/
/// text-transform/font-style/font-smoothing/text-decoration-line) to its bare
/// Tailwind class. Mirrors the string special-cases in transform/lower.rs and
/// the TypeScript transform. Returns `None` for any other key or an unsupported
/// value (which then warns/falls through at the TypeScript boundary).
#[allow(clippy::too_many_lines)]
fn single_property_class(key: &str, value: &str) -> Option<String> {
    match key {
        "display" => Some(if value == "none" {
            "hidden".to_string()
        } else {
            value.to_string()
        }),
        "position" => Some(value.to_string()),
        "visibility" => Some(if value == "hidden" {
            "invisible".to_string()
        } else {
            value.to_string()
        }),
        "isolation" => Some(if value == "isolate" {
            "isolate".to_string()
        } else {
            format!("isolation-{value}")
        }),
        "textTransform" => match value {
            "none" | "normal-case" => Some("normal-case".to_string()),
            "uppercase" | "lowercase" | "capitalize" => Some(value.to_string()),
            _ => None,
        },
        "fontStyle" => match value {
            "italic" => Some("italic".to_string()),
            "normal" => Some("not-italic".to_string()),
            _ => None,
        },
        "fontSmoothing" => match value {
            "grayscale" => Some("antialiased".to_string()),
            "subpixel" => Some("subpixel-antialiased".to_string()),
            _ => None,
        },
        "decoration" => match value {
            "none" => Some("no-underline".to_string()),
            "underline" | "overline" | "line-through" | "no-underline" => Some(value.to_string()),
            _ => None,
        },
        // listStyleType: standard keywords bare, CSS vars paren, else arbitrary.
        "list" | "listStyle" => Some(if value.starts_with("--") {
            format!("list-({value})")
        } else if matches!(value, "none" | "disc" | "decimal") {
            format!("list-{value}")
        } else {
            format!("list-[{value}]")
        }),
        // alignContent → Tailwind content-* utilities (distinct from `content`).
        "alignContent" => Some(format!("content-{value}")),
        // mask-* sub-properties collapse the sub-axis (maskPos: center → mask-center).
        "maskPos" | "maskSize" | "maskShape" | "maskComposite" | "maskMode" => {
            Some(format!("mask-{value}"))
        }
        "maskType" => Some(format!("mask-type-{value}")),
        "maskRepeat" => Some(match value {
            "repeat" => "mask-repeat".to_string(),
            "no-repeat" => "mask-no-repeat".to_string(),
            _ => format!("mask-{value}"),
        }),
        // font-variant-numeric values emit bare (normal-nums, tabular-nums).
        "fontVariant" => match value {
            "normal-nums" | "ordinal" | "slashed-zero" | "lining-nums" | "oldstyle-nums"
            | "proportional-nums" | "tabular-nums" | "diagonal-fractions" | "stacked-fractions" => {
                Some(value.to_string())
            }
            _ => None,
        },
        // scroll-snap direct maps (sub-axis dropped, except snap-align-none).
        "snapAlign" => match value {
            "start" => Some("snap-start".to_string()),
            "end" => Some("snap-end".to_string()),
            "center" => Some("snap-center".to_string()),
            "none" => Some("snap-align-none".to_string()),
            _ => None,
        },
        "snapStrictness" => match value {
            "mandatory" => Some("snap-mandatory".to_string()),
            "proximity" => Some("snap-proximity".to_string()),
            _ => None,
        },
        "snapStop" => match value {
            "normal" => Some("snap-normal".to_string()),
            "always" => Some("snap-always".to_string()),
            _ => None,
        },
        "snapType" => match value {
            "none" => Some("snap-none".to_string()),
            "x" => Some("snap-x".to_string()),
            "y" => Some("snap-y".to_string()),
            "both" => Some("snap-both".to_string()),
            _ => None,
        },
        // Named container: { '@container': 'sidebar' } → @container/sidebar.
        "@container" => Some(format!("@container/{value}")),
        // font-stretch: keywords use font-, integer percents bare, decimals bracket.
        "fontStretch" => Some(format_font_stretch(value)),
        // transformStyle: 'flat' | '3d' → transform-flat, transform-3d.
        "transformStyle" => Some(format!("transform-{value}")),
        // perspective-origin: named keywords bare, the rest arbitrary.
        "perspectiveOrigin" => Some(
            if matches!(
                value,
                "center"
                    | "top"
                    | "right"
                    | "bottom"
                    | "left"
                    | "top-left"
                    | "top-right"
                    | "bottom-left"
                    | "bottom-right"
            ) {
                format!("perspective-origin-{value}")
            } else {
                format!("perspective-origin-[{}]", normalize_arbitrary_value(value))
            },
        ),
        // Filter functions whose string value is always arbitrary (brightness-[1.25]);
        // scale: '3d' is the one keyword.
        "brightness" | "contrast" | "saturate" | "scale" | "backdropBrightness"
        | "backdropContrast" | "backdropSaturate" => {
            if value == "3d" && key == "scale" {
                Some("scale-3d".to_string())
            } else {
                let prop = property_prefix(key).unwrap_or(key);
                Some(if value.starts_with("--") {
                    format!("{prop}-({value})")
                } else {
                    format!("{prop}-[{value}]")
                })
            }
        }
        // Composite/function values are arbitrary when they carry a function,
        // underscore, percent, or a unit/space; otherwise fall through to generic.
        "origin" | "ease" | "animate" | "filter" | "backdropFilter" | "dropShadow"
            if needs_brackets(value)
                || value.contains('(')
                || value.contains('_')
                || value.contains('%') =>
        {
            let prop = property_prefix(key).unwrap_or(key);
            Some(format!("{prop}-[{}]", normalize_arbitrary_value(value)))
        }
        // Gradient color-stop positions reuse the from/via/to prefix.
        _ if gradient_stop_prefix(key).is_some() => {
            let grad = gradient_stop_prefix(key).unwrap_or(key);
            Some(if value.starts_with("--") {
                format!("{grad}-({value})")
            } else if is_integer_percent(value) {
                format!("{grad}-{value}")
            } else {
                format!("{grad}-[{value}]")
            })
        }
        _ => None,
    }
}

/// CSS units that require arbitrary brackets in Tailwind.
/// Must stay in sync with TypeScript needsArbitraryBrackets() in transform-core.ts.
const CSS_UNITS: &[&str] = &[
    "px", "rem", "em", "%", "vh", "vw", "ch", "dvh", "dvw", "svh", "svw", "lvh", "lvw", "cqw",
    "cqh", "deg", "rad", "turn", "grad", "ms", "s", "fr",
];

/// Detects slash opacity in string form: "blue-500/20", "brand-primary-500/50".
/// Only matches color-scale/opacity patterns (digit before slash),
/// not fractions like "1/2" or other slash usage.
fn has_slash_opacity(s: &str) -> bool {
    // A numeric ratio (4/2.5, -1/2) or a function value (calc(100/5)) is a real
    // arbitrary value, not opacity — only a color/opacity slash is suppressed.
    if s.contains('(') || is_decimal_ratio(s) {
        return false;
    }
    s.find('/')
        .is_some_and(|pos| pos > 0 && s.as_bytes().get(pos - 1).is_some_and(u8::is_ascii_digit))
}

/// Checks if a value needs arbitrary Tailwind brackets (e.g. bg-[#ff0000]).
///
/// Must stay in sync with TypeScript needsArbitraryBrackets() in transform-core.ts.
fn needs_brackets(val: &str) -> bool {
    // Already user-bracketed: [#333] → pass through as-is
    if val.starts_with('[') && val.ends_with(']') {
        return false;
    }

    // Color functions → must bracket for arbitrary value syntax
    if val.starts_with('#')
        || val.starts_with("rgb")
        || val.starts_with("hsl")
        || val.starts_with("oklch")
        || val.starts_with("color(")
        || val.starts_with("hwb(")
        || val.starts_with("lab(")
        || val.starts_with("lch(")
        || val.starts_with("oklab(")
    {
        return true;
    }

    // CSS function calls that need brackets
    if val.contains("calc(")
        || val.contains("var(")
        || val.contains("attr(")
        || val.contains("url(")
        || val.contains("clamp(")
        || val.contains("min(")
        || val.contains("max(")
        || val.contains(' ')
    {
        return true;
    }

    // Values starting with . followed by digits (e.g. .25em)
    if val.starts_with('.') && val.len() > 1 && val.as_bytes()[1].is_ascii_digit() {
        return true;
    }

    // CSS units — must match TypeScript's unit list exactly
    for unit in CSS_UNITS {
        if let Some(prefix) = val.strip_suffix(unit) {
            // Tolerate a leading sign so a negative length (-1px) brackets too.
            let prefix = prefix.strip_prefix('-').unwrap_or(prefix);
            if !prefix.is_empty() && prefix.chars().all(|c| c.is_ascii_digit() || c == '.') {
                return true;
            }
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn test_basic_transform() {
        let mut obj = HashMap::new();
        obj.insert(
            "p".to_string(),
            SzValue::Primitive(PrimitiveValue::Number(4.0)),
        );
        obj.insert(
            "bg".to_string(),
            SzValue::Primitive(PrimitiveValue::String("red-500".to_string())),
        );

        let mut classes = Vec::new();
        process_sz_object(&obj, "", &mut classes);

        assert!(classes.contains(&"p-4".to_string()));
        assert!(classes.contains(&"bg-red-500".to_string()));
    }

    #[test]
    fn test_nested_variants() {
        let mut nested = HashMap::new();
        nested.insert(
            "bg".to_string(),
            SzValue::Primitive(PrimitiveValue::String("blue-500".to_string())),
        );

        let mut obj = HashMap::new();
        obj.insert("hover".to_string(), SzValue::Nested(nested));

        let mut classes = Vec::new();
        process_sz_object(&obj, "", &mut classes);

        assert_eq!(classes[0], "hover:bg-blue-500");
    }

    #[test]
    fn test_generated_property_and_boolean_maps() {
        let mut obj = HashMap::new();
        obj.insert(
            "start".to_string(),
            SzValue::Primitive(PrimitiveValue::Number(4.0)),
        );
        obj.insert(
            "display".to_string(),
            SzValue::Primitive(PrimitiveValue::String("inline-block".to_string())),
        );

        let mut classes = Vec::new();
        process_sz_object(&obj, "", &mut classes);

        assert!(classes.contains(&"inset-s-4".to_string()));
        assert!(classes.contains(&"inline-block".to_string()));
    }

    #[test]
    fn test_runtime_drops_removed_sugar_and_lowers_canonical() {
        // Removed boolean sugar emits nothing at runtime; the canonical string
        // forms emit the bare utility; the flex shorthand is untouched.
        let mut obj = HashMap::new();
        obj.insert(
            "flex".to_string(),
            SzValue::Primitive(PrimitiveValue::Bool(true)),
        );
        obj.insert(
            "italic".to_string(),
            SzValue::Primitive(PrimitiveValue::Bool(true)),
        );
        let mut removed = Vec::new();
        process_sz_object(&obj, "", &mut removed);
        assert!(removed.is_empty(), "removed sugar must emit nothing");

        let cases = [
            ("display", "flex", "flex"),
            ("position", "absolute", "absolute"),
            ("fontStyle", "italic", "italic"),
            ("decoration", "underline", "underline"),
            ("fontSmoothing", "grayscale", "antialiased"),
            ("textTransform", "uppercase", "uppercase"),
        ];
        for (key, value, expected) in cases {
            let mut single = HashMap::new();
            single.insert(
                key.to_string(),
                SzValue::Primitive(PrimitiveValue::String(value.to_string())),
            );
            let mut out = Vec::new();
            process_sz_object(&single, "", &mut out);
            assert_eq!(out, [expected.to_string()], "{key}: {value}");
        }

        let mut shorthand = HashMap::new();
        shorthand.insert(
            "flex".to_string(),
            SzValue::Primitive(PrimitiveValue::Number(1.0)),
        );
        let mut out = Vec::new();
        process_sz_object(&shorthand, "", &mut out);
        assert_eq!(out, ["flex-1".to_string()]);
    }

    #[test]
    fn test_negative_values() {
        let mut obj = HashMap::new();
        obj.insert(
            "m".to_string(),
            SzValue::Primitive(PrimitiveValue::Number(-4.0)),
        );

        let mut classes = Vec::new();
        process_sz_object(&obj, "", &mut classes);

        // Fixed: Tailwind negative syntax is -m-4
        assert_eq!(classes[0], "-m-4");
    }

    #[test]
    fn test_slash_opacity_suppressed() {
        // String slash opacity must be suppressed — use object form via TS compiler
        let mut obj = HashMap::new();
        obj.insert(
            "bg".to_string(),
            SzValue::Primitive(PrimitiveValue::String("red-500/50".to_string())),
        );
        obj.insert(
            "text".to_string(),
            SzValue::Primitive(PrimitiveValue::String("blue-600/75".to_string())),
        );
        obj.insert(
            "bg2".to_string(),
            SzValue::Primitive(PrimitiveValue::String("brand-500/20".to_string())),
        );

        let mut classes = Vec::new();
        process_sz_object(&obj, "", &mut classes);

        // None of the slash-opacity strings should produce a class
        assert!(!classes.iter().any(|c| c.contains('/')));
    }

    #[test]
    fn test_has_slash_opacity() {
        assert!(has_slash_opacity("blue-500/20"));
        assert!(has_slash_opacity("brand-500/50"));
        assert!(has_slash_opacity("w-1/2")); // digit before slash → true; color filter is upstream
        assert!(!has_slash_opacity("blue-500")); // no slash
    }

    #[test]
    fn test_needs_brackets_extended() {
        // These were missing from old needs_brackets — must now bracket correctly
        assert!(needs_brackets("rgb(255,0,0)"));
        assert!(needs_brackets("hsl(200,50%,50%)"));
        assert!(needs_brackets("oklch(50% 0.1 200)"));
        assert!(needs_brackets("50dvh"));
        assert!(needs_brackets("1fr"));
        assert!(needs_brackets("1ch"));
        assert!(needs_brackets("90rad"));
        assert!(needs_brackets("180turn"));
        // These must NOT bracket
        assert!(!needs_brackets("red-500"));
        assert!(!needs_brackets("[#333]"));
        assert!(!needs_brackets("4"));
    }

    #[test]
    fn test_valid_color_passthrough() {
        let mut obj = HashMap::new();
        obj.insert(
            "bg".to_string(),
            SzValue::Primitive(PrimitiveValue::String("brand-500".to_string())),
        );
        obj.insert(
            "text".to_string(),
            SzValue::Primitive(PrimitiveValue::String("red-500".to_string())),
        );

        let mut classes = Vec::new();
        process_sz_object(&obj, "", &mut classes);

        assert!(classes.contains(&"bg-brand-500".to_string()));
        assert!(classes.contains(&"text-red-500".to_string()));
    }

    #[test]
    fn test_whole_numbers_no_decimal() {
        let mut obj = HashMap::new();
        obj.insert(
            "p".to_string(),
            SzValue::Primitive(PrimitiveValue::Number(4.0)),
        );
        obj.insert(
            "m".to_string(),
            SzValue::Primitive(PrimitiveValue::Number(-2.0)),
        );

        let mut classes = Vec::new();
        process_sz_object(&obj, "", &mut classes);

        // Should output integers without .0
        assert!(classes.contains(&"p-4".to_string()));
        assert!(classes.contains(&"-m-2".to_string()));
    }
}
