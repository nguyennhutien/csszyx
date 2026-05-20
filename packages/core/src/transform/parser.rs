use oxc_allocator::Allocator;
use oxc_ast::{
    ast::{
        ArrayExpression, ArrayExpressionElement, ConditionalExpression, Expression, JSXAttribute,
        JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXElementName, JSXExpression,
        JSXMemberExpression, JSXMemberExpressionObject, JSXOpeningElement, ObjectExpression,
        ObjectProperty, ObjectPropertyKind, PropertyKey, UnaryOperator,
    },
    AstKind,
};
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType, Span};
use std::time::Instant;

use super::{
    lower::lower_static_sz_object, ClassAttributeIr, JsxOpeningElementIr, RecoveryAttributeIr,
    RecoveryMode, SourceIr, StaticSzObject, StaticSzProperty, StaticSzValue, StaticTernaryIr,
    SzAttributeIr, TextSpan, TransformFile, TransformTimings,
};

/// Matches the TypeScript compiler AST budget guard.
pub const AST_BUDGET: usize = 50_000;

/// Parser shell output before AST walking is implemented.
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedSourceShell {
    /// Parser-neutral IR shell for the source file.
    pub ir: SourceIr,
    /// Recoverable parser diagnostics.
    pub diagnostics: Vec<String>,
    /// Whether the parser reported an unrecoverable panic.
    pub panicked: bool,
    /// Whether native AST traversal exceeded the csszyx budget.
    pub ast_budget_exceeded: bool,
    /// Parser/scope/IR timing breakdown.
    pub timings: TransformTimings,
}

/// Parse a source module with oxc and return an empty IR shell plus diagnostics.
///
/// The AST is intentionally not returned. Future walkers should lower parser
/// nodes into [`SourceIr`] inside this module and keep AST lifetimes private.
pub fn parse_source_shell(file: &TransformFile) -> ParsedSourceShell {
    let allocator = Allocator::default();
    let source_type = source_type_for_path(&file.filename);
    let parse_start = Instant::now();
    let parsed = Parser::new(&allocator, &file.source, source_type).parse();
    let parse_ns = elapsed_ns(parse_start);
    let source_len = u32::try_from(file.source.len()).unwrap_or(u32::MAX);
    let mut ir = SourceIr::empty(file.filename.clone(), source_len);
    let mut timings = TransformTimings {
        parse_ns,
        ..TransformTimings::default()
    };

    let ast_budget_exceeded = if parsed.panicked {
        false
    } else {
        let scope_start = Instant::now();
        let scope = super::scope::DeclaratorScope::from_program(&parsed.program);
        timings.scope_ns = elapsed_ns(scope_start);
        let mut visitor = CsszyxIrVisitor {
            source: &file.source,
            ir: &mut ir,
            node_count: 0,
            ast_budget_exceeded: false,
            scope: &scope,
            program: &parsed.program,
        };
        let ir_start = Instant::now();
        visitor.visit_program(&parsed.program);
        timings.ir_ns = elapsed_ns(ir_start);
        visitor.ast_budget_exceeded
    };

    ParsedSourceShell {
        ir,
        diagnostics: parsed
            .errors
            .iter()
            .map(std::string::ToString::to_string)
            .collect(),
        panicked: parsed.panicked,
        ast_budget_exceeded,
        timings,
    }
}

fn elapsed_ns(start: Instant) -> u64 {
    u64::try_from(start.elapsed().as_nanos()).unwrap_or(u64::MAX)
}

fn source_type_for_path(filename: &str) -> SourceType {
    SourceType::from_path(filename).unwrap_or_else(|_| SourceType::tsx())
}

struct CsszyxIrVisitor<'source, 'ir, 'p> {
    source: &'source str,
    ir: &'ir mut SourceIr,
    node_count: usize,
    ast_budget_exceeded: bool,
    /// Top-level declarator scope used to resolve `sz={NAME}` references
    /// to their initializer expression. Stored by reference so its
    /// underlying allocator outlives the visitor.
    scope: &'p super::scope::DeclaratorScope,
    /// Backing program used together with `scope` to look up identifier
    /// initializer expressions during static lowering.
    program: &'p oxc_ast::ast::Program<'p>,
}

