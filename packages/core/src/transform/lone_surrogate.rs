//! Whether a value the engine would read holds a lone UTF-16 surrogate.
//!
//! A JavaScript string may hold an unpaired surrogate (`"\uD800"`); a Rust
//! `str` cannot, so the parser hands such a value over with no text form. Any
//! class text written for it would be invented, so the engine never compiles
//! one: the attribute or call that needs it keeps its runtime path. This scan
//! answers the question up front, for the expression and for every same-file
//! binding it names, so the decision is made once per site and before any
//! lowering records state for it.
//!
//! A match over the shapes a static read descends into, not an
//! `oxc_ast_visit` walker: a walker type instantiates the whole AST walk once
//! more, which costs the wasm artifact several kilobytes for shapes no static
//! read compiles anyway.

use oxc_ast::ast::{
    ArrayExpressionElement, Expression, ObjectPropertyKind, Program, PropertyKey, TemplateLiteral,
};
use oxc_span::GetSpan;

use super::scope::DeclaratorScope;

/// Whether reading `expression` statically needs a string with a lone
/// surrogate, in it or in a same-file binding it names, followed through.
pub fn needs_lone_surrogate<'p>(
    expression: &Expression<'_>,
    scope: &DeclaratorScope,
    program: &'p Program<'p>,
) -> bool {
    Scan {
        scope,
        program,
        followed: Vec::new(),
    }
    .expression(expression)
}

struct Scan<'s, 'p> {
    scope: &'s DeclaratorScope,
    program: &'p Program<'p>,
    /// Initializers already read, by start offset: a binding that names
    /// itself, directly or through another, ends the walk.
    followed: Vec<u32>,
}

impl Scan<'_, '_> {
    fn expression(&mut self, expression: &Expression<'_>) -> bool {
        match expression.get_inner_expression() {
            Expression::StringLiteral(literal) => literal.value.as_str().is_none(),
            Expression::TemplateLiteral(template) => self.template(template),
            Expression::ObjectExpression(object) => {
                object.properties.iter().any(|property| match property {
                    ObjectPropertyKind::ObjectProperty(property) => {
                        self.key(&property.key) || self.expression(&property.value)
                    }
                    ObjectPropertyKind::SpreadProperty(spread) => self.expression(&spread.argument),
                })
            }
            Expression::ArrayExpression(array) => {
                array.elements.iter().any(|element| match element {
                    ArrayExpressionElement::SpreadElement(spread) => {
                        self.expression(&spread.argument)
                    }
                    element => element
                        .as_expression()
                        .is_some_and(|element| self.expression(element)),
                })
            }
            Expression::ConditionalExpression(conditional) => {
                self.expression(&conditional.consequent) || self.expression(&conditional.alternate)
            }
            Expression::LogicalExpression(logical) => {
                self.expression(&logical.left) || self.expression(&logical.right)
            }
            Expression::CallExpression(call) => call
                .arguments
                .iter()
                .filter_map(|argument| argument.as_expression())
                .any(|argument| self.expression(argument)),
            Expression::StaticMemberExpression(member) => self.expression(&member.object),
            Expression::ComputedMemberExpression(member) => {
                self.expression(&member.object) || self.expression(&member.expression)
            }
            Expression::Identifier(identifier) => {
                self.binding(&identifier.name, identifier.span.start)
            }
            _ => false,
        }
    }

    fn template(&mut self, template: &TemplateLiteral<'_>) -> bool {
        // A tagged template with a malformed escape has no cooked value; it
        // holds no string at all, so it is not a lone surrogate either.
        template.quasis.iter().any(|quasi| {
            quasi
                .value
                .cooked
                .is_some_and(|cooked| cooked.as_str().is_none())
        }) || template
            .expressions
            .iter()
            .any(|expression| self.expression(expression))
    }

    fn key(&mut self, key: &PropertyKey<'_>) -> bool {
        match key {
            PropertyKey::StringLiteral(literal) => literal.value.as_str().is_none(),
            key => key
                .as_expression()
                .is_some_and(|expression| self.expression(expression)),
        }
    }

    fn binding(&mut self, name: &str, reference: u32) -> bool {
        let Some(initializer) =
            self.scope
                .resolve_initializer_before(name, reference, self.program)
        else {
            return false;
        };
        let at = initializer.span().start;
        if self.followed.contains(&at) {
            return false;
        }
        self.followed.push(at);
        self.expression(initializer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxc_allocator::Allocator;
    use oxc_ast::ast::{Statement, VariableDeclaration};
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    /// Whether the initializer of the last `const` in `source` needs one.
    fn last_const_needs(source: &str) -> bool {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::tsx()).parse();
        assert!(!parsed.fatal_error, "{:?}", parsed.diagnostics);
        let scope = DeclaratorScope::from_program(&parsed.program);
        let Some(Statement::VariableDeclaration(declaration)) = parsed.program.body.last() else {
            panic!("the fixture ends with a const");
        };
        let VariableDeclaration { declarations, .. } = &**declaration;
        let initializer = declarations[0].init.as_ref().expect("an initializer");
        needs_lone_surrogate(initializer, &scope, &parsed.program)
    }

    #[test]
    fn finds_one_in_a_string_a_key_or_a_template() {
        assert!(last_const_needs(r#"const a = "a\uD800";"#));
        assert!(last_const_needs(r#"const a = { "p\uDC00": 4 };"#));
        assert!(last_const_needs(r#"const a = { ["p\uDC00"]: 4 };"#));
        assert!(last_const_needs(r"const a = `a\uD800${x}`;"));
        assert!(last_const_needs(r#"const a = `a${"\uD800"}`;"#));
    }

    #[test]
    fn finds_one_inside_every_shape_a_static_read_descends_into() {
        for source in [
            r#"const a = ({ bg: "a\uD800" } as const);"#,
            r#"const a = { ...{ bg: "a\uD800" } };"#,
            r#"const a = ["p-4", , "a\uD800"];"#,
            r#"const a = [...["a\uD800"]];"#,
            r#"const a = c ? "p-4" : "a\uD800";"#,
            r#"const a = c && "a\uD800";"#,
            r#"const a = t({ c: "a\uD800" });"#,
            r#"const a = { b: "a\uD800" }.b;"#,
            r#"const a = { b: 1 }["a\uD800"];"#,
        ] {
            assert!(last_const_needs(source), "{source}");
        }
    }

    #[test]
    fn reads_a_pair_and_text_outside_any_value_as_no_lone_surrogate() {
        for source in [
            r#"const a = { bg: "a😀", c: "\uD83D\uDE00", [k]: 1, p: 4 };"#,
            r"const a = tag`\u{`;",
            r#"const a = ["p-4", , ...b];"#,
            r#"const a = ("\uD800" === c) ? "p-4" : "m-2";"#,
            r#"const a = new X("\uD800");"#,
            "const a = 4;",
        ] {
            assert!(!last_const_needs(source), "{source}");
        }
    }

    #[test]
    fn follows_the_bindings_an_expression_names() {
        assert!(last_const_needs(
            "const c = \"a\\uD800\";\nconst b = { bg: c };\nconst a = [b];"
        ));
        assert!(!last_const_needs(
            "const c = \"a\";\nconst b = { bg: c, m: x };\nconst a = [b];"
        ));
    }

    #[test]
    fn reads_a_binding_that_names_itself_once() {
        assert!(!last_const_needs("const a = { p: a };\nconst c = [a, a];"));
    }
}
