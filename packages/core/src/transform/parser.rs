use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Expression, JSXAttribute, JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXExpression,
    JSXOpeningElement, ObjectExpression, ObjectProperty, ObjectPropertyKind, PropertyKey,
    UnaryOperator,
};
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_span::{SourceType, Span};

use super::{
    ClassAttributeIr, JsxOpeningElementIr, SourceIr, StaticSzObject, StaticSzProperty,
    StaticSzValue, SzAttributeIr, TextSpan, TransformFile,
};

/// Parser shell output before AST walking is implemented.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedSourceShell {
    /// Parser-neutral IR shell for the source file.
    pub ir: SourceIr,
    /// Recoverable parser diagnostics.
    pub diagnostics: Vec<String>,
    /// Whether the parser reported an unrecoverable panic.
    pub panicked: bool,
}

/// Parse a source module with oxc and return an empty IR shell plus diagnostics.
///
/// The AST is intentionally not returned. Future walkers should lower parser
/// nodes into [`SourceIr`] inside this module and keep AST lifetimes private.
pub fn parse_source_shell(file: &TransformFile) -> ParsedSourceShell {
    let allocator = Allocator::default();
    let source_type = source_type_for_path(&file.filename);
    let parsed = Parser::new(&allocator, &file.source, source_type).parse();
    let source_len = u32::try_from(file.source.len()).unwrap_or(u32::MAX);
    let mut ir = SourceIr::empty(file.filename.clone(), source_len);

    if !parsed.panicked {
        let mut visitor = CsszyxIrVisitor {
            source: &file.source,
            ir: &mut ir,
        };
        visitor.visit_program(&parsed.program);
    }

    ParsedSourceShell {
        ir,
        diagnostics: parsed
            .errors
            .iter()
            .map(std::string::ToString::to_string)
            .collect(),
        panicked: parsed.panicked,
    }
}

fn source_type_for_path(filename: &str) -> SourceType {
    SourceType::from_path(filename).unwrap_or_else(|_| SourceType::tsx())
}

struct CsszyxIrVisitor<'source, 'ir> {
    source: &'source str,
    ir: &'ir mut SourceIr,
}

impl<'a> Visit<'a> for CsszyxIrVisitor<'_, '_> {
    fn visit_jsx_opening_element(&mut self, element: &JSXOpeningElement<'a>) {
        let mut sz_attribute_indices = Vec::new();
        let mut class_attribute_index = None;

        for item in &element.attributes {
            let JSXAttributeItem::Attribute(attr) = item else {
                continue;
            };
            if let Some(name) = jsx_attribute_name(&attr.name) {
                match name {
                    "sz" => {
                        if let Some(index) = self.collect_sz_attribute(attr) {
                            sz_attribute_indices.push(index);
                        }
                    }
                    "class" | "className" => {
                        if let Some(index) = self.collect_class_attribute(attr) {
                            class_attribute_index = Some(index);
                        }
                    }
                    _ => {}
                }
            }
        }

        if !sz_attribute_indices.is_empty() || class_attribute_index.is_some() {
            self.ir.jsx_opening_elements.push(JsxOpeningElementIr {
                opening_span: text_span(element.span),
                sz_attribute_indices,
                class_attribute_index,
            });
        }

        walk::walk_jsx_opening_element(self, element);
    }
}

impl CsszyxIrVisitor<'_, '_> {
    fn collect_sz_attribute(&mut self, attr: &JSXAttribute<'_>) -> Option<usize> {
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attr.value else {
            return None;
        };
        let (object, value_span) = static_object_from_jsx_expression(&container.expression)?;

        let index = self.ir.sz_attributes.len();
        self.ir.sz_attributes.push(SzAttributeIr {
            attribute_span: text_span(attr.span),
            value_span,
            object,
        });
        Some(index)
    }

    fn collect_class_attribute(&mut self, attr: &JSXAttribute<'_>) -> Option<usize> {
        let Some(JSXAttributeValue::StringLiteral(value)) = &attr.value else {
            return None;
        };

        let index = self.ir.class_attributes.len();
        self.ir.class_attributes.push(ClassAttributeIr {
            attribute_span: text_span(attr.span),
            value_span: string_value_span(value.span, self.source),
            value: value.value.to_string(),
        });
        Some(index)
    }
}

fn jsx_attribute_name<'a>(name: &'a JSXAttributeName<'a>) -> Option<&'a str> {
    match name {
        JSXAttributeName::Identifier(identifier) => Some(identifier.name.as_str()),
        JSXAttributeName::NamespacedName(_) => None,
    }
}

