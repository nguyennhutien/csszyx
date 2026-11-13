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

use std::borrow::Cow;

use oxc_ast::ast::{
    ArrayExpressionElement, Expression, ObjectPropertyKind, Program, PropertyKey, TemplateLiteral,
};
use oxc_span::GetSpan;
use oxc_str::JSStr;

use super::scope::DeclaratorScope;

/// The first string with a lone surrogate that reading `expression`
/// statically needs, in it or in a same-file binding it names, written as
/// [`JSStr::display`] writes it: for a diagnostic, never for output.
pub fn lone_surrogate_string<'p>(
    expression: &'p Expression<'p>,
    scope: &DeclaratorScope,
    program: &'p Program<'p>,
) -> Option<String> {
    Scan {
        scope,
        program,
        followed: Vec::new(),
    }
    .expression(expression)
    .map(|value| value.display().to_string())
}

/// The text of a string for a scan that writes none of it out: as is, or with
/// each lone surrogate spelled `\uXXXX`, so the other tokens in it still read.
///
/// Sound wherever the tokens looked for are ASCII, such as a `var(--x)` or a
/// class selector: the spelling adds a backslash token no real one contains
/// and joins no two tokens into one.
pub fn scan_text(value: JSStr<'_>) -> Cow<'_, str> {
    value
        .as_str()
        .map_or_else(|| Cow::Owned(value.display().to_string()), Cow::Borrowed)
}

struct Scan<'s, 'p> {
    scope: &'s DeclaratorScope,
    program: &'p Program<'p>,
    /// Initializers and selected properties already read, by span: a binding
    /// that names itself, directly or through another, ends the walk.
    followed: Vec<(u32, u32)>,
}

impl<'p> Scan<'_, 'p> {
    fn expression(&mut self, expression: &'p Expression<'p>) -> Option<JSStr<'p>> {
        match expression.get_inner_expression() {
            Expression::StringLiteral(literal) => lone(literal.value),
            Expression::TemplateLiteral(template) => self.template(template),
            Expression::ObjectExpression(object) => {
                object
                    .properties
                    .iter()
                    .find_map(|property| match property {
                        ObjectPropertyKind::ObjectProperty(property) => self
                            .key(&property.key)
                            .or_else(|| self.expression(&property.value)),
                        ObjectPropertyKind::SpreadProperty(spread) => {
                            self.expression(&spread.argument)
                        }
                    })
            }
            Expression::ArrayExpression(array) => {
                array.elements.iter().find_map(|element| match element {
                    ArrayExpressionElement::SpreadElement(spread) => {
                        self.expression(&spread.argument)
                    }
                    element => element
                        .as_expression()
                        .and_then(|element| self.expression(element)),
                })
            }
            Expression::ConditionalExpression(conditional) => self
                .expression(&conditional.consequent)
                .or_else(|| self.expression(&conditional.alternate)),
            Expression::LogicalExpression(logical) => self
                .expression(&logical.left)
                .or_else(|| self.expression(&logical.right)),
            // Only an szv variant call has its argument read at build time;
            // any other call runs as written, so what it is passed is not.
            Expression::CallExpression(call) if self.calls_an_szv(&call.callee) => call
                .arguments
                .iter()
                .filter_map(|argument| argument.as_expression())
                .find_map(|argument| self.expression(argument)),
            // The read takes one property; its siblings are never compiled.
            Expression::StaticMemberExpression(member) => {
                match self.scope.selected_property_before(member, self.program) {
                    Some(value) => self.follow(value),
                    None => self.expression(&member.object),
                }
            }
            Expression::Identifier(identifier) => self
                .scope
                .resolve_initializer_before(&identifier.name, identifier.span.start, self.program)
                .and_then(|initializer| self.follow(initializer)),
            _ => None,
        }
    }

    fn template(&mut self, template: &'p TemplateLiteral<'p>) -> Option<JSStr<'p>> {
        // A tagged template with a malformed escape has no cooked value; it
        // holds no string at all, so it is not a lone surrogate either.
        template
            .quasis
            .iter()
            .find_map(|quasi| quasi.value.cooked.and_then(lone))
            .or_else(|| {
                template
                    .expressions
                    .iter()
                    .find_map(|expression| self.expression(expression))
            })
    }

    fn key(&mut self, key: &'p PropertyKey<'p>) -> Option<JSStr<'p>> {
        match key {
            PropertyKey::StringLiteral(literal) => lone(literal.value),
            key => key
                .as_expression()
                .and_then(|expression| self.expression(expression)),
        }
    }

    /// Whether `callee` names a same-file `szv(…)` factory.
    fn calls_an_szv(&self, callee: &Expression<'_>) -> bool {
        let Expression::Identifier(callee) = callee else {
            return false;
        };
        self.scope
            .resolve_initializer_before(&callee.name, callee.span.start, self.program)
            .is_some_and(|initializer| {
                matches!(
                    initializer.get_inner_expression(),
                    Expression::CallExpression(factory)
                        if matches!(&factory.callee, Expression::Identifier(name) if name.name == "szv")
                )
            })
    }

    /// Read an initializer or a selected property once.
    fn follow(&mut self, expression: &'p Expression<'p>) -> Option<JSStr<'p>> {
        let span = expression.span();
        if self.followed.contains(&(span.start, span.end)) {
            return None;
        }
        self.followed.push((span.start, span.end));
        self.expression(expression)
    }
}

/// The value itself when it holds a lone surrogate.
fn lone(value: JSStr<'_>) -> Option<JSStr<'_>> {
    value.as_str().is_none().then_some(value)
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
        lone_surrogate_string(initializer, &scope, &parsed.program).is_some()
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
            "const t = szv({});\nconst a = t({ c: \"a\\uD800\" });",
            r#"const a = { b: "a\uD800" }.b;"#,
            r#"const a = { b: 1, ...{ c: "a\uD800" } }.b;"#,
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
            r#"const a = t({ c: "a\uD800" });"#,
            r#"const a = f.g("\uD800");"#,
            "const t = make();\nconst a = t(\"\\uD800\");",
            r#"const a = { b: 1 }["a\uD800"];"#,
            r#"const a = { c: "a\uD800", b: 1 }.b;"#,
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
        assert!(!last_const_needs("const a = { p: a.p };\nconst c = a.p;"));
    }

    #[test]
    fn scan_text_spells_a_lone_surrogate_as_an_escape() {
        let allocator = Allocator::default();
        let source = r#"const a = "x \uD800 y"; const b = "x y";"#;
        let parsed = Parser::new(&allocator, source, SourceType::tsx()).parse();
        let texts: Vec<String> = parsed
            .program
            .body
            .iter()
            .filter_map(|statement| match statement {
                Statement::VariableDeclaration(declaration) => {
                    match declaration.declarations[0].init.as_ref() {
                        Some(Expression::StringLiteral(literal)) => {
                            Some(scan_text(literal.value).into_owned())
                        }
                        _ => None,
                    }
                }
                _ => None,
            })
            .collect();
        assert_eq!(texts, [r"x \ud800 y", "x y"]);
    }
}
