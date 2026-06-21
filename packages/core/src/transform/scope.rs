//! Single-file declarator scope tracker.
//!
//! Records the source span of every same-file `const`/`let`/`var` binding's
//! initializer so later lowering passes can resolve `sz={NAME}` references.
//! Hand-rolled over the oxc-parser AST without pulling in `oxc_semantic`:
//! covers the single-file declarator cases the parity fixtures need, sidesteps
//! the `oxc_semantic` version-churn tax, and keeps the surface area auditable.
//!
//! Scope of this module: same-file bindings whose lexical span contains the
//! JSX expression being lowered. Modules-as-arguments and import-graph
//! resolution are deliberately out of scope for this slice; later slices can
//! extend [`DeclaratorScope`] without changing the public API.

use oxc_ast::ast::{
    BindingPattern, BlockStatement, Expression, FunctionBody, Program, VariableDeclaration,
    VariableDeclarationKind,
};
use oxc_ast_visit::{walk, Visit};
use oxc_span::GetSpan;
use std::cmp::Reverse;

use super::TextSpan;

/// A single declarator binding recorded by the scope walker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BindingEntry {
    /// Source span of the initializer expression (the RHS of `const X = ...`).
    pub initializer: TextSpan,
    /// Source span of the binding declarator.
    pub binding: TextSpan,
    /// Lexical scope span that owns this binding.
    pub scope: TextSpan,
    /// Declarator kind so callers can decide on hoisting / mutability rules
    /// when they grow beyond the single-file slice.
    pub kind: VariableDeclarationKind,
}

/// Map from binding name to its initializer span.
///
/// Currently a flat Vec because the expected scope size for a single source
/// file is small (single-digit to low-hundreds of bindings) and ordered
/// iteration during diagnostics is useful. Swap for a `HashMap` if profiling
/// later flags lookup as hot.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DeclaratorScope {
    entries: Vec<(String, BindingEntry)>,
}

impl DeclaratorScope {
    /// Build a scope by walking same-file variable declarations in `program`.
    pub fn from_program(program: &Program<'_>) -> Self {
        let mut collector = ScopeCollector {
            entries: Vec::new(),
            scope_stack: vec![text_span(program.span)],
        };
        collector.visit_program(program);
        Self {
            entries: collector.entries,
        }
    }

    /// Returns the most recent binding for `name`, or `None` if absent.
    ///
    /// "Most recent" matters because a later declarator can shadow an
    /// earlier one in the same source file (e.g. `const X = ...; const X
    /// = ...` is a syntax error in standalone scopes but valid across
    /// `if`/`else` branches that have been hoisted to a single arena).
    /// Returning the last entry mirrors the runtime semantics of JS scope
    /// rules in the most common patterns we care about.
    pub fn resolve(&self, name: &str) -> Option<&BindingEntry> {
        self.entries
            .iter()
            .rfind(|(n, _)| n == name)
            .map(|(_, b)| b)
    }

    /// Resolve the closest visible binding for `name` before `reference_start`.
    ///
    /// This deliberately rejects declarations that appear after the JSX
    /// reference and declarations whose lexical scope span does not contain the
    /// reference. That prevents the native parser from using a later hot-reload
    /// edit or a sibling function's local const as if it were visible.
    pub fn resolve_before(&self, name: &str, reference_start: u32) -> Option<&BindingEntry> {
        self.entries
            .iter()
            .filter(|(n, entry)| {
                n == name
                    && entry.binding.start <= reference_start
                    && span_contains(entry.scope, reference_start)
            })
            .max_by_key(|(_, entry)| (Reverse(entry.scope.len()), entry.binding.start))
            .map(|(_, entry)| entry)
    }

    /// Total number of recorded bindings.
    pub const fn len(&self) -> usize {
        self.entries.len()
    }