fn static_object_from_jsx_expression(
    expression: &JSXExpression<'_>,
) -> Option<(StaticSzObject, TextSpan)> {
    match expression {
        JSXExpression::ObjectExpression(object) => Some((
            static_object_from_object_expression(object)?,
            text_span(object.span),
        )),
        JSXExpression::ParenthesizedExpression(parenthesized) => {
            static_object_from_expression(&parenthesized.expression)
        }
        _ => None,
    }
}

fn static_object_from_expression(
    expression: &Expression<'_>,
) -> Option<(StaticSzObject, TextSpan)> {
    match expression {
        Expression::ObjectExpression(object) => Some((
            static_object_from_object_expression(object)?,
            text_span(object.span),
        )),
        Expression::ParenthesizedExpression(parenthesized) => {
            static_object_from_expression(&parenthesized.expression)
        }
        _ => None,
    }
}

fn static_object_from_object_expression(object: &ObjectExpression<'_>) -> Option<StaticSzObject> {
    let mut properties = Vec::with_capacity(object.properties.len());

    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        properties.push(static_property_from_object_property(property)?);
    }

    Some(StaticSzObject { properties })
}

fn static_property_from_object_property(property: &ObjectProperty<'_>) -> Option<StaticSzProperty> {
    if property.method || property.computed || property.shorthand {
        return None;
    }

    Some(StaticSzProperty {
        key: static_property_key(&property.key)?,
        span: text_span(property.span),
        value: static_value_from_expression(&property.value)?,
    })
}

fn static_property_key(key: &PropertyKey<'_>) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.to_string()),
        PropertyKey::StringLiteral(string) => Some(string.value.to_string()),
        _ => None,
    }
}

fn static_value_from_expression(expression: &Expression<'_>) -> Option<StaticSzValue> {
    match expression {
        Expression::StringLiteral(value) => Some(StaticSzValue::String(value.value.to_string())),
        Expression::NumericLiteral(value) => Some(StaticSzValue::Number(value.value)),
        Expression::UnaryExpression(value) => static_value_from_unary_expression(value),
        Expression::BooleanLiteral(value) => Some(StaticSzValue::Boolean(value.value)),
        Expression::ObjectExpression(value) => Some(StaticSzValue::Object(
            static_object_from_object_expression(value)?,
        )),
        Expression::ParenthesizedExpression(value) => {
            static_value_from_expression(&value.expression)
        }
        _ => None,
    }
}

fn static_value_from_unary_expression(
    expression: &oxc_ast::ast::UnaryExpression<'_>,
) -> Option<StaticSzValue> {
    let Expression::NumericLiteral(value) = &expression.argument else {
        return None;
    };

    match expression.operator {
        UnaryOperator::UnaryNegation => Some(StaticSzValue::Number(-value.value)),
        UnaryOperator::UnaryPlus => Some(StaticSzValue::Number(value.value)),
        _ => None,
    }
}

const fn text_span(span: Span) -> TextSpan {
    TextSpan {
        start: span.start,
        end: span.end,
    }
}

fn string_value_span(span: Span, source: &str) -> TextSpan {
    let bytes = source.as_bytes();
    let start = span.start as usize;
    let end = span.end as usize;

    if end > start + 1
        && matches!(bytes.get(start), Some(b'"' | b'\''))
        && bytes.get(start) == bytes.get(end - 1)
    {
        return TextSpan {
            start: span.start + 1,
            end: span.end - 1,
        };
    }

    text_span(span)
}

#[cfg(test)]
mod tests {
    use super::{parse_source_shell, source_type_for_path};
    use crate::transform::{lower::lower_source_ir_classes, TransformFile};

