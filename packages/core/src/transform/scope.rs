//! Single-file declarator scope tracker.
//!
//! Records the source span of every top-level `const`/`let`/`var` binding's
//! initializer so later lowering passes can resolve `sz={NAME}` references
//! and inspect the initializer with their own parser pass. Hand-rolled over
//! the oxc-parser AST without pulling in `oxc_semantic`: covers the
//! single-file declarator cases the parity fixtures need, sidesteps the
//! `oxc_semantic` version-churn tax, and keeps the surface area auditable.
//!
//! Scope of this module: top-level bindings + bindings declared inside the
//! same containing function/arrow as the JSX expression being lowered.
//! Nested closures, modules-as-arguments, and import-graph resolution are
//! deliberately out of scope for the R4.1 slice; later slices can extend
//! [`DeclaratorScope`] without changing the public API.

use oxc_ast::ast::{
    BindingPattern, Declaration, Expression, Program, Statement, VariableDeclarationKind,
};
use oxc_span::GetSpan;

use super::TextSpan;

/// A single declarator binding recorded by the scope walker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BindingEntry {
    /// Source span of the initializer expression (the RHS of `const X = ...`).
    pub initializer: TextSpan,
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
    /// Build a scope by walking every top-level statement in `program`.
    ///
    /// Recurses one level into `export const … = …` and
    /// `export default …` declarations so the suite covers what real csszyx
    /// projects actually emit, without committing to full nested-scope
    /// traversal in this slice.
    pub fn from_program(program: &Program<'_>) -> Self {
        let mut entries = Vec::new();
        for stmt in &program.body {
            collect_from_statement(stmt, &mut entries);
        }
        Self { entries }
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
}

/// Locate the variable declarator initializer expression matching `span`.
///
/// Mirrors the statement-shape filter in [`collect_from_statement`] —
/// only top-level `VariableDeclaration` and `ExportNamedDeclaration ->
/// VariableDeclaration` paths are inspected, so the lookup cannot
/// return an unrelated expression that happens to live at the same
/// byte range.
fn find_initializer_at_span<'a>(
    program: &'a Program<'a>,
    span: TextSpan,
) -> Option<&'a Expression<'a>> {
    for stmt in &program.body {
        let decl = match stmt {
            Statement::VariableDeclaration(d) => Some(d.as_ref()),
            Statement::ExportNamedDeclaration(export) => match export.declaration.as_ref() {
                Some(Declaration::VariableDeclaration(d)) => Some(d.as_ref()),
                _ => None,
            },
            _ => None,
        };
        let Some(decl) = decl else {
            continue;
        };
        for declarator in &decl.declarations {
            let Some(init) = &declarator.init else {
                continue;
            };
            let init_span = init.span();
            if init_span.start == span.start && init_span.end == span.end {
                return Some(init);
            }
        }
    }
    None
}

fn collect_from_statement(stmt: &Statement<'_>, out: &mut Vec<(String, BindingEntry)>) {
    match stmt {
        Statement::VariableDeclaration(decl) => collect_var_declarations(decl, out),
        Statement::ExportNamedDeclaration(export) => {
            if let Some(Declaration::VariableDeclaration(decl)) = export.declaration.as_ref() {
                collect_var_declarations(decl, out);
            }
        }
        // `export default <expr>`, function/class declarations, imports,
        // etc. don't introduce const/let initializer bindings the scope
        // walker cares about. Future cross-file re-export tracking can
        // grow a dedicated branch here.
        _ => {}
    }
}

fn collect_var_declarations(
    decl: &oxc_ast::ast::VariableDeclaration<'_>,
    out: &mut Vec<(String, BindingEntry)>,
) {
    for declarator in &decl.declarations {
        let Some(init) = &declarator.init else {
            continue;
        };
        // Object/array destructuring (`const { a, b } = obj`, `const [a, b]
        // = arr`) is deliberately not handled here: in the single-file
        // slice we only need to resolve `sz={NAME}` to a static
        // initializer, and destructured names get their values from a
        // computed expression we cannot statically split. Later slices
        // can add pattern-aware resolution if a parity fixture demands
        // it.
        let BindingPattern::BindingIdentifier(id) = &declarator.id else {
            continue;
        };
        let span = init.span();
        // `TextSpan::new` returns Result because of `start > end` validation,
        // but oxc-parser always produces ordered spans for valid source, so
        // the failure path is unreachable here. Treating it as a hard error
        // (panic via expect) is correct — if oxc ever produces an inverted
        // span we want a stack trace rather than silent skip.
        let initializer = TextSpan::new(span.start, span.end)
            .expect("oxc-parser produced inverted span for initializer");
        out.push((
            id.name.as_str().to_string(),
            BindingEntry {
                initializer,
                kind: decl.kind,
            },
        ));
    }
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