impl<'a> Visit<'a> for CsszyxIrVisitor<'_, '_, 'a> {
    fn enter_node(&mut self, _kind: AstKind<'a>) {
        self.node_count = self.node_count.saturating_add(1);
        if self.node_count > AST_BUDGET {
            self.ast_budget_exceeded = true;
        }
    }

    fn visit_jsx_opening_element(&mut self, element: &JSXOpeningElement<'a>) {
        if self.ast_budget_exceeded {
            return;
        }

        let mut sz_attribute_indices = Vec::new();
        let mut class_attribute_index = None;
        let mut recovery_attribute_index = None;
        let mut has_recovery_token_attribute = false;
        let mut last_attribute_end = None;

        for item in &element.attributes {
            let JSXAttributeItem::Attribute(attr) = item else {
                continue;
            };
            last_attribute_end = Some(attr.span.end);
            if let Some(name) = jsx_attribute_name(&attr.name) {
                match name {
                    "sz" => {
                        if let Some(index) = self.collect_sz_attribute(attr) {
                            sz_attribute_indices.push(index);
                        } else {
                            self.ir
                                .unsupported_sz_attribute_spans
                                .push(text_span(attr.span));
                        }
                    }
                    "class" | "className" => {
                        if let Some(index) = self.collect_class_attribute(attr) {
                            class_attribute_index = Some(index);
                        }
                    }
                    "szRecover" => {
                        if let Some(index) = self.collect_recovery_attribute(attr) {
                            recovery_attribute_index = Some(index);
                        } else {
                            self.ir
                                .unsupported_recovery_attribute_spans
                                .push(text_span(attr.span));
                        }
                    }
                    "data-sz-recovery-token" => {
                        has_recovery_token_attribute = true;
                    }
                    _ => {}
                }
            }
        }

        if !sz_attribute_indices.is_empty()
            || class_attribute_index.is_some()
            || recovery_attribute_index.is_some()
        {
            self.ir.jsx_opening_elements.push(JsxOpeningElementIr {
                opening_span: text_span(element.span),
                sz_attribute_indices,
                class_attribute_index,
                recovery_attribute_index,
                has_recovery_token_attribute,
                last_attribute_end,
                element_name: jsx_element_name(&element.name),
            });
        }

        walk::walk_jsx_opening_element(self, element);
    }
}

/// Scope + program pair threaded through static-lowering recursions so the
/// `sz={NAME}` identifier path can resolve declarator initializers without
/// each helper learning the scope module directly.
#[derive(Clone, Copy)]
struct ResolveContext<'p> {
    scope: &'p super::scope::DeclaratorScope,
    program: &'p oxc_ast::ast::Program<'p>,
}