    #[test]
    fn parser_shell_accepts_valid_tsx() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div sz={{ p: 4 }} />;".to_string(),
        };

        let parsed = parse_source_shell(&file);

        assert!(!parsed.panicked);
        assert!(parsed.diagnostics.is_empty());
        assert_eq!(parsed.ir.filename, file.filename);
        assert_eq!(parsed.ir.sz_attributes.len(), 1);
        assert!(parsed.ir.class_attributes.is_empty());
        assert_eq!(
            parsed.ir.sz_attributes[0].value_span,
            super::TextSpan { start: 34, end: 42 }
        );
        assert_eq!(parsed.ir.sz_attributes[0].object.properties[0].key, "p");
        assert_eq!(
            parsed.ir.sz_attributes[0].object.properties[0].value,
            super::StaticSzValue::Number(4.0)
        );
    }

    #[test]
    fn parser_shell_collects_class_attributes() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div className=\"p-4 block\" />;".to_string(),
        };

        let parsed = parse_source_shell(&file);

        assert!(parsed.diagnostics.is_empty());
        assert_eq!(parsed.ir.class_attributes.len(), 1);
        assert_eq!(parsed.ir.class_attributes[0].value, "p-4 block");
        assert_eq!(
            parsed.ir.class_attributes[0].value_span,
            super::TextSpan { start: 41, end: 50 }
        );
    }

    #[test]
    fn parser_shell_preserves_nested_static_sz_object() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div sz={{ p: 4, hover: { bg: 'red-500' } }} />;"
                .to_string(),
        };

        let parsed = parse_source_shell(&file);

        assert!(parsed.diagnostics.is_empty());
        let properties = &parsed.ir.sz_attributes[0].object.properties;
        assert_eq!(properties[0].key, "p");
        assert_eq!(properties[1].key, "hover");
        assert!(matches!(
            properties[1].value,
            super::StaticSzValue::Object(_)
        ));
    }

    #[test]
    fn parser_shell_lowers_static_ir_to_classes() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source:
                "export const App = () => <div className=\"block\" sz={{ start: 4, inlineBlock: true }} />;"
                    .to_string(),
        };

        let parsed = parse_source_shell(&file);
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty());
        assert_eq!(lowered.raw_class_names, ["block"]);
        assert_eq!(lowered.classes, ["inset-s-4", "inline-block"]);
    }

    #[test]
    fn parser_shell_groups_static_attributes_by_opening_element() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source:
                "export const App = () => <><div className=\"block\" sz={{ p: 4 }} /><span sz={{ m: 2 }} /></>;"
                    .to_string(),
        };

        let parsed = parse_source_shell(&file);

        assert!(parsed.diagnostics.is_empty());
        assert_eq!(parsed.ir.sz_attributes.len(), 2);
        assert_eq!(parsed.ir.class_attributes.len(), 1);
        assert_eq!(parsed.ir.jsx_opening_elements.len(), 2);
        assert_eq!(parsed.ir.jsx_opening_elements[0].sz_attribute_indices, [0]);
        assert_eq!(
            parsed.ir.jsx_opening_elements[0].class_attribute_index,
            Some(0)
        );
        assert_eq!(parsed.ir.jsx_opening_elements[1].sz_attribute_indices, [1]);
        assert_eq!(
            parsed.ir.jsx_opening_elements[1].class_attribute_index,
            None
        );
    }

    #[test]
    fn parser_shell_lowers_static_ir_fixture_matrix() {
        let cases = [
            ("sz={{ m: -2 }}", vec!["-m-2"]),
            ("sz={{ m: +2 }}", vec!["m-2"]),
            ("sz={{ italic: false }}", vec!["not-italic"]),
            (
                "sz={{ hover: { bg: 'red-500' } }}",
                vec!["hover:bg-red-500"],
            ),
            (
                "sz={{ bgImg: 'url(/hero.png)' }}",
                vec!["bg-[url(/hero.png)]"],
            ),
            ("sz={{ bg: 'red-500/50' }}", vec![]),
        ];

        for (attribute, expected) in cases {
            let file = TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source: format!("export const App = () => <div {attribute} />;"),
            };

            let parsed = parse_source_shell(&file);
            let lowered = lower_source_ir_classes(&parsed.ir);

            assert!(parsed.diagnostics.is_empty(), "{attribute}");
            assert_eq!(lowered.classes, expected, "{attribute}");
        }
    }

    #[test]
    fn parser_shell_ignores_dynamic_sz_object_for_now() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div sz={{ ...props, p: 4 }} />;".to_string(),
        };

        let parsed = parse_source_shell(&file);

        assert!(parsed.diagnostics.is_empty());
        assert!(parsed.ir.sz_attributes.is_empty());
    }

    #[test]
    fn parser_shell_reports_invalid_tsx() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div sz={{ p: }} />;".to_string(),
        };

        let parsed = parse_source_shell(&file);

        assert!(!parsed.diagnostics.is_empty());
    }

    #[test]
    fn parser_shell_defaults_unknown_extensions_to_tsx() {
        assert!(source_type_for_path("/repo/src/App.unknown").is_jsx());
    }
}
