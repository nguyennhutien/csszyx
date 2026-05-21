use serde::{Deserialize, Serialize};

use super::RecoveryMode;

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
    /// JSX `sz` attribute spans that could not be lowered statically.
    pub unsupported_sz_attribute_spans: Vec<TextSpan>,
    /// Class/className attributes found in source order.
    pub class_attributes: Vec<ClassAttributeIr>,
    /// Classes extracted from static `dynamic({...})` calls.
    pub extracted_classes: Vec<String>,
    /// Style attributes found in source order.
    pub style_attributes: Vec<StyleAttributeIr>,
    /// Static `szRecover` attributes found in source order.
    pub recovery_attributes: Vec<RecoveryAttributeIr>,
    /// `szRecover` attribute spans that could not emit a token.
    pub unsupported_recovery_attribute_spans: Vec<TextSpan>,
    /// JSX opening elements that contain csszyx-relevant static attributes.
    pub jsx_opening_elements: Vec<JsxOpeningElementIr>,
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
            unsupported_sz_attribute_spans: Vec::new(),
            class_attributes: Vec::new(),
            extracted_classes: Vec::new(),
            style_attributes: Vec::new(),
            recovery_attributes: Vec::new(),
            unsupported_recovery_attribute_spans: Vec::new(),
            jsx_opening_elements: Vec::new(),
        }
    }

    /// Returns true when the parser found no csszyx-relevant JSX attributes.
    pub const fn is_noop(&self) -> bool {
        self.sz_attributes.is_empty()
            && self.unsupported_sz_attribute_spans.is_empty()
            && self.class_attributes.is_empty()
            && self.recovery_attributes.is_empty()
            && self.unsupported_recovery_attribute_spans.is_empty()
    }
}

/// JSX opening element with indices into source-level attribute collections.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct JsxOpeningElementIr {
    /// Full opening-element span.
    pub opening_span: TextSpan,
    /// Static `sz` attribute indices in [`SourceIr::sz_attributes`].
    pub sz_attribute_indices: Vec<usize>,
    /// Class/className attribute index in [`SourceIr::class_attributes`].
    pub class_attribute_index: Option<usize>,
    /// Style attribute index in [`SourceIr::style_attributes`].
    pub style_attribute_index: Option<usize>,
    /// Static `szRecover` attribute index in [`SourceIr::recovery_attributes`].
    pub recovery_attribute_index: Option<usize>,
    /// Whether the opening element already has `data-sz-recovery-token`.
    pub has_recovery_token_attribute: bool,
    /// End offset of the last JSX attribute on the opening element.
    pub last_attribute_end: Option<u32>,
    /// String form of the JSX element name used by recovery tokens.
    pub element_name: String,
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
    /// Static class string from `sz="..."` syntax.
    pub literal_class_name: Option<String>,
    /// Whether an empty class result should still rewrite to `className=""`.
    pub rewrites_empty_class: bool,
    /// Static ternary form — present when `sz={cond ? A : B}` lowered cleanly
    /// with both branches collapsing to static class lists. When set, the
    /// attribute carries no static object/literal; rewriters emit a
    /// `className={cond ? "…" : "…"}` expression in place of the original
    /// `sz` attribute. When unset the attribute follows the regular static
    /// object/literal path.
    pub ternary: Option<StaticTernaryIr>,
    /// Runtime fallback marker — set when the sz expression contains shapes
    /// the static lowering layer cannot fully resolve at compile time but
    /// that the runtime `_sz(...)` helper still handles correctly (today:
    /// object literals with at least one conditional-expression spread).
    /// When set the rewriter emits `className={_sz(source[value_span])}`
    /// and the engine forces `metadata.uses_runtime = true` so downstream
    /// import injection picks the helper up. No classes are collected from
    /// these attributes because the runtime is the source of truth.
    pub runtime_fallback: bool,
    /// Dynamic object properties emitted through CSS custom properties.
    pub dynamic_css_vars: Vec<DynamicCssVarIr>,
}

/// Pre-lowered class lists for a static ternary `sz={cond ? A : B}` attribute.
///
/// The test span points at the conditional expression's `test` portion in the
/// original source so rewriters can splice the user's exact `cond` text back
/// into the emitted `className={…}` without re-parsing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StaticTernaryIr {
    /// Source span of the ternary `test` expression.
    pub test_span: TextSpan,
    /// Classes produced by lowering the consequent branch, in source order.
    pub consequent_classes: Vec<String>,
    /// Classes produced by lowering the alternate branch, in source order.
    pub alternate_classes: Vec<String>,
}

/// Class/className attribute.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClassAttributeIr {
    /// Full attribute span.
    pub attribute_span: TextSpan,
    /// String literal value span without quote characters.
    pub value_span: TextSpan,
    /// Raw class string exactly as parsed after JS string unescaping.
    pub value: String,
    /// Dynamic expression span for `className={expr}` / `class={expr}`.
    pub expression_span: Option<TextSpan>,
}

/// JSX style attribute.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StyleAttributeIr {
    /// Full attribute span.
    pub attribute_span: TextSpan,
    /// Dynamic expression span for `style={expr}`.
    pub expression_span: Option<TextSpan>,
}

/// Dynamic sz object property lowered to a CSS variable class + style prop.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DynamicCssVarIr {
    /// Source key text.
    pub key: String,
    /// Tailwind utility prefix.
    pub class_prefix: String,
    /// CSS custom property name, for example `--_sz-p`.
    pub var_name: String,
    /// Value transform category.
    pub category: DynamicCssVarCategory,
    /// Runtime expression span in the source module.
    pub expression_span: TextSpan,
    /// Variant prefix chain as emitted by Tailwind, for example `md:hover`.
    pub variant_prefix: Option<String>,
}

/// Runtime value transform used when writing a CSS custom property.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DynamicCssVarCategory {
    /// `calc(value * var(--spacing))`.
    Spacing,
    /// `__szColorVar(value)`.
    Color,
    /// `${value}deg`.
    Angle,
    /// `${value}ms`.
    Duration,
    /// Direct stringification.
    Passthrough,
}

/// Static `szRecover` attribute.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryAttributeIr {
    /// Full attribute span.
    pub attribute_span: TextSpan,
    /// Recovery mode requested by the attribute.
    pub mode: RecoveryMode,
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
        ClassAttributeIr, JsxOpeningElementIr, SourceIr, StaticSzObject, StaticSzProperty,
        StaticSzValue, SzAttributeIr, TextSpan,
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
                literal_class_name: None,
                rewrites_empty_class: false,
                ternary: None,
                runtime_fallback: false,
                dynamic_css_vars: Vec::new(),
            }],
            unsupported_sz_attribute_spans: Vec::new(),
            class_attributes: vec![ClassAttributeIr {
                attribute_span: TextSpan::new(54, 72).expect("valid span"),
                value_span: TextSpan::new(65, 70).expect("valid span"),
                value: "block".to_string(),
                expression_span: None,
            }],
            extracted_classes: Vec::new(),
            style_attributes: Vec::new(),
            recovery_attributes: Vec::new(),
            unsupported_recovery_attribute_spans: Vec::new(),
            jsx_opening_elements: vec![JsxOpeningElementIr {
                opening_span: TextSpan::new(1, 73).expect("valid span"),
                sz_attribute_indices: vec![0],
                class_attribute_index: Some(0),
                style_attribute_index: None,
                recovery_attribute_index: None,
                has_recovery_token_attribute: false,
                last_attribute_end: Some(72),
                element_name: "div".to_string(),
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