    /// Convenience for tests + diagnostics — was anything recorded?
    pub const fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Internal iterator used by tests; not part of the stable surface.
    #[cfg(test)]
    pub(crate) fn entries(&self) -> impl Iterator<Item = (&str, &BindingEntry)> {
        self.entries.iter().map(|(n, b)| (n.as_str(), b))
    }

    /// Resolve `name` to the AST expression it was initialised with, by
    /// walking `program` until the recorded initializer span matches.
    ///
    /// Returns `None` for unknown names, destructured bindings, or names
    /// whose initializer span has been mutated between scope-build time and
    /// this call (the latter should never happen with the immutable arena
    /// the parser uses, but the check is cheap and defensive).
    ///
    /// O(N) over `program.body` per call — acceptable for the per-file
    /// resolution rate (single-digit identifier `sz` references per file).
    pub fn resolve_initializer<'a>(
        &self,
        name: &str,
        program: &'a Program<'a>,
    ) -> Option<&'a Expression<'a>> {
        let entry = self.resolve(name)?;
        find_initializer_at_span(program, entry.initializer)
    }

    /// Position-aware version of [`Self::resolve_initializer`].
    pub fn resolve_initializer_before<'a>(
        &self,
        name: &str,
        reference_start: u32,
        program: &'a Program<'a>,
    ) -> Option<&'a Expression<'a>> {
        let entry = self.resolve_before(name, reference_start)?;
        find_initializer_at_span(program, entry.initializer)
    }
}

fn find_initializer_at_span<'a>(
    program: &'a Program<'a>,
    span: TextSpan,
) -> Option<&'a Expression<'a>> {
    let mut finder = InitializerFinder { span, found: None };
    finder.visit_program(program);
    finder.found.map(|found| {
        // SAFETY: The pointer was captured from `program` during the visitor
        // walk above. The AST arena is immutable for the whole `'a` borrow, so
        // reborrowing it here is equivalent to returning the matched expression
        // from a manual recursive traversal.
        unsafe { &*found }
    })
}

struct InitializerFinder<'a> {
    span: TextSpan,
    found: Option<*const Expression<'a>>,
}

impl<'a> Visit<'a> for InitializerFinder<'a> {
    fn visit_variable_declaration(&mut self, decl: &VariableDeclaration<'a>) {
        if self.found.is_some() {
            return;
        }
        for declarator in &decl.declarations {
            let Some(init) = &declarator.init else {
                continue;
            };
            let init_span = init.span();
            if init_span.start == self.span.start && init_span.end == self.span.end {
                self.found = Some(std::ptr::from_ref::<Expression<'a>>(init));
                return;
            }
        }

        walk::walk_variable_declaration(self, decl);
    }
}

struct ScopeCollector {
    entries: Vec<(String, BindingEntry)>,
    scope_stack: Vec<TextSpan>,
}

impl ScopeCollector {
    fn current_scope(&self) -> TextSpan {
        self.scope_stack
            .last()
            .copied()
            .expect("scope stack always has program scope")
    }
}

impl<'a> Visit<'a> for ScopeCollector {
    fn visit_block_statement(&mut self, block: &BlockStatement<'a>) {
        self.scope_stack.push(text_span(block.span));
        walk::walk_block_statement(self, block);
        self.scope_stack.pop();
    }

    fn visit_function_body(&mut self, body: &FunctionBody<'a>) {
        self.scope_stack.push(text_span(body.span));
        walk::walk_function_body(self, body);
        self.scope_stack.pop();
    }

    fn visit_variable_declaration(&mut self, decl: &VariableDeclaration<'a>) {
        collect_var_declarations(decl, self.current_scope(), &mut self.entries);
        walk::walk_variable_declaration(self, decl);
    }
}

