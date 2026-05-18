use serde::{Deserialize, Serialize};

/// Byte span in the original UTF-8 source string.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextSpan {
    /// Inclusive start byte offset.
    pub start: u32,
    /// Exclusive end byte offset.
    pub end: u32,
}

impl TextSpan {
    /// Creates a span if the offsets are ordered.
    ///
    /// # Errors
    ///
    /// Returns [`IrError::InvalidSpan`] when `start > end`.
    pub const fn new(start: u32, end: u32) -> Result<Self, IrError> {
        if start > end {
            return Err(IrError::InvalidSpan { start, end });
        }

        Ok(Self { start, end })
    }

    /// Returns the span length in bytes.
    pub const fn len(self) -> u32 {
        self.end - self.start
    }

    /// Returns true when the span is empty.
    pub const fn is_empty(self) -> bool {
        self.start == self.end
    }
}

/// Parser-neutral representation of one source module.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SourceIr {
    /// Absolute or project-relative filename used for diagnostics/cache keys.
    pub filename: String,
    /// Full source span.
    pub source_span: TextSpan,
    /// JSX `sz` attributes found in source order.
    pub sz_attributes: Vec<SzAttributeIr>,
    /// Static class/className attributes found in source order.
    pub class_attributes: Vec<ClassAttributeIr>,
}

impl SourceIr {
    /// Creates an empty IR shell for a source module.
    pub const fn empty(filename: String, source_len: u32) -> Self {
        Self {
            filename,
            source_span: TextSpan {
                start: 0,
                end: source_len,
            },
            sz_attributes: Vec::new(),
            class_attributes: Vec::new(),
        }
    }

    /// Returns true when the parser found no csszyx-relevant JSX attributes.
    pub const fn is_noop(&self) -> bool {
        self.sz_attributes.is_empty() && self.class_attributes.is_empty()
    }
}

/// JSX `sz` attribute and its parser-normalized static object.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SzAttributeIr {
    /// Full attribute span, including the `sz` name.
    pub attribute_span: TextSpan,
    /// Expression/object span that should be replaced during rewrite.
    pub value_span: TextSpan,
    /// Static object extracted from the attribute.
    pub object: StaticSzObject,
}

/// Static class/className attribute.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClassAttributeIr {
    /// Full attribute span.
    pub attribute_span: TextSpan,
    /// String literal value span without quote characters.
    pub value_span: TextSpan,
    /// Raw class string exactly as parsed after JS string unescaping.
    pub value: String,
}

/// Ordered static sz object.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StaticSzObject {
    /// Properties in source order. Duplicate keys are intentionally preserved so
    /// later lowering can match JavaScript object semantics explicitly.
    pub properties: Vec<StaticSzProperty>,
}

impl StaticSzObject {
    /// Creates an empty static object.
    pub const fn empty() -> Self {
        Self {
            properties: Vec::new(),
        }
    }

    /// Returns true when the object has no properties.
    pub const fn is_empty(&self) -> bool {
        self.properties.is_empty()
    }
}

/// Static sz property.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StaticSzProperty {
    /// Source key text after string-literal unescaping.
    pub key: String,
    /// Full property span.
    pub span: TextSpan,
    /// Static value.
    pub value: StaticSzValue,
}

/// Parser-normalized static sz value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "kebab-case")]
pub enum StaticSzValue {
    /// String literal.
    String(String),
    /// Numeric literal.
    Number(f64),
    /// Boolean literal.
    Boolean(bool),
    /// Nested object for variants and conditional branches.
    Object(StaticSzObject),
}

/// IR validation and construction errors.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IrError {
    /// Span start offset is greater than end offset.
    InvalidSpan {
        /// Inclusive start byte offset.
        start: u32,
        /// Exclusive end byte offset.
        end: u32,
    },
}

impl std::fmt::Display for IrError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidSpan { start, end } => {
                write!(f, "invalid source span: start {start} is after end {end}")
            }
        }
    }
}

impl std::error::Error for IrError {}

#[cfg(test)]
mod tests {
    use super::{
        ClassAttributeIr, SourceIr, StaticSzObject, StaticSzProperty, StaticSzValue, SzAttributeIr,
        TextSpan,
    };

    #[test]
    fn span_rejects_reversed_offsets() {
        let err = TextSpan::new(10, 3).expect_err("span should reject reversed offsets");

        assert_eq!(
            err.to_string(),
            "invalid source span: start 10 is after end 3"
        );
    }

    #[test]
    fn empty_source_ir_reports_noop() {
        let ir = SourceIr::empty("/repo/src/App.tsx".to_string(), 128);

        assert!(ir.is_noop());
        assert_eq!(ir.source_span.len(), 128);
    }

    #[test]
    fn source_ir_keeps_source_order_and_duplicate_keys() {
        let object = StaticSzObject {
            properties: vec![
                StaticSzProperty {
                    key: "p".to_string(),
                    span: TextSpan::new(12, 16).expect("valid span"),
                    value: StaticSzValue::Number(4.0),
                },
                StaticSzProperty {
                    key: "hover".to_string(),
                    span: TextSpan::new(18, 42).expect("valid span"),
                    value: StaticSzValue::Object(StaticSzObject {
                        properties: vec![StaticSzProperty {
                            key: "p".to_string(),
                            span: TextSpan::new(27, 31).expect("valid span"),
                            value: StaticSzValue::Number(2.0),
                        }],
                    }),
                },
                StaticSzProperty {
                    key: "p".to_string(),
                    span: TextSpan::new(44, 48).expect("valid span"),
                    value: StaticSzValue::Number(6.0),
                },
            ],
        };
        let ir = SourceIr {
            filename: "/repo/src/App.tsx".to_string(),
            source_span: TextSpan::new(0, 80).expect("valid span"),
            sz_attributes: vec![SzAttributeIr {
                attribute_span: TextSpan::new(5, 52).expect("valid span"),
                value_span: TextSpan::new(9, 51).expect("valid span"),
                object,
            }],
            class_attributes: vec![ClassAttributeIr {
                attribute_span: TextSpan::new(54, 72).expect("valid span"),
                value_span: TextSpan::new(65, 70).expect("valid span"),
                value: "block".to_string(),
            }],
        };

        assert!(!ir.is_noop());
        let keys: Vec<_> = ir.sz_attributes[0]
            .object
            .properties
            .iter()
            .map(|prop| prop.key.as_str())
            .collect();

        assert_eq!(keys, ["p", "hover", "p"]);
    }
}