impl<'p> CsszyxIrVisitor<'_, '_, 'p> {
    const fn resolve_context(&self) -> ResolveContext<'p> {
        ResolveContext {
            scope: self.scope,
            program: self.program,
        }
    }

    fn collect_sz_attribute(&mut self, attr: &JSXAttribute<'_>) -> Option<usize> {
        let ctx = self.resolve_context();
        let (
            object,
            value_span,
            literal_class_name,
            rewrites_empty_class,
            ternary,
            runtime_fallback,
        ) = match &attr.value {
            Some(JSXAttributeValue::StringLiteral(value)) => (
                StaticSzObject::empty(),
                string_value_span(value.span, self.source),
                Some(value.value.to_string()),
                true,
                None,
                false,
            ),
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                // Three structurally distinct paths, tried in order:
                // 1. Static ternary (`sz={cond ? A : B}`) — emits a
                //    `className={cond ? "…" : "…"}` expression.
                // 2. Static object/array/identifier — emits a plain
                //    `className="…"`.
                // 3. Runtime fallback (e.g. object literals with a
                //    conditional-expression spread) — emits
                //    `className={_sz(<original>)}` so the runtime
                //    handles branches the parser cannot evaluate
                //    statically. This matches the existing oxc-JS
                //    production output and prevents the engine from
                //    leaving source unchanged for shapes the runtime
                //    can still execute correctly.
                if let Some((ternary, value_span)) =
                    static_ternary_from_jsx_expression(&container.expression, ctx)
                {
                    (
                        StaticSzObject::empty(),
                        value_span,
                        None,
                        false,
                        Some(ternary),
                        false,
                    )
                } else if let Some((object, value_span, rewrites_empty_class)) =
                    static_object_from_jsx_expression(&container.expression, ctx)
                {
                    (object, value_span, None, rewrites_empty_class, None, false)
                } else if let Some(value_span) =
                    runtime_fallback_span_from_jsx_expression(&container.expression)
                {
                    (StaticSzObject::empty(), value_span, None, false, None, true)
                } else {
                    return None;
                }
            }
            _ => return None,
        };

        let index = self.ir.sz_attributes.len();
        self.ir.sz_attributes.push(SzAttributeIr {
            attribute_span: text_span(attr.span),
            value_span,
            object,
            literal_class_name,
            rewrites_empty_class,
            ternary,
            runtime_fallback,
        });
        Some(index)
    }

    fn collect_class_attribute(&mut self, attr: &JSXAttribute<'_>) -> Option<usize> {
        let (value_span, value, expression_span) = match &attr.value {
            Some(JSXAttributeValue::StringLiteral(value)) => (
                string_value_span(value.span, self.source),
                value.value.to_string(),
                None,
            ),
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                if matches!(container.expression, JSXExpression::EmptyExpression(_)) {
                    return None;
                }
                let span = text_span(container.expression.span());
                (span, String::new(), Some(span))
            }
            _ => return None,
        };

        let index = self.ir.class_attributes.len();
        self.ir.class_attributes.push(ClassAttributeIr {
            attribute_span: text_span(attr.span),
            value_span,
            value,
            expression_span,
        });
        Some(index)
    }

    fn collect_recovery_attribute(&mut self, attr: &JSXAttribute<'_>) -> Option<usize> {
        let Some(JSXAttributeValue::StringLiteral(value)) = &attr.value else {
            return None;
        };
        let mode = match value.value.as_str() {
            "csr" => RecoveryMode::Csr,
            "dev-only" => RecoveryMode::DevOnly,
            _ => return None,
        };

        let index = self.ir.recovery_attributes.len();
        self.ir.recovery_attributes.push(RecoveryAttributeIr {
            attribute_span: text_span(attr.span),
            mode,
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

fn jsx_element_name(name: &JSXElementName<'_>) -> String {
    match name {
        JSXElementName::Identifier(identifier) => identifier.name.to_string(),
        JSXElementName::IdentifierReference(identifier) => identifier.name.to_string(),
        JSXElementName::NamespacedName(namespaced) => {
            format!("{}:{}", namespaced.namespace.name, namespaced.name.name)
        }
        JSXElementName::MemberExpression(member) => jsx_member_expression_name(member),
        JSXElementName::ThisExpression(_) => "this".to_string(),
    }
}

fn jsx_member_expression_name(member: &JSXMemberExpression<'_>) -> String {
    format!(
        "{}.{}",
        jsx_member_expression_object_name(&member.object),
        member.property.name
    )
}

fn jsx_member_expression_object_name(object: &JSXMemberExpressionObject<'_>) -> String {
    match object {
        JSXMemberExpressionObject::IdentifierReference(identifier) => identifier.name.to_string(),
        JSXMemberExpressionObject::MemberExpression(member) => jsx_member_expression_name(member),
        JSXMemberExpressionObject::ThisExpression(_) => "this".to_string(),
    }
}

/// Pre-lower a JSX-level `sz={cond ? A : B}` expression to a static ternary.
///
/// Returns `None` for any non-ternary expression as well as for ternaries
/// where one or both branches are not statically lowerable. Callers fall back
/// to the regular static-object path on `None`, which keeps the existing
/// fail-closed semantics for dynamic sz attributes untouched.
fn static_ternary_from_jsx_expression(
    expression: &JSXExpression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<(StaticTernaryIr, TextSpan)> {
    match expression {
        JSXExpression::ConditionalExpression(conditional) => {
            static_ternary_from_conditional(conditional, ctx)
        }
        _ => None,
    }
}

fn static_ternary_from_conditional(
    conditional: &ConditionalExpression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<(StaticTernaryIr, TextSpan)> {
    let (consequent_object, _, _) = static_object_from_expression(&conditional.consequent, ctx)?;
    let (alternate_object, _, _) = static_object_from_expression(&conditional.alternate, ctx)?;
    let consequent_classes = lower_static_sz_object(&consequent_object);
    let alternate_classes = lower_static_sz_object(&alternate_object);
    Some((
        StaticTernaryIr {
            test_span: text_span(conditional.test.span()),
            consequent_classes,
            alternate_classes,
        },
        text_span(conditional.span),
    ))
}

/// Detect sz expressions whose static lowering cannot succeed but whose
/// shape the runtime `_sz(...)` helper still handles correctly.
///
/// Dynamic expressions qualify when static lowering has already failed and the
/// expression can be handed to `_sz(...)` exactly as written. This covers the
/// same no-className runtime fallback shape as oxc-JS: unresolved identifiers,
/// function calls, object/array expressions with dynamic parts, conditionals,
/// and TS/parens wrappers. Empty JSX expressions still fail closed.
///
/// Returns the source span of the inner expression — what the rewriter
/// will splice inside `_sz(…)` — so the emitted call preserves the
/// user's exact text.
fn runtime_fallback_span_from_jsx_expression(expression: &JSXExpression<'_>) -> Option<TextSpan> {
    match expression {
        JSXExpression::EmptyExpression(_) => None,
        JSXExpression::TSAsExpression(value) => {
            runtime_fallback_span_from_expression(&value.expression)
        }
        JSXExpression::TSSatisfiesExpression(value) => {
            runtime_fallback_span_from_expression(&value.expression)
        }
        JSXExpression::TSNonNullExpression(value) => {
            runtime_fallback_span_from_expression(&value.expression)
        }
        JSXExpression::ParenthesizedExpression(value) => {
            runtime_fallback_span_from_expression(&value.expression)
        }
        _ => Some(text_span(expression.span())),
    }
}

fn runtime_fallback_span_from_expression(expression: &Expression<'_>) -> Option<TextSpan> {
    match expression {
        Expression::TSAsExpression(value) => {
            runtime_fallback_span_from_expression(&value.expression)
        }
        Expression::TSSatisfiesExpression(value) => {
            runtime_fallback_span_from_expression(&value.expression)
        }
        Expression::TSNonNullExpression(value) => {
            runtime_fallback_span_from_expression(&value.expression)
        }
        Expression::ParenthesizedExpression(value) => {
            runtime_fallback_span_from_expression(&value.expression)
        }
        _ => Some(text_span(expression.span())),
    }
}

fn static_object_from_jsx_expression(
    expression: &JSXExpression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<(StaticSzObject, TextSpan, bool)> {
    match expression {
        JSXExpression::ObjectExpression(object) => Some((
            static_object_from_object_expression(object, ctx)?,
            text_span(object.span),
            false,
        )),
        JSXExpression::ArrayExpression(array) => Some((
            static_object_from_array_expression(array, ctx)?,
            text_span(array.span),
            true,
        )),
        JSXExpression::TSAsExpression(value) => {
            static_object_from_expression(&value.expression, ctx)
        }
        JSXExpression::TSSatisfiesExpression(value) => {
            static_object_from_expression(&value.expression, ctx)
        }
        JSXExpression::TSNonNullExpression(value) => {
            static_object_from_expression(&value.expression, ctx)
        }
        JSXExpression::ParenthesizedExpression(parenthesized) => {
            static_object_from_expression(&parenthesized.expression, ctx)
        }
        // `sz={NAME}` — resolve the identifier to its declarator
        // initializer and recurse. The recorded value-span is the span
        // of the IDENTIFIER (not the initializer) because that span is
        // what the rewrite phase replaces; identifier resolution is a
        // semantic enhancement, not a span change.
        JSXExpression::Identifier(identifier) => {
            let initializer = ctx.scope.resolve_initializer_before(
                &identifier.name,
                identifier.span.start,
                ctx.program,
            )?;
            let (object, _, rewrites_empty_class) =
                static_object_from_expression(initializer, ctx)?;
            Some((object, text_span(identifier.span), rewrites_empty_class))
        }
        _ => None,
    }
}

fn static_object_from_expression(
    expression: &Expression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<(StaticSzObject, TextSpan, bool)> {
    match expression {
        Expression::ObjectExpression(object) => Some((
            static_object_from_object_expression(object, ctx)?,
            text_span(object.span),
            false,
        )),
        Expression::ArrayExpression(array) => Some((
            static_object_from_array_expression(array, ctx)?,
            text_span(array.span),
            true,
        )),
        Expression::TSAsExpression(value) => static_object_from_expression(&value.expression, ctx),
        Expression::TSSatisfiesExpression(value) => {
            static_object_from_expression(&value.expression, ctx)
        }
        Expression::TSNonNullExpression(value) => {
            static_object_from_expression(&value.expression, ctx)
        }
        Expression::ParenthesizedExpression(parenthesized) => {
            static_object_from_expression(&parenthesized.expression, ctx)
        }
        // Nested identifier reference (e.g. `sz={{ ...BASE }}` where BASE
        // resolves to another identifier, or a wrapped binding via
        // `as const`). Look up the declarator + recurse with the same
        // context so deep chains stay constant-time per lookup.
        Expression::Identifier(identifier) => {
            let initializer = ctx.scope.resolve_initializer_before(
                &identifier.name,
                identifier.span.start,
                ctx.program,
            )?;
            static_object_from_expression(initializer, ctx)
        }
        _ => None,
    }
}

fn static_object_from_object_expression(
    object: &ObjectExpression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<StaticSzObject> {
    let mut properties = Vec::with_capacity(object.properties.len());

    for property in &object.properties {
        match property {
            ObjectPropertyKind::ObjectProperty(property) => {
                if is_skippable_static_value(&property.value) {
                    continue;
                }
                properties.push(static_property_from_object_property(property, ctx)?);
            }
            ObjectPropertyKind::SpreadProperty(spread) => {
                properties
                    .extend(static_object_from_spread_argument(&spread.argument, ctx)?.properties);
            }
        }
    }

    Some(StaticSzObject { properties })
}

fn static_object_from_spread_argument(
    expression: &Expression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<StaticSzObject> {
    match expression {
        Expression::ObjectExpression(object) => static_object_from_object_expression(object, ctx),
        Expression::ParenthesizedExpression(value) => {
            static_object_from_spread_argument(&value.expression, ctx)
        }
        Expression::TSAsExpression(value) => {
            static_object_from_spread_argument(&value.expression, ctx)
        }
        Expression::TSSatisfiesExpression(value) => {
            static_object_from_spread_argument(&value.expression, ctx)
        }
        Expression::TSNonNullExpression(value) => {
            static_object_from_spread_argument(&value.expression, ctx)
        }
        // Identifier-backed spread (`{ ...BASE }`) — resolve via scope and
        // recurse. Returns None when the binding cannot be resolved to a
        // static object so callers fall back to the unsupported-sz path
        // rather than emitting partial output.
        Expression::Identifier(identifier) => {
            let initializer = ctx.scope.resolve_initializer_before(
                &identifier.name,
                identifier.span.start,
                ctx.program,
            )?;
            static_object_from_spread_argument(initializer, ctx)
        }
        _ => None,
    }
}

fn static_object_from_array_expression(
    array: &ArrayExpression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<StaticSzObject> {
    let mut properties = Vec::new();

    for element in &array.elements {
        match element {
            ArrayExpressionElement::ObjectExpression(object) => {
                properties.extend(static_object_from_object_expression(object, ctx)?.properties);
            }
            ArrayExpressionElement::BooleanLiteral(value) if !value.value => {}
            ArrayExpressionElement::NullLiteral(_) | ArrayExpressionElement::Elision(_) => {}
            ArrayExpressionElement::Identifier(identifier) if identifier.name == "undefined" => {}
            _ => return None,
        }
    }

    Some(StaticSzObject { properties })
}

fn static_property_from_object_property(
    property: &ObjectProperty<'_>,
    ctx: ResolveContext<'_>,
) -> Option<StaticSzProperty> {
    if property.method || property.computed || property.shorthand {
        return None;
    }

    Some(StaticSzProperty {
        key: static_property_key(&property.key)?,
        span: text_span(property.span),
        value: static_value_from_expression(&property.value, ctx)?,
    })
}

fn static_property_key(key: &PropertyKey<'_>) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.to_string()),
        PropertyKey::StringLiteral(string) => Some(string.value.to_string()),
        _ => None,
    }
}

fn static_value_from_expression(
    expression: &Expression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<StaticSzValue> {
    match expression {
        Expression::StringLiteral(value) => Some(StaticSzValue::String(value.value.to_string())),
        Expression::NumericLiteral(value) => Some(StaticSzValue::Number(value.value)),
        Expression::UnaryExpression(value) => static_value_from_unary_expression(value),
        Expression::BooleanLiteral(value) => Some(StaticSzValue::Boolean(value.value)),
        Expression::ObjectExpression(value) => Some(StaticSzValue::Object(
            static_object_from_object_expression(value, ctx)?,
        )),
        Expression::ParenthesizedExpression(value) => {
            static_value_from_expression(&value.expression, ctx)
        }
        Expression::TSAsExpression(value) => static_value_from_expression(&value.expression, ctx),
        Expression::TSSatisfiesExpression(value) => {
            static_value_from_expression(&value.expression, ctx)
        }
        Expression::TSNonNullExpression(value) => {
            static_value_from_expression(&value.expression, ctx)
        }
        // Nested identifier inside a property value, e.g. `{ p: SIZE }`
        // where SIZE is a local const. Resolve via scope and recurse so
        // R4.2 also handles partial-static cases.
        Expression::Identifier(identifier) => {
            let initializer = ctx.scope.resolve_initializer_before(
                &identifier.name,
                identifier.span.start,
                ctx.program,
            )?;
            static_value_from_expression(initializer, ctx)
        }
        _ => None,
    }
}

fn is_skippable_static_value(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::NullLiteral(_) => true,
        Expression::Identifier(identifier) if identifier.name == "undefined" => true,
        Expression::ParenthesizedExpression(value) => is_skippable_static_value(&value.expression),
        Expression::TSAsExpression(value) => is_skippable_static_value(&value.expression),
        Expression::TSSatisfiesExpression(value) => is_skippable_static_value(&value.expression),
        Expression::TSNonNullExpression(value) => is_skippable_static_value(&value.expression),
        _ => false,
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
        assert!(parsed.ir.class_attributes[0].expression_span.is_none());
        assert_eq!(
            parsed.ir.class_attributes[0].value_span,
            super::TextSpan { start: 41, end: 50 }
        );
    }

    #[test]
    fn parser_shell_collects_dynamic_class_attributes() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div className={getClass()} sz={{ p: 4 }} />;"
                .to_string(),
        };

        let parsed = parse_source_shell(&file);

        assert!(parsed.diagnostics.is_empty());
        assert_eq!(parsed.ir.class_attributes.len(), 1);
        assert!(parsed.ir.class_attributes[0].value.is_empty());
        assert_eq!(
            parsed.ir.class_attributes[0].expression_span,
            Some(super::TextSpan { start: 41, end: 51 })
        );
        let lowered = lower_source_ir_classes(&parsed.ir);
        assert!(lowered.raw_class_names.is_empty());
        assert_eq!(lowered.classes, ["p-4"]);
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
        assert_eq!(parsed.ir.jsx_opening_elements[0].element_name, "div");
        assert_eq!(
            parsed.ir.jsx_opening_elements[0].class_attribute_index,
            Some(0)
        );
        assert_eq!(
            parsed.ir.jsx_opening_elements[0].recovery_attribute_index,
            None
        );
        assert!(!parsed.ir.jsx_opening_elements[0].has_recovery_token_attribute);
        assert!(parsed.ir.jsx_opening_elements[0]
            .last_attribute_end
            .is_some());
        assert_eq!(parsed.ir.jsx_opening_elements[1].sz_attribute_indices, [1]);
        assert_eq!(
            parsed.ir.jsx_opening_elements[1].class_attribute_index,
            None
        );
    }

    #[test]
    fn parser_shell_collects_static_recovery_attributes() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source:
                "export const App = () => <div szRecover=\"csr\" data-sz-recovery-token=\"abc\" />;"
                    .to_string(),
        };

        let parsed = parse_source_shell(&file);

        assert!(parsed.diagnostics.is_empty());
        assert_eq!(parsed.ir.recovery_attributes.len(), 1);
        assert_eq!(
            parsed.ir.recovery_attributes[0].mode,
            super::RecoveryMode::Csr
        );
        assert_eq!(parsed.ir.jsx_opening_elements.len(), 1);
        assert_eq!(
            parsed.ir.jsx_opening_elements[0].recovery_attribute_index,
            Some(0)
        );
        assert!(parsed.ir.jsx_opening_elements[0].has_recovery_token_attribute);
        assert_eq!(parsed.ir.jsx_opening_elements[0].element_name, "div");
    }

    #[test]
    fn parser_shell_marks_dynamic_recovery_attributes_unsupported() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = ({ mode }) => <div szRecover={mode} />;".to_string(),
        };

        let parsed = parse_source_shell(&file);

        assert!(parsed.diagnostics.is_empty());
        assert!(parsed.ir.recovery_attributes.is_empty());
        assert_eq!(parsed.ir.unsupported_recovery_attribute_spans.len(), 1);
    }

    #[test]
    fn parser_shell_collects_string_sz_attribute() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div sz=\"p-4 bg-blue-500\" />;".to_string(),
        };

        let parsed = parse_source_shell(&file);
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty());
        assert_eq!(
            parsed.ir.sz_attributes[0].literal_class_name.as_deref(),
            Some("p-4 bg-blue-500")
        );
        assert_eq!(lowered.classes, ["p-4", "bg-blue-500"]);
    }

    #[test]
    fn parser_shell_lowers_static_array_sz_attribute() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source:
                "export const App = () => <div sz={[{ flex: true }, false, null, { p: 4 }]} />;"
                    .to_string(),
        };

        let parsed = parse_source_shell(&file);
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty());
        assert_eq!(lowered.classes, ["flex", "p-4"]);
        assert_eq!(parsed.ir.sz_attributes[0].object.properties.len(), 2);
    }

    #[test]
    fn parser_shell_keeps_empty_static_array_rewriteable() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div sz={[false, null, undefined]} />;".to_string(),
        };

        let parsed = parse_source_shell(&file);
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty());
        assert!(lowered.classes.is_empty());
        assert!(parsed.ir.sz_attributes[0].rewrites_empty_class);
    }

    #[test]
    fn parser_shell_unwraps_typescript_static_wrappers() {
        let cases = [
            (
                "export const App = () => <div sz={{ p: 4 } as const} />;",
                vec!["p-4"],
            ),
            (
                "export const App = () => <div sz={{ m: 2 } satisfies Record<string, unknown>} />;",
                vec!["m-2"],
            ),
            (
                "export const App = () => <div sz={([{ flex: true }] as const)} />;",
                vec!["flex"],
            ),
        ];

        for (source, expected) in cases {
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source: source.to_string(),
            });
            let lowered = lower_source_ir_classes(&parsed.ir);

            assert!(parsed.diagnostics.is_empty(), "{source}");
            assert_eq!(lowered.classes, expected, "{source}");
        }
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
            ("sz={{ p: 4, gap: null, m: undefined }}", vec!["p-4"]),
            (
                "sz={{ p: (4 as const), m: (2 satisfies number) }}",
                vec!["p-4", "m-2"],
            ),
            ("sz={{ ...{ p: 4 }, m: 2 }}", vec!["p-4", "m-2"]),
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
    fn parser_shell_lowers_static_ternary_sz_attribute() {
        let source = "const X = ({ active }) => <div sz={active ? { p: 4 } : { p: 8 }} />;";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });

        assert!(parsed.diagnostics.is_empty(), "{}", source);
        assert_eq!(parsed.ir.sz_attributes.len(), 1);
        let ternary = parsed.ir.sz_attributes[0]
            .ternary
            .as_ref()
            .expect("ternary should be recorded");
        assert_eq!(ternary.consequent_classes, ["p-4"]);
        assert_eq!(ternary.alternate_classes, ["p-8"]);
        let test_text = &source[ternary.test_span.start as usize..ternary.test_span.end as usize];
        assert_eq!(test_text, "active");

        // Both branches' classes flow back into the result manifest so
        // downstream consumers (className manifest, hydration) see the
        // full set of possible runtime outputs.
        let lowered = lower_source_ir_classes(&parsed.ir);
        assert_eq!(lowered.classes, ["p-4", "p-8"]);
    }

    #[test]
    fn parser_shell_resolves_function_body_local_static_ternary() {
        let source = "const X = ({ active }) => {\n  const ON = { p: 4 } as const;\n  const OFF = { p: 8 } as const;\n  return <div sz={active ? ON : OFF} />;\n};";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });

        assert!(parsed.diagnostics.is_empty(), "{}", source);
        assert_eq!(parsed.ir.sz_attributes.len(), 1);
        let ternary = parsed.ir.sz_attributes[0]
            .ternary
            .as_ref()
            .expect("local ternary should be recorded");
        assert_eq!(ternary.consequent_classes, ["p-4"]);
        assert_eq!(ternary.alternate_classes, ["p-8"]);
    }

    #[test]
    fn parser_shell_does_not_static_resolve_identifier_declared_after_reference() {
        let source = "const X = () => <div sz={BASE} />;\nconst BASE = { p: 4 } as const;";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });

        assert_eq!(parsed.ir.sz_attributes.len(), 1);
        assert!(parsed.ir.sz_attributes[0].runtime_fallback);
        assert!(parsed.ir.unsupported_sz_attribute_spans.is_empty());
    }

    #[test]
    fn parser_shell_does_not_static_resolve_sibling_function_local_identifier_binding() {
        let source = "const A = () => {\n  const BASE = { p: 4 } as const;\n  return null;\n};\nconst B = () => <div sz={BASE} />;";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });

        assert_eq!(parsed.ir.sz_attributes.len(), 1);
        assert!(parsed.ir.sz_attributes[0].runtime_fallback);
        assert!(parsed.ir.unsupported_sz_attribute_spans.is_empty());
    }

    #[test]
    fn parser_shell_marks_conditional_spread_for_runtime_fallback() {
        let source = "const BASE = { p: 4 } as const;\nconst X = ({ big }) => <div sz={{ ...BASE, ...(big ? { p: 8 } : {}) }} />;";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });

        assert!(parsed.diagnostics.is_empty(), "{}", source);
        assert_eq!(parsed.ir.sz_attributes.len(), 1);
        let attribute = &parsed.ir.sz_attributes[0];
        assert!(attribute.runtime_fallback);
        // Classes are deliberately empty for runtime-fallback attributes —
        // the runtime is the source of truth, mirroring oxc-JS.
        let lowered = lower_source_ir_classes(&parsed.ir);
        assert!(lowered.classes.is_empty());
        let value_text =
            &source[attribute.value_span.start as usize..attribute.value_span.end as usize];
        assert_eq!(value_text, "{ ...BASE, ...(big ? { p: 8 } : {}) }");
    }

    #[test]
    fn parser_shell_marks_dynamic_ternary_branch_for_runtime_fallback() {
        let source = "const X = ({ active, styles }) => <div sz={active ? styles : { p: 8 }} />;";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });

        assert_eq!(parsed.ir.sz_attributes.len(), 1);
        let attribute = &parsed.ir.sz_attributes[0];
        assert!(attribute.runtime_fallback);
        let value_text =
            &source[attribute.value_span.start as usize..attribute.value_span.end as usize];
        assert_eq!(value_text, "active ? styles : { p: 8 }");
        assert!(parsed.ir.unsupported_sz_attribute_spans.is_empty());
    }

    #[test]
    fn parser_shell_marks_dynamic_sz_object_for_runtime_fallback() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div sz={{ ...props, p: 4 }} />;".to_string(),
        };

        let parsed = parse_source_shell(&file);

        assert!(parsed.diagnostics.is_empty());
        assert_eq!(parsed.ir.sz_attributes.len(), 1);
        assert!(parsed.ir.sz_attributes[0].runtime_fallback);
        assert!(parsed.ir.unsupported_sz_attribute_spans.is_empty());
    }

    #[test]
    fn parser_shell_marks_dynamic_identifier_for_runtime_fallback() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = ({ styles }) => <div sz={styles} />;".to_string(),
        };

        let parsed = parse_source_shell(&file);

        assert!(parsed.diagnostics.is_empty());
        assert_eq!(parsed.ir.sz_attributes.len(), 1);
        assert!(parsed.ir.sz_attributes[0].runtime_fallback);
        assert_eq!(parsed.ir.sz_attributes[0].value_span.len(), 6);
        assert!(parsed.ir.unsupported_sz_attribute_spans.is_empty());
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