fn collect_var_declarations(
    decl: &VariableDeclaration<'_>,
    scope: TextSpan,
    out: &mut Vec<(String, BindingEntry)>,
) {
    for declarator in &decl.declarations {
        let Some(init) = &declarator.init else {
            continue;
        };
        let BindingPattern::BindingIdentifier(id) = &declarator.id else {
            continue;
        };
        let init_span = init.span();
        let binding_span = declarator.span();
        let initializer = TextSpan::new(init_span.start, init_span.end)
            .expect("oxc-parser produced inverted span for initializer");
        let binding = TextSpan::new(binding_span.start, binding_span.end)
            .expect("oxc-parser produced inverted span for binding");
        out.push((
            id.name.as_str().to_string(),
            BindingEntry {
                initializer,
                binding,
                scope,
                kind: decl.kind,
            },
        ));
    }
}

fn text_span(span: oxc_span::Span) -> TextSpan {
    TextSpan::new(span.start, span.end).expect("oxc-parser produced inverted span")
}

const fn span_contains(span: TextSpan, offset: u32) -> bool {
    span.start <= offset && offset <= span.end
}

/// Compatibility helper: returns the span of an expression as a [`TextSpan`].
///
/// Kept private to this module because callers should reach for
/// [`DeclaratorScope::resolve`] and only inspect the resulting span; raw
/// expression spans are an implementation detail of how oxc-ast lays out
/// nodes.
#[allow(dead_code)]
fn span_of(expr: &Expression<'_>) -> TextSpan {
    let span = expr.span();
    TextSpan::new(span.start, span.end).expect("oxc-parser produced inverted span for expression")
}
#[cfg(test)]
mod tests {
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    use super::{DeclaratorScope, VariableDeclarationKind};

    fn build_scope(source: &str) -> (DeclaratorScope, String) {
        let allocator = Allocator::default();
        let source_type = SourceType::tsx();
        let parsed = Parser::new(&allocator, source, source_type).parse();
        assert!(
            !parsed.panicked,
            "fixture failed to parse: {:?}",
            parsed.errors
        );
        let scope = DeclaratorScope::from_program(&parsed.program);
        (scope, source.to_string())
    }

    fn span_text(source: &str, start: u32, end: u32) -> &str {
        &source[start as usize..end as usize]
    }

    fn offset_of(source: &str, needle: &str) -> u32 {
        u32::try_from(source.find(needle).expect("needle exists")).expect("fixture offset fits u32")
    }

    #[test]
    fn records_top_level_const_initializer() {
        let (scope, source) =
            build_scope("const BASE = { p: 4 };\nconst App = () => <div sz={BASE} />;\n");

        let entry = scope.resolve("BASE").expect("BASE binding");
        assert_eq!(entry.kind, VariableDeclarationKind::Const);
        assert_eq!(
            span_text(&source, entry.initializer.start, entry.initializer.end),
            "{ p: 4 }",
        );
    }

    #[test]
    fn records_top_level_let_initializer() {
        let (scope, source) = build_scope("let theme = { dark: true };");

        let entry = scope.resolve("theme").expect("theme binding");
        assert_eq!(entry.kind, VariableDeclarationKind::Let);
        assert_eq!(
            span_text(&source, entry.initializer.start, entry.initializer.end),
            "{ dark: true }",
        );
    }

    #[test]
    fn records_multiple_declarators_in_one_statement() {
        let (scope, source) = build_scope("const A = 1, B = { x: 1 }, C = [1, 2];");

        assert_eq!(scope.len(), 3);
        assert_eq!(
            span_text(
                &source,
                scope.resolve("A").unwrap().initializer.start,
                scope.resolve("A").unwrap().initializer.end,
            ),
            "1",
        );
        assert_eq!(
            span_text(
                &source,
                scope.resolve("B").unwrap().initializer.start,
                scope.resolve("B").unwrap().initializer.end,
            ),
            "{ x: 1 }",
        );
        assert_eq!(
            span_text(
                &source,
                scope.resolve("C").unwrap().initializer.start,
                scope.resolve("C").unwrap().initializer.end,
            ),
            "[1, 2]",
        );
    }

