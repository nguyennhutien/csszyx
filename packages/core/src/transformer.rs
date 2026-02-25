use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

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
                let new_prefix = if prefix.is_empty() {
                    format!("{key}:")
                } else {
                    format!("{prefix}{key}:")
                };
                process_sz_object(nested_obj, &new_prefix, classes);
            }
        }
    }
}

fn format_primitive_class(key: &str, value: &PrimitiveValue, prefix: &str) -> String {
    match value {
        PrimitiveValue::Bool(true) => format!("{prefix}{key}"),
        PrimitiveValue::Bool(false) => String::new(),
        PrimitiveValue::Number(n) => {
            // Correct negative value handling: m: -4 -> -m-4
            if *n < 0.0 {
                let abs_val = n.abs();
                if abs_val.fract() == 0.0 {
                    #[allow(clippy::cast_possible_truncation)]
                    let int_val = abs_val as i64; // Safe: CSS values are small integers
                    format!("{prefix}-{key}-{int_val}")
                } else {
                    format!("{prefix}-{key}-{abs_val}")
                }
            } else if n.fract() == 0.0 {
                #[allow(clippy::cast_possible_truncation)]
                let int_val = *n as i64; // Safe: CSS values are small integers
                format!("{prefix}{key}-{int_val}")
            } else {
                format!("{prefix}{key}-{n}")
            }
        }
        PrimitiveValue::String(s) => {
            // Handle color opacity: bg-red-500/50 or text-blue-600/75
            if s.contains('/') {
                // Color with opacity modifier
                return format!("{prefix}{key}-{s}");
            }

            let is_negative = s.starts_with('-');
            let base_val = if is_negative { &s[1..] } else { s };

            // Auto-bracket for arbitrary values (contains units or special chars)
            let final_val = if needs_brackets(base_val) {
                format!("[{base_val}]")
            } else {
                base_val.to_string()
            };

            if is_negative {
                // Negative string: m: "-4" -> -m-4
                format!("{prefix}-{key}-{final_val}")
            } else {
                // Positive string: bg: "red-500" -> bg-red-500
                format!("{prefix}{key}-{final_val}")
            }
        }
    }
}

fn needs_brackets(val: &str) -> bool {
    // Already bracketed
    if val.starts_with('[') && val.ends_with(']') {
        return false;
    }

    // Contains CSS units or arbitrary value indicators
    let units = ["px", "rem", "em", "vh", "vw", "%", "deg", "ms", "s"];
    for unit in units {
        if val.ends_with(unit) && val.len() > unit.len() {
            let prefix = &val[..val.len() - unit.len()];
            if prefix.chars().all(|c| c.is_numeric() || c == '.') {
                return true;
            }
        }
    }

    // Contains spaces, hex colors, or custom variables
    val.contains(' ') || val.starts_with('#') || val.starts_with("var(")
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
    fn test_color_opacity() {
        let mut obj = HashMap::new();
        obj.insert(
            "bg".to_string(),
            SzValue::Primitive(PrimitiveValue::String("red-500/50".to_string())),
        );
        obj.insert(
            "text".to_string(),
            SzValue::Primitive(PrimitiveValue::String("blue-600/75".to_string())),
        );

        let mut classes = Vec::new();
        process_sz_object(&obj, "", &mut classes);

        assert!(classes.contains(&"bg-red-500/50".to_string()));
        assert!(classes.contains(&"text-blue-600/75".to_string()));
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