    #[test]
    fn records_export_named_declaration() {
        let (scope, source) = build_scope("export const BASE = { p: 4 };");

        let entry = scope.resolve("BASE").expect("export const records");
        assert_eq!(
            span_text(&source, entry.initializer.start, entry.initializer.end),
            "{ p: 4 }",
        );
    }

    #[test]
    fn records_function_body_local_initializer() {
        let source =
            "const App = () => {\n  const BASE = { p: 4 };\n  return <div sz={BASE} />;\n};";
        let (scope, source) = build_scope(source);

        let reference = offset_of(&source, "BASE} />");
        let entry = scope
            .resolve_before("BASE", reference)
            .expect("function-body local binding");
        assert_eq!(
            span_text(&source, entry.initializer.start, entry.initializer.end),
            "{ p: 4 }",
        );
    }

    #[test]
    fn resolve_before_prefers_inner_scope() {
        let source = "const BASE = { p: 1 };\nconst App = () => {\n  const BASE = { p: 4 };\n  return <div sz={BASE} />;\n};";
        let (scope, source) = build_scope(source);

        let reference = offset_of(&source, "BASE} />");
        let entry = scope
            .resolve_before("BASE", reference)
            .expect("visible inner binding");
        assert_eq!(
            span_text(&source, entry.initializer.start, entry.initializer.end),
            "{ p: 4 }",
        );
    }

    #[test]
    fn resolve_before_rejects_later_binding() {
        let source = "const App = () => <div sz={BASE} />;\nconst BASE = { p: 4 };";
        let (scope, source) = build_scope(source);

        let reference = offset_of(&source, "BASE} />");
        assert!(scope.resolve_before("BASE", reference).is_none());
    }

    #[test]
    fn resolve_before_rejects_sibling_function_local() {
        let source = "const A = () => {\n  const BASE = { p: 4 };\n  return null;\n};\nconst B = () => <div sz={BASE} />;";
        let (scope, source) = build_scope(source);

        let reference = offset_of(&source, "BASE} />");
        assert!(scope.resolve_before("BASE", reference).is_none());
    }

    #[test]
    fn skips_declarators_without_initializer() {
        let (scope, _) = build_scope("let pending;");
        assert!(scope.is_empty());
    }

    #[test]
    fn skips_destructuring_patterns() {
        let (scope, _) = build_scope("const { p } = { p: 4 };\nconst [a] = [1];");
        // Destructured names are deliberately not tracked in this slice —
        // see comment in collect_var_declarations.
        assert!(scope.resolve("p").is_none());
        assert!(scope.resolve("a").is_none());
    }

    #[test]
    fn ignores_function_and_class_declarations() {
        let (scope, _) =
            build_scope("function helper() { return 1; }\nclass Widget {}\nconst USED = 'x';");

        assert_eq!(scope.len(), 1);
        assert!(scope.resolve("helper").is_none());
        assert!(scope.resolve("Widget").is_none());
        assert!(scope.resolve("USED").is_some());
    }

    #[test]
    fn returns_most_recent_when_name_repeats_in_branches() {
        // Same name declared in two top-level branches is an invalid JS
        // program in a single scope, but JS parses it as two separate
        // declarations. Our resolver returns the LAST one — that mirrors
        // the runtime "later declaration wins" rule and matches what a
        // user editing a file would expect after a hot reload.
        let (scope, source) = build_scope("const X = 1;\nconst Y = 2;\nconst X = { p: 4 };");

        let entry = scope.resolve("X").expect("shadowed X resolves to latest");
        assert_eq!(
            span_text(&source, entry.initializer.start, entry.initializer.end),
            "{ p: 4 }",
        );
    }

    #[test]
    fn returns_none_for_unknown_names() {
        let (scope, _) = build_scope("const A = 1;");
        assert!(scope.resolve("missing").is_none());
    }
}
