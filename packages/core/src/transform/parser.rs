use oxc_allocator::Allocator;
use oxc_ast::{
    ast::{
        Argument, ArrayExpression, ArrayExpressionElement, CallExpression, ConditionalExpression,
        Expression, JSXAttribute, JSXAttributeItem, JSXAttributeName, JSXAttributeValue,
        JSXElement, JSXElementName, JSXExpression, JSXFragment, JSXMemberExpression,
        JSXMemberExpressionObject, JSXOpeningElement, ObjectExpression, ObjectProperty,
        ObjectPropertyKind, PropertyKey, UnaryOperator,
    },
    AstKind,
};
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType, Span};
use std::time::Instant;

use super::{
    lower::{dynamic_css_var_class, lower_static_sz_object},
    ClassAttributeIr, DynamicCssVarCategory, DynamicCssVarIr, JsxOpeningElementIr,
    RecoveryAttributeIr, RecoveryMode, SourceIr, StaticArrayPartIr, StaticSzObject,
    StaticSzProperty, StaticSzValue, StaticTernaryIr, StyleAttributeIr, SzAttributeIr,
    SzsAttributeIr, SzsSlotEntryIr, TextSpan, TransformFile, TransformTimings,
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
    parse_source_shell_with_budget(file, AST_BUDGET)
}

/// [`parse_source_shell`] with an explicit AST node budget.
///
/// The budget is caller-configurable (`build.astBudgetLimit` reaches here
/// through the napi options) because engines count AST nodes differently:
/// a real-world page file can exceed the default under one engine while
/// staying under it in another, and the only remedy is raising the cap.
pub fn parse_source_shell_with_budget(
    file: &TransformFile,
    ast_budget: usize,
) -> ParsedSourceShell {
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
            ast_budget,
            ast_budget_exceeded: false,
            scope: &scope,
            program: &parsed.program,
            element_stack: Vec::new(),
        };
        let ir_start = Instant::now();
        visitor.visit_program(&parsed.program);
        timings.ir_ns = elapsed_ns(ir_start);
        visitor.ast_budget_exceeded
    };

    let mut diagnostics: Vec<String> = parsed
        .errors
        .iter()
        .map(std::string::ToString::to_string)
        .collect();
    if !parsed.errors.is_empty() || parsed.panicked {
        // A file the parser rejects contributes nothing (or only fragments) to
        // the safelist, and unlike the JS engines there is no Babel fallback on
        // the native path — so make the skip observable. The bundler plugin
        // promotes this marker to a build warning when the file yielded no
        // classes, instead of letting the classes die silently under
        // Tailwind `source(none)`.
        diagnostics.insert(
            0,
            format!(
                "[csszyx] parse error in {}: the native engine could not fully scan this file ({} syntax error(s))",
                file.filename,
                parsed.errors.len()
            ),
        );
    }
    ParsedSourceShell {
        ir,
        diagnostics,
        panicked: parsed.panicked,
        ast_budget_exceeded,
        timings,
    }
}

fn elapsed_ns(start: Instant) -> u64 {
    u64::try_from(start.elapsed().as_nanos()).unwrap_or(u64::MAX)
}

fn source_type_for_path(filename: &str) -> SourceType {
    let source_type = SourceType::from_path(filename).unwrap_or_else(|_| SourceType::tsx());
    // React-17-era codebases routinely keep JSX in plain `.js` files (Babel and
    // swc accept that by default). oxc maps `.js` to a JSX-less grammar, so the
    // parse failed and the file silently contributed NOTHING to the safelist —
    // whole files of classes went missing under the native engine while the JS
    // engines recovered via the Babel fallback. JSX-enabled parsing of plain JS
    // is a superset (a leading `<` is a syntax error otherwise), so opt every
    // JavaScript file in. TypeScript stays as mapped: `.ts` genuinely cannot
    // carry JSX (generic-cast ambiguity) and `.tsx` already parses it.
    if source_type.is_javascript() {
        source_type.with_jsx(true)
    } else {
        source_type
    }
}

struct CsszyxIrVisitor<'source, 'ir, 'p> {
    source: &'source str,
    ir: &'ir mut SourceIr,
    node_count: usize,
    /// Effective AST node cap for this parse (default [`AST_BUDGET`]).
    ast_budget: usize,
    ast_budget_exceeded: bool,
    /// Top-level declarator scope used to resolve `sz={NAME}` references
    /// to their initializer expression. Stored by reference so its
    /// underlying allocator outlives the visitor.
    scope: &'p super::scope::DeclaratorScope,
    /// Backing program used together with `scope` to look up identifier
    /// initializer expressions during static lowering.
    program: &'p oxc_ast::ast::Program<'p>,
    /// JSX element/fragment index stack for parent-tree lowering.
    element_stack: Vec<usize>,
}

impl<'a> Visit<'a> for CsszyxIrVisitor<'_, '_, 'a> {
    fn enter_node(&mut self, _kind: AstKind<'a>) {
        self.node_count = self.node_count.saturating_add(1);
        if self.node_count > self.ast_budget {
            self.ast_budget_exceeded = true;
        }
    }

    fn visit_jsx_element(&mut self, element: &JSXElement<'a>) {
        if self.ast_budget_exceeded {
            return;
        }

        let before = self.ir.jsx_opening_elements.len();
        self.visit_jsx_opening_element(&element.opening_element);
        if self.ir.jsx_opening_elements.len() > before {
            let index = self.ir.jsx_opening_elements.len() - 1;
            self.element_stack.push(index);
            self.visit_jsx_children(&element.children);
            self.element_stack.pop();
        } else {
            self.visit_jsx_children(&element.children);
        }
        if let Some(closing_element) = &element.closing_element {
            self.visit_jsx_closing_element(closing_element);
        }
    }

    fn visit_jsx_fragment(&mut self, fragment: &JSXFragment<'a>) {
        if self.ast_budget_exceeded {
            return;
        }

        let index = self.ir.jsx_opening_elements.len();
        self.ir.jsx_opening_elements.push(JsxOpeningElementIr {
            opening_span: text_span(fragment.span),
            parent_element_index: self.element_stack.last().copied(),
            can_host_style: false,
            sz_attribute_indices: Vec::new(),
            class_attribute_index: None,
            style_attribute_index: None,
            recovery_attribute_index: None,
            has_recovery_token_attribute: false,
            last_attribute_end: None,
            element_name: "<>".to_string(),
            hoisted_dynamic_css_vars: Vec::new(),
        });

        self.element_stack.push(index);
        self.visit_jsx_children(&fragment.children);
        self.element_stack.pop();
    }

    fn visit_jsx_opening_element(&mut self, element: &JSXOpeningElement<'a>) {
        if self.ast_budget_exceeded {
            return;
        }

        let element_name = jsx_element_name(&element.name);
        let mut sz_attribute_indices = Vec::new();
        let mut class_attribute_index = None;
        let mut style_attribute_index = None;
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
                    "style" => {
                        if let Some(index) = self.collect_style_attribute(attr) {
                            style_attribute_index = Some(index);
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
                    "szs" => {
                        self.collect_szs_attribute(attr, is_style_host_element_name(&element_name));
                    }
                    _ => {}
                }
            }
        }

        self.ir.jsx_opening_elements.push(JsxOpeningElementIr {
            opening_span: text_span(element.span),
            parent_element_index: self.element_stack.last().copied(),
            can_host_style: is_style_host_element_name(&element_name),
            sz_attribute_indices,
            class_attribute_index,
            style_attribute_index,
            recovery_attribute_index,
            has_recovery_token_attribute,
            last_attribute_end,
            element_name,
            hoisted_dynamic_css_vars: Vec::new(),
        });

        walk::walk_jsx_opening_element(self, element);
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if self.ast_budget_exceeded {
            return;
        }

        self.collect_catalog_call_classes(call);
        walk::walk_call_expression(self, call);
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

    #[allow(clippy::too_many_lines)]
    /// Collect a `szs` slot-map attribute. Enforces the shared v1 contract
    /// (identifier keys; pure-literal object or class-string values) and lowers
    /// each object slot at parse time. Host elements and unsupported shapes
    /// leave the attribute untouched and record a diagnostic instead.
    fn collect_szs_attribute(&mut self, attr: &JSXAttribute<'_>, is_host: bool) {
        if is_host {
            let message = format!(
                "[csszyx] szs at {}: szs has no effect on a host element \u{2014} it maps slot names of a custom component. Attribute left unchanged.",
                self.ir.filename
            );
            self.ir.szs_diagnostics.push(message);
            return;
        }
        let unsupported_message = format!(
            "[csszyx] szs at {}: every slot must be an identifier key with a static object literal (or class string) value. Attribute left unchanged.",
            self.ir.filename
        );
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attr.value else {
            self.ir.szs_diagnostics.push(unsupported_message);
            return;
        };
        let JSXExpression::ObjectExpression(slot_map) = &container.expression else {
            self.ir.szs_diagnostics.push(unsupported_message);
            return;
        };
        let ctx = self.resolve_context();
        let mut entries = Vec::with_capacity(slot_map.properties.len());
        for property in &slot_map.properties {
            let ObjectPropertyKind::ObjectProperty(prop) = property else {
                self.ir.szs_diagnostics.push(unsupported_message);
                return;
            };
            if prop.computed {
                self.ir.szs_diagnostics.push(unsupported_message);
                return;
            }
            let PropertyKey::StaticIdentifier(identifier) = &prop.key else {
                self.ir.szs_diagnostics.push(unsupported_message);
                return;
            };
            let key = identifier.name.to_string();
            match &prop.value {
                Expression::StringLiteral(value) => {
                    // Raw class string (also pass-1 output, so the transform is
                    // idempotent): safelist, keep the original text.
                    let value_span = prop.value.span();
                    entries.push(SzsSlotEntryIr {
                        key,
                        class_name: value.value.to_string(),
                        emit_text: self.source[value_span.start as usize..value_span.end as usize]
                            .to_string(),
                    });
                }
                Expression::ObjectExpression(object) => {
                    if !is_pure_literal_szs_object(object) {
                        self.ir.szs_diagnostics.push(unsupported_message);
                        return;
                    }
                    let Some(static_object) = static_object_from_object_expression(object, ctx)
                    else {
                        self.ir.szs_diagnostics.push(unsupported_message);
                        return;
                    };
                    let class_name = lower_static_sz_object(&static_object).join(" ");
                    entries.push(SzsSlotEntryIr {
                        emit_text: format!("\"{}\"", escape_json_string(&class_name)),
                        class_name,
                        key,
                    });
                }
                _ => {
                    self.ir.szs_diagnostics.push(unsupported_message);
                    return;
                }
            }
        }
        self.ir.szs_attributes.push(SzsAttributeIr {
            attribute_span: text_span(attr.span),
            entries,
        });
    }

    #[allow(clippy::too_many_lines)]
    fn collect_sz_attribute(&mut self, attr: &JSXAttribute<'_>) -> Option<usize> {
        let ctx = self.resolve_context();
        let (
            object,
            value_span,
            literal_class_name,
            rewrites_empty_class,
            ternary,
            array_parts,
            runtime_fallback,
            candidate_classes,
            dynamic_css_vars,
        ) = match &attr.value {
            Some(JSXAttributeValue::StringLiteral(value)) => (
                StaticSzObject::empty(),
                string_value_span(value.span, self.source),
                Some(value.value.to_string()),
                true,
                None,
                Vec::new(),
                false,
                Vec::new(),
                Vec::new(),
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
                        Vec::new(),
                        false,
                        Vec::new(),
                        Vec::new(),
                    )
                } else if let Some((object, value_span, rewrites_empty_class)) =
                    static_object_from_jsx_expression(&container.expression, ctx)
                {
                    (
                        object,
                        value_span,
                        None,
                        rewrites_empty_class,
                        None,
                        Vec::new(),
                        false,
                        Vec::new(),
                        Vec::new(),
                    )
                } else if let Some((object, value_span, dynamic_css_vars, ternary)) =
                    partial_object_from_jsx_expression(&container.expression, ctx)
                {
                    (
                        object,
                        value_span,
                        None,
                        false,
                        ternary,
                        Vec::new(),
                        false,
                        Vec::new(),
                        dynamic_css_vars,
                    )
                } else if let Some((array_parts, value_span)) =
                    static_array_parts_from_jsx_expression(&container.expression, ctx)
                {
                    (
                        StaticSzObject::empty(),
                        value_span,
                        None,
                        false,
                        None,
                        array_parts,
                        false,
                        Vec::new(),
                        Vec::new(),
                    )
                } else if let Some(value_span) =
                    runtime_fallback_span_from_jsx_expression(&container.expression)
                {
                    let candidate_classes =
                        candidate_classes_from_jsx_expression(&container.expression, ctx);
                    (
                        StaticSzObject::empty(),
                        value_span,
                        None,
                        false,
                        None,
                        Vec::new(),
                        true,
                        candidate_classes,
                        Vec::new(),
                    )
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
            array_parts,
            runtime_fallback,
            runtime_fallback_spread: runtime_fallback
                && jsx_attribute_value_has_top_level_spread(attr.value.as_ref()),
            candidate_classes,
            dynamic_css_vars,
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

    fn collect_style_attribute(&mut self, attr: &JSXAttribute<'_>) -> Option<usize> {
        let expression_span = match &attr.value {
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                if matches!(container.expression, JSXExpression::EmptyExpression(_)) {
                    return None;
                }
                Some(text_span(container.expression.span()))
            }
            _ => None,
        };

        let index = self.ir.style_attributes.len();
        self.ir.style_attributes.push(StyleAttributeIr {
            attribute_span: text_span(attr.span),
            expression_span,
        });
        Some(index)
    }

    fn collect_catalog_call_classes(&mut self, call: &CallExpression<'_>) {
        let Expression::Identifier(callee) = &call.callee else {
            return;
        };
        let Some(argument) = call.arguments.first() else {
            return;
        };
        match callee.name.as_str() {
            // szr(static-object) resolves the same classes at runtime that
            // dynamic() would inject; both need their literal args safelisted.
            "dynamic" | "szr" => {
                let Some(object) = static_object_from_argument(argument, self.resolve_context())
                else {
                    return;
                };
                self.ir
                    .extracted_classes
                    .extend(lower_static_sz_object(&object));
            }
            "szv" => {
                let Some(classes) = collect_szv_catalog_classes(argument, self.resolve_context())
                else {
                    return;
                };
                self.ir.extracted_classes.extend(classes);
            }
            _ => {}
        }
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

/// Nesting cap for the lenient catalog walk (matches the oxc/Babel walkers).
const MAX_CATALOG_DEPTH: usize = 16;

/// Cap on alternate-branch objects one szv call may add to the catalog, so a
/// pathological conditional pile-up cannot balloon the safelist walk.
/// (Matches the oxc/Babel walkers.)
const MAX_CATALOG_BRANCH_EXTRAS: usize = 32;

/// Mutable extras budget threaded through one szv call's lenient walk.
struct CatalogExtrasBudget {
    /// Remaining alternate-branch objects this call may still emit.
    extras: usize,
    /// Remaining alternate branches this call may still EXPLORE. Charged when
    /// a conditional's alternate is recursed into, not when its result is
    /// emitted: a const referenced from both branches (`c ? x : x`) doubles
    /// the walk per level without consuming depth or emitting anything, so an
    /// output-only budget let an n-level chain run 2^n recursive calls (a
    /// measured exponential hang) while every list stayed within bounds.
    /// Exhausted explores degrade to consequent-only — the same
    /// under-safelist-beyond-the-budget contract `extras` already documents.
    explores: usize,
    /// Candidate memo per resolved const INITIALIZER, keyed by its span start
    /// (identity of the node — resolution is position-sensitive, so a bare
    /// name is not a sound key under shadowing). Every exponential shape is
    /// some DAG that re-resolves the same initializer — through conditionals
    /// (`c ? x : x`), spreads (`{...x, ...x}`), or sibling keys
    /// (`{a: x, b: x}`) — and the memo collapses each to one walk plus cache
    /// hits, making total work linear in the source. Inline literals cannot
    /// exponentiate on their own: each occupies distinct source text.
    object_memo: std::collections::HashMap<u32, Vec<StaticSzObject>>,
    value_memo: std::collections::HashMap<u32, Vec<StaticSzValue>>,
}

/// Collect every static class reachable from an szv configuration.
///
/// `base` and `variants` are read INDEPENDENTLY, and both convert PER KEY: one
/// unresolvable leaf (a runtime conditional, a call, a template) used to drop
/// the ENTIRE catalog — every static sibling key and every other variant
/// included — which under Tailwind `source(none)` is silently missing CSS.
/// The lenient walk keeps everything it can classify, expands finite
/// conditionals into BOTH branches (the runtime picks one, so both must be
/// safelisted), and skips only what it genuinely cannot read.
fn collect_szv_catalog_classes(
    argument: &Argument<'_>,
    ctx: ResolveContext<'_>,
) -> Option<Vec<String>> {
    // TypeScript wrappers (`satisfies` / `as` / parens) around the config are
    // type-level only — unwrap so `szv({…} satisfies SzvConfig)` still extracts.
    // Only a `const` binding is followed (never a reassigned `let`), to match
    // the const-guarded resolution on the Babel/oxc paths.
    let config = match argument.as_expression().map(unwrap_expression) {
        Some(Expression::ObjectExpression(object)) => object,
        Some(Expression::Identifier(identifier)) => {
            match ctx
                .scope
                .resolve_const_initializer_before(
                    &identifier.name,
                    identifier.span.start,
                    ctx.program,
                )
                .map(unwrap_expression)?
            {
                Expression::ObjectExpression(object) => object,
                _ => return None,
            }
        }
        _ => return None,
    };

    let mut budget = CatalogExtrasBudget {
        extras: MAX_CATALOG_BRANCH_EXTRAS,
        explores: MAX_CATALOG_BRANCH_EXTRAS,
        object_memo: std::collections::HashMap::new(),
        value_memo: std::collections::HashMap::new(),
    };
    let base_candidates = read_config_sub_object_node(config, "base", ctx).map_or_else(
        || vec![StaticSzObject::empty()],
        |node| lenient_catalog_objects(node, ctx, &mut Vec::new(), 0, &mut budget),
    );
    let base = base_candidates
        .first()
        .cloned()
        .unwrap_or_else(StaticSzObject::empty);
    let mut classes = lower_static_sz_object(&base);
    for extra in base_candidates.iter().skip(1) {
        classes.extend(lower_static_sz_object(extra));
    }

    if let Some(variants) = read_config_sub_object_node(config, "variants", ctx) {
        for dimension in &variants.properties {
            let ObjectPropertyKind::ObjectProperty(dimension) = dimension else {
                continue;
            };
            if dimension.computed {
                continue;
            }
            let Some(dimension_value) =
                resolve_catalog_object_expression(&dimension.value, ctx, &mut Vec::new())
            else {
                continue;
            };
            for variant in &dimension_value.properties {
                let ObjectPropertyKind::ObjectProperty(variant) = variant else {
                    continue;
                };
                if variant.computed {
                    continue;
                }
                for candidate in lenient_catalog_object_candidates(
                    &variant.value,
                    ctx,
                    &mut Vec::new(),
                    0,
                    &mut budget,
                ) {
                    let mut merged = base.clone();
                    merge_static_properties(&mut merged.properties, candidate.properties);
                    classes.extend(lower_static_sz_object(&merged));
                }
            }
        }
    }

    // Dedupe (first-seen order): `base` is emitted alone then merged with each
    // variant, so its classes repeat. The oxc-JS catalog collects into a Set, so
    // dedupe here too — otherwise the Rust-vs-oxc parity comparison sees Rust's
    // duplicate entries as a class divergence.
    let mut seen = std::collections::HashSet::new();
    classes.retain(|class| seen.insert(class.clone()));
    Some(classes)
}

/// Read a single named property (`base` / `variants`) of an szv config as an
/// OBJECT NODE, without converting it. Returns None when the key is absent or
/// its value is not an object literal / const-bound object — so sibling keys
/// (compoundVariants, defaultVariants, unknown keys) never affect the catalog.
/// A shorthand `{ base }` resolves through the same-named `const` binding.
fn read_config_sub_object_node<'a>(
    object: &'a ObjectExpression<'a>,
    key: &str,
    ctx: ResolveContext<'a>,
) -> Option<&'a ObjectExpression<'a>> {
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(prop) = property else {
            continue;
        };
        if prop.computed || static_property_key(&prop.key).as_deref() != Some(key) {
            continue;
        }
        return resolve_catalog_object_expression(&prop.value, ctx, &mut Vec::new());
    }
    None
}

/// Resolve a node to an object expression through const bindings (used for
/// variant DIMENSION values, which cannot fork into candidates).
fn resolve_catalog_object_expression<'a>(
    expression: &'a Expression<'a>,
    ctx: ResolveContext<'a>,
    seen: &mut Vec<String>,
) -> Option<&'a ObjectExpression<'a>> {
    match unwrap_expression(expression) {
        Expression::ObjectExpression(object) => Some(object),
        Expression::Identifier(identifier) => {
            if seen.iter().any(|name| name == identifier.name.as_str()) {
                return None;
            }
            let init = ctx.scope.resolve_const_initializer_before(
                &identifier.name,
                identifier.span.start,
                ctx.program,
            )?;
            seen.push(identifier.name.to_string());
            let resolved = resolve_catalog_object_expression(init, ctx, seen);
            seen.pop();
            resolved
        }
        _ => None,
    }
}

/// Convert an object node into catalog candidates, PER KEY: index 0 is the
/// primary object (conditionals resolved to their consequent), the rest are
/// minimal path-preserving objects carrying alternate branch values (e.g.
/// `{ hover: { mx: dense ? 0 : 2 } }` → `[{hover:{mx:0}}, {hover:{mx:2}}]`).
/// Keys whose value cannot be classified are skipped INDIVIDUALLY — sz keys
/// lower independently, so sibling classes survive. Catalog-only: the strict
/// sz-attribute conversion keeps its fall-to-runtime contract.
fn lenient_catalog_objects<'a>(
    object: &'a ObjectExpression<'a>,
    ctx: ResolveContext<'a>,
    seen: &mut Vec<String>,
    depth: usize,
    budget: &mut CatalogExtrasBudget,
) -> Vec<StaticSzObject> {
    if depth > MAX_CATALOG_DEPTH {
        return vec![StaticSzObject::empty()];
    }
    let mut primary = StaticSzObject::empty();
    let mut extras: Vec<StaticSzObject> = Vec::new();
    for property in &object.properties {
        match property {
            ObjectPropertyKind::SpreadProperty(spread) => {
                let mut candidates = lenient_catalog_object_candidates(
                    &spread.argument,
                    ctx,
                    seen,
                    depth + 1,
                    budget,
                );
                if candidates.is_empty() {
                    continue;
                }
                let rest = candidates.split_off(1);
                if let Some(first) = candidates.pop() {
                    merge_static_properties(&mut primary.properties, first.properties);
                }
                for extra in rest {
                    push_catalog_extra(&mut extras, extra, budget);
                }
            }
            ObjectPropertyKind::ObjectProperty(prop) => {
                if prop.computed || prop.method {
                    continue;
                }
                let Some(key) = static_property_key(&prop.key) else {
                    continue;
                };
                let mut values = lenient_catalog_values(&prop.value, ctx, seen, depth + 1, budget);
                if values.is_empty() {
                    continue;
                }
                let rest = values.split_off(1);
                let Some(first) = values.pop() else {
                    continue;
                };
                let span = text_span(prop.span);
                merge_static_property(
                    &mut primary.properties,
                    StaticSzProperty {
                        key: key.clone(),
                        span,
                        value: first,
                    },
                );
                for value in rest {
                    push_catalog_extra(
                        &mut extras,
                        StaticSzObject {
                            properties: vec![StaticSzProperty {
                                key: key.clone(),
                                span,
                                value,
                            }],
                        },
                        budget,
                    );
                }
            }
        }
    }
    let mut result = vec![primary];
    result.extend(extras);
    result
}

/// Classify one leaf value into catalog candidates. Empty result = skip the
/// key. Finite conditionals contribute BOTH branches (the runtime resolves one
/// of them, so both classes must exist); `null`/`undefined` mean "key unset";
/// const identifiers resolve through their initializer (const-only, cycle
/// guarded); everything else — calls, members, templates — is skipped.
fn lenient_catalog_values<'a>(
    expression: &'a Expression<'a>,
    ctx: ResolveContext<'a>,
    seen: &mut Vec<String>,
    depth: usize,
    budget: &mut CatalogExtrasBudget,
) -> Vec<StaticSzValue> {
    if depth > MAX_CATALOG_DEPTH {
        return Vec::new();
    }
    match unwrap_expression(expression) {
        Expression::StringLiteral(value) => vec![StaticSzValue::String(value.value.to_string())],
        Expression::NumericLiteral(value) => vec![StaticSzValue::Number(value.value)],
        Expression::BooleanLiteral(value) => vec![StaticSzValue::Boolean(value.value)],
        // `null` means "key unset" and falls through to the catch-all skip,
        // exactly like `undefined` below.
        Expression::UnaryExpression(value) => static_value_from_unary_expression(value)
            .into_iter()
            .collect(),
        Expression::ObjectExpression(object) => {
            lenient_catalog_objects(object, ctx, seen, depth, budget)
                .into_iter()
                .map(StaticSzValue::Object)
                .collect()
        }
        Expression::ConditionalExpression(conditional) => {
            let mut values =
                lenient_catalog_values(&conditional.consequent, ctx, seen, depth, budget);
            // Same paid-exploration guard as the object-candidate lane.
            if budget.explores > 0 {
                budget.explores -= 1;
                values.extend(lenient_catalog_values(
                    &conditional.alternate,
                    ctx,
                    seen,
                    depth,
                    budget,
                ));
            }
            truncate_catalog_candidates(&mut values, budget);
            values
        }
        Expression::Identifier(identifier) => {
            if identifier.name == "undefined"
                || seen.iter().any(|name| name == identifier.name.as_str())
            {
                return Vec::new();
            }
            let Some(init) = ctx.scope.resolve_const_initializer_before(
                &identifier.name,
                identifier.span.start,
                ctx.program,
            ) else {
                return Vec::new();
            };
            let memo_key = init.span().start;
            if let Some(cached) = budget.value_memo.get(&memo_key) {
                return cached.clone();
            }
            seen.push(identifier.name.to_string());
            let values = lenient_catalog_values(init, ctx, seen, depth, budget);
            seen.pop();
            budget.value_memo.insert(memo_key, values.clone());
            values
        }
        _ => Vec::new(),
    }
}

/// Resolve a node position that must yield OBJECT candidates (a variant value,
/// a spread argument): object literals, const-bound identifiers, and finite
/// conditionals between such objects.
fn lenient_catalog_object_candidates<'a>(
    expression: &'a Expression<'a>,
    ctx: ResolveContext<'a>,
    seen: &mut Vec<String>,
    depth: usize,
    budget: &mut CatalogExtrasBudget,
) -> Vec<StaticSzObject> {
    if depth > MAX_CATALOG_DEPTH {
        return Vec::new();
    }
    match unwrap_expression(expression) {
        Expression::ObjectExpression(object) => {
            lenient_catalog_objects(object, ctx, seen, depth, budget)
        }
        Expression::ConditionalExpression(conditional) => {
            let mut candidates = lenient_catalog_object_candidates(
                &conditional.consequent,
                ctx,
                seen,
                depth,
                budget,
            );
            // The alternate is a paid exploration (see `explores`); once the
            // allowance is spent every further conditional degrades to its
            // consequent, which keeps the recursion tree linear in the source.
            if budget.explores > 0 {
                budget.explores -= 1;
                candidates.extend(lenient_catalog_object_candidates(
                    &conditional.alternate,
                    ctx,
                    seen,
                    depth,
                    budget,
                ));
            }
            // Only the first candidate plus `budget.extras` alternates can
            // ever be consumed downstream — cap the concat to that bound.
            truncate_catalog_candidates(&mut candidates, budget);
            candidates
        }
        Expression::Identifier(identifier) => {
            if seen.iter().any(|name| name == identifier.name.as_str()) {
                return Vec::new();
            }
            let Some(init) = ctx.scope.resolve_const_initializer_before(
                &identifier.name,
                identifier.span.start,
                ctx.program,
            ) else {
                return Vec::new();
            };
            let memo_key = init.span().start;
            if let Some(cached) = budget.object_memo.get(&memo_key) {
                return cached.clone();
            }
            seen.push(identifier.name.to_string());
            let candidates = lenient_catalog_object_candidates(init, ctx, seen, depth, budget);
            seen.pop();
            budget.object_memo.insert(memo_key, candidates.clone());
            candidates
        }
        _ => Vec::new(),
    }
}

/// Bound a candidate list to what can still be consumed: one primary plus the
/// remaining alternate-branch budget. See the conditional-arm note above —
/// this is the guard that keeps branch fan-out linear in the source.
fn truncate_catalog_candidates<T>(candidates: &mut Vec<T>, budget: &CatalogExtrasBudget) {
    let cap = budget.extras.saturating_add(1);
    if candidates.len() > cap {
        candidates.truncate(cap);
    }
}

/// Append an alternate-branch object to the extras list within budget.
fn push_catalog_extra(
    extras: &mut Vec<StaticSzObject>,
    extra: StaticSzObject,
    budget: &mut CatalogExtrasBudget,
) {
    if budget.extras == 0 {
        return;
    }
    budget.extras -= 1;
    extras.push(extra);
}

fn jsx_attribute_name<'a>(name: &'a JSXAttributeName<'a>) -> Option<&'a str> {
    match name {
        JSXAttributeName::Identifier(identifier) => Some(identifier.name.as_str()),
        JSXAttributeName::NamespacedName(_) => None,
    }
}

/// Whether a value is allowed inside an `szs` slot object: string / number /
/// boolean literals, a negated number, or a nested object of the same.
/// Deliberately STRICTER than the sz path (no identifiers, spreads,
/// conditionals, parens, or `as` casts) so all three engines can enforce the
/// exact same contract without a scope resolver.
fn is_pure_literal_szs_value(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::StringLiteral(_)
        | Expression::NumericLiteral(_)
        | Expression::BooleanLiteral(_) => true,
        Expression::UnaryExpression(unary) => {
            unary.operator == UnaryOperator::UnaryNegation
                && matches!(unary.argument, Expression::NumericLiteral(_))
        }
        Expression::ObjectExpression(object) => is_pure_literal_szs_object(object),
        _ => false,
    }
}

/// Whether every property of an object is a non-computed identifier-keyed
/// pure-literal value (see [`is_pure_literal_szs_value`]).
fn is_pure_literal_szs_object(object: &ObjectExpression<'_>) -> bool {
    object.properties.iter().all(|property| {
        let ObjectPropertyKind::ObjectProperty(prop) = property else {
            return false;
        };
        !prop.computed
            && matches!(prop.key, PropertyKey::StaticIdentifier(_))
            && is_pure_literal_szs_value(&prop.value)
    })
}

/// Minimal JSON string-body escape (backslash, quote, control chars) so the
/// emitted `szs` value text is byte-identical to `JSON.stringify` in the JS
/// engines for the class strings the lowering can produce.
fn escape_json_string(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            _ => escaped.push(ch),
        }
    }
    escaped
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

fn is_style_host_element_name(name: &str) -> bool {
    name.chars()
        .next()
        .is_some_and(|ch| ch == '-' || ch.is_ascii_lowercase())
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
        JSXExpression::Identifier(identifier) => {
            let initializer = ctx.scope.resolve_initializer_before(
                &identifier.name,
                identifier.span.start,
                ctx.program,
            )?;
            let (ternary, _) = static_ternary_from_expression(initializer, ctx)?;
            Some((ternary, text_span(identifier.span)))
        }
        _ => None,
    }
}

fn static_ternary_from_expression(
    expression: &Expression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<(StaticTernaryIr, TextSpan)> {
    match expression {
        Expression::ConditionalExpression(conditional) => {
            static_ternary_from_conditional(conditional, ctx)
        }
        Expression::ParenthesizedExpression(value) => {
            static_ternary_from_expression(&value.expression, ctx)
        }
        Expression::TSAsExpression(value) => static_ternary_from_expression(&value.expression, ctx),
        Expression::TSSatisfiesExpression(value) => {
            static_ternary_from_expression(&value.expression, ctx)
        }
        Expression::TSNonNullExpression(value) => {
            static_ternary_from_expression(&value.expression, ctx)
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

fn static_array_parts_from_jsx_expression(
    expression: &JSXExpression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<(Vec<StaticArrayPartIr>, TextSpan)> {
    match expression {
        JSXExpression::ArrayExpression(array) => {
            static_array_parts_from_array_expression(array, ctx)
                .map(|parts| (parts, text_span(array.span)))
        }
        JSXExpression::ParenthesizedExpression(value) => {
            static_array_parts_from_expression(&value.expression, ctx)
        }
        JSXExpression::TSAsExpression(value) => {
            static_array_parts_from_expression(&value.expression, ctx)
        }
        JSXExpression::TSSatisfiesExpression(value) => {
            static_array_parts_from_expression(&value.expression, ctx)
        }
        JSXExpression::TSNonNullExpression(value) => {
            static_array_parts_from_expression(&value.expression, ctx)
        }
        _ => None,
    }
}

fn static_array_parts_from_expression(
    expression: &Expression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<(Vec<StaticArrayPartIr>, TextSpan)> {
    match expression {
        Expression::ArrayExpression(array) => static_array_parts_from_array_expression(array, ctx)
            .map(|parts| (parts, text_span(array.span))),
        Expression::ParenthesizedExpression(value) => {
            static_array_parts_from_expression(&value.expression, ctx)
        }
        Expression::TSAsExpression(value) => {
            static_array_parts_from_expression(&value.expression, ctx)
        }
        Expression::TSSatisfiesExpression(value) => {
            static_array_parts_from_expression(&value.expression, ctx)
        }
        Expression::TSNonNullExpression(value) => {
            static_array_parts_from_expression(&value.expression, ctx)
        }
        _ => None,
    }
}

/// Classify an sz array for the szcn (later-wins) composition lane.
///
/// Runs AFTER the all-static-object deep-merge lane declined, so at least one
/// element is a class string, a `cond && obj` guard, or a dynamic expression.
/// Static parts carry pre-lowered classes; dynamic parts carry only their
/// source span (the rewrite wraps them in `_szPart`), with statically visible
/// classes inside them collected as safelist candidates. Returns None only
/// when the whole array must stay a runtime value (a spread element) —
/// matching the JS engines' classification exactly.
fn static_array_parts_from_array_expression(
    array: &ArrayExpression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<Vec<StaticArrayPartIr>> {
    let mut parts = Vec::new();

    for element in &array.elements {
        if matches!(element, ArrayExpressionElement::Elision(_)) {
            continue;
        }
        // A spread element keeps the whole array a runtime value.
        let expression = element.as_expression()?;
        let unwrapped = unwrap_expression(expression);
        if is_falsy_array_element(unwrapped) {
            continue;
        }
        if let Expression::StringLiteral(value) = unwrapped {
            parts.push(StaticArrayPartIr {
                condition_span: None,
                classes: split_class_tokens(&value.value),
                dynamic_span: None,
                candidates: Vec::new(),
                dynamic_object_literal: false,
            });
            continue;
        }
        if let Expression::LogicalExpression(logical) = unwrapped {
            if logical.operator.is_and() {
                let right = unwrap_expression(&logical.right);
                let classes = if let Expression::StringLiteral(value) = right {
                    Some(split_class_tokens(&value.value))
                } else {
                    array_element_static_object(right, ctx)
                        .map(|object| lower_static_sz_object(&object))
                };
                if let Some(classes) = classes {
                    if !classes.is_empty() {
                        parts.push(StaticArrayPartIr {
                            condition_span: Some(text_span(logical.left.span())),
                            classes,
                            dynamic_span: None,
                            candidates: Vec::new(),
                            dynamic_object_literal: false,
                        });
                    }
                    continue;
                }
                // Dynamic right side: the whole guarded element resolves at
                // runtime through `_szPart`.
                parts.push(StaticArrayPartIr {
                    condition_span: None,
                    classes: Vec::new(),
                    dynamic_span: Some(text_span(expression.span())),
                    candidates: candidate_classes_from_expression(expression, ctx),
                    dynamic_object_literal: false,
                });
                continue;
            }
        }
        if let Some(object) = array_element_static_object(unwrapped, ctx) {
            parts.push(StaticArrayPartIr {
                condition_span: None,
                classes: lower_static_sz_object(&object),
                dynamic_span: None,
                candidates: Vec::new(),
                dynamic_object_literal: false,
            });
            continue;
        }
        // Safelist best-effort: static object literals reachable inside the
        // dynamic expression (ternary branches, etc.) still get their CSS.
        // An object literal that lands here carried a runtime value, so the
        // whole element defers to `_szPart` — flagged for a build diagnostic.
        parts.push(StaticArrayPartIr {
            condition_span: None,
            classes: Vec::new(),
            dynamic_span: Some(text_span(expression.span())),
            candidates: candidate_classes_from_expression(expression, ctx),
            dynamic_object_literal: matches!(unwrapped, Expression::ObjectExpression(_)),
        });
    }

    Some(parts)
}

/// Split a raw class string into its non-empty tokens.
fn split_class_tokens(value: &str) -> Vec<String> {
    value
        .split_whitespace()
        .map(std::string::ToString::to_string)
        .collect()
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

/// Returns true when the `sz` attribute value is an object literal carrying a
/// top-level spread (`sz={{ ...x }}`). This is the unresolvable-spread shape
/// that forces a runtime fallback the static layer can't evaluate — flagged so
/// a build-log diagnostic can surface it, distinct from other fallback shapes
/// (e.g. a dynamic value-object sub-field) which must not warn.
fn jsx_attribute_value_has_top_level_spread(value: Option<&JSXAttributeValue<'_>>) -> bool {
    match value {
        Some(JSXAttributeValue::ExpressionContainer(container)) => {
            jsx_expression_has_top_level_spread(&container.expression)
        }
        _ => false,
    }
}

fn jsx_expression_has_top_level_spread(expression: &JSXExpression<'_>) -> bool {
    match expression {
        JSXExpression::TSAsExpression(value) => expression_has_top_level_spread(&value.expression),
        JSXExpression::TSSatisfiesExpression(value) => {
            expression_has_top_level_spread(&value.expression)
        }
        JSXExpression::TSNonNullExpression(value) => {
            expression_has_top_level_spread(&value.expression)
        }
        JSXExpression::ParenthesizedExpression(value) => {
            expression_has_top_level_spread(&value.expression)
        }
        JSXExpression::ObjectExpression(object) => object
            .properties
            .iter()
            .any(|property| matches!(property, ObjectPropertyKind::SpreadProperty(_))),
        _ => false,
    }
}

fn expression_has_top_level_spread(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::TSAsExpression(value) => expression_has_top_level_spread(&value.expression),
        Expression::TSSatisfiesExpression(value) => {
            expression_has_top_level_spread(&value.expression)
        }
        Expression::TSNonNullExpression(value) => {
            expression_has_top_level_spread(&value.expression)
        }
        Expression::ParenthesizedExpression(value) => {
            expression_has_top_level_spread(&value.expression)
        }
        Expression::ObjectExpression(object) => object
            .properties
            .iter()
            .any(|property| matches!(property, ObjectPropertyKind::SpreadProperty(_))),
        _ => false,
    }
}

fn candidate_classes_from_jsx_expression(
    expression: &JSXExpression<'_>,
    ctx: ResolveContext<'_>,
) -> Vec<String> {
    match expression {
        JSXExpression::ObjectExpression(object) => {
            candidate_classes_from_object_expression(object, ctx, None, &[])
        }
        JSXExpression::ArrayExpression(array) => {
            candidate_classes_from_array_expression(array, ctx)
        }
        JSXExpression::TSAsExpression(value) => {
            candidate_classes_from_expression(&value.expression, ctx)
        }
        JSXExpression::TSSatisfiesExpression(value) => {
            candidate_classes_from_expression(&value.expression, ctx)
        }
        JSXExpression::TSNonNullExpression(value) => {
            candidate_classes_from_expression(&value.expression, ctx)
        }
        JSXExpression::ParenthesizedExpression(parenthesized) => {
            candidate_classes_from_expression(&parenthesized.expression, ctx)
        }
        JSXExpression::Identifier(identifier) => ctx
            .scope
            .resolve_initializer_before(&identifier.name, identifier.span.start, ctx.program)
            .map_or_else(Vec::new, |initializer| {
                candidate_classes_from_expression(initializer, ctx)
            }),
        JSXExpression::ConditionalExpression(conditional) => {
            let mut classes = candidate_classes_from_expression(&conditional.consequent, ctx);
            classes.extend(candidate_classes_from_expression(
                &conditional.alternate,
                ctx,
            ));
            classes
        }
        JSXExpression::LogicalExpression(logical) => {
            candidate_classes_from_expression(&logical.right, ctx)
        }
        _ => Vec::new(),
    }
}

fn candidate_classes_from_expression(
    expression: &Expression<'_>,
    ctx: ResolveContext<'_>,
) -> Vec<String> {
    match expression {
        Expression::ArrayExpression(array) => candidate_classes_from_array_expression(array, ctx),
        Expression::ObjectExpression(object) => {
            candidate_classes_from_object_expression(object, ctx, None, &[])
        }
        Expression::Identifier(identifier) => ctx
            .scope
            .resolve_initializer_before(&identifier.name, identifier.span.start, ctx.program)
            .map_or_else(Vec::new, |initializer| {
                candidate_classes_from_expression(initializer, ctx)
            }),
        Expression::ConditionalExpression(conditional) => {
            let mut classes = candidate_classes_from_expression(&conditional.consequent, ctx);
            classes.extend(candidate_classes_from_expression(
                &conditional.alternate,
                ctx,
            ));
            classes
        }
        Expression::LogicalExpression(logical) => {
            candidate_classes_from_expression(&logical.right, ctx)
        }
        Expression::ParenthesizedExpression(value) => {
            candidate_classes_from_expression(&value.expression, ctx)
        }
        Expression::TSAsExpression(value) => {
            candidate_classes_from_expression(&value.expression, ctx)
        }
        Expression::TSSatisfiesExpression(value) => {
            candidate_classes_from_expression(&value.expression, ctx)
        }
        Expression::TSNonNullExpression(value) => {
            candidate_classes_from_expression(&value.expression, ctx)
        }
        _ => Vec::new(),
    }
}

fn candidate_classes_from_object_expression(
    object: &ObjectExpression<'_>,
    ctx: ResolveContext<'_>,
    variant_prefix: Option<&str>,
    variant_keys: &[String],
) -> Vec<String> {
    if let Some(static_object) = static_object_from_object_expression(object, ctx) {
        return prefix_classes(lower_static_sz_object(&static_object), variant_prefix);
    }

    let mut classes = Vec::new();
    for property in &object.properties {
        match property {
            ObjectPropertyKind::ObjectProperty(property) => {
                if let Some(key) = static_property_key(&property.key) {
                    let val = unwrap_expression(&property.value);
                    match val {
                        Expression::ObjectExpression(nested)
                            if super::generated::tables::is_known_variant(&key)
                                || super::generated::tables::is_known_variant(
                                    super::generated::tables::variant_prefix(&key).unwrap_or(&key),
                                ) =>
                        {
                            let variant = variant_prefix_string(variant_prefix, &key);
                            let mut next_keys = variant_keys.to_vec();
                            next_keys.push(key.clone());
                            classes.extend(candidate_classes_from_object_expression(
                                nested,
                                ctx,
                                Some(variant.as_str()),
                                &next_keys,
                            ));
                        }
                        Expression::ConditionalExpression(conditional) => {
                            if let Some(consequent) =
                                static_value_from_expression(&conditional.consequent, ctx)
                            {
                                classes.extend(conditional_property_classes(
                                    &key,
                                    consequent,
                                    variant_keys,
                                ));
                            } else {
                                classes.extend(prefix_classes(
                                    candidate_classes_from_expression(&conditional.consequent, ctx),
                                    variant_prefix,
                                ));
                            }
                            if let Some(alternate) =
                                static_value_from_expression(&conditional.alternate, ctx)
                            {
                                classes.extend(conditional_property_classes(
                                    &key,
                                    alternate,
                                    variant_keys,
                                ));
                            } else {
                                classes.extend(prefix_classes(
                                    candidate_classes_from_expression(&conditional.alternate, ctx),
                                    variant_prefix,
                                ));
                            }
                        }
                        _ => {
                            if let Some(static_property) =
                                static_property_from_object_property(property, ctx)
                            {
                                let single_object = StaticSzObject {
                                    properties: vec![static_property],
                                };
                                classes.extend(prefix_classes(
                                    lower_static_sz_object(&single_object),
                                    variant_prefix,
                                ));
                            } else {
                                classes.extend(prefix_classes(
                                    candidate_classes_from_expression(val, ctx),
                                    variant_prefix,
                                ));
                            }
                        }
                    }
                }
            }
            ObjectPropertyKind::SpreadProperty(spread) => {
                if let Some(static_obj) = static_object_from_spread_argument(&spread.argument, ctx)
                {
                    classes.extend(prefix_classes(
                        lower_static_sz_object(&static_obj),
                        variant_prefix,
                    ));
                } else {
                    classes.extend(prefix_classes(
                        candidate_classes_from_expression(&spread.argument, ctx),
                        variant_prefix,
                    ));
                }
            }
        }
    }
    classes
}

fn prefix_classes(classes: Vec<String>, prefix: Option<&str>) -> Vec<String> {
    if let Some(p) = prefix {
        classes.into_iter().map(|c| format!("{p}:{c}")).collect()
    } else {
        classes
    }
}

fn candidate_classes_from_array_expression(
    array: &ArrayExpression<'_>,
    ctx: ResolveContext<'_>,
) -> Vec<String> {
    let mut classes = Vec::new();
    for element in &array.elements {
        let object = match element {
            ArrayExpressionElement::ObjectExpression(object) => {
                static_object_from_object_expression(object, ctx)
            }
            ArrayExpressionElement::Identifier(identifier) => {
                let initializer = ctx.scope.resolve_initializer_before(
                    &identifier.name,
                    identifier.span.start,
                    ctx.program,
                );
                initializer.and_then(|expr| {
                    static_object_from_expression(expr, ctx).map(|(object, _, _)| object)
                })
            }
            ArrayExpressionElement::LogicalExpression(logical) if logical.operator.is_and() => {
                static_object_candidate_from_expression(&logical.right, ctx)
            }
            _ => None,
        };
        if let Some(object) = object {
            classes.extend(lower_static_sz_object(&object));
        }
    }
    classes
}

fn static_object_candidate_from_expression(
    expression: &Expression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<StaticSzObject> {
    match expression {
        Expression::ObjectExpression(object) => static_object_from_object_expression(object, ctx),
        Expression::Identifier(identifier) => {
            let initializer = ctx.scope.resolve_initializer_before(
                &identifier.name,
                identifier.span.start,
                ctx.program,
            )?;
            static_object_from_expression(initializer, ctx).map(|(object, _, _)| object)
        }
        Expression::ParenthesizedExpression(value) => {
            static_object_candidate_from_expression(&value.expression, ctx)
        }
        Expression::TSAsExpression(value) => {
            static_object_candidate_from_expression(&value.expression, ctx)
        }
        Expression::TSSatisfiesExpression(value) => {
            static_object_candidate_from_expression(&value.expression, ctx)
        }
        Expression::TSNonNullExpression(value) => {
            static_object_candidate_from_expression(&value.expression, ctx)
        }
        _ => None,
    }
}

fn static_object_from_jsx_expression(
    expression: &JSXExpression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<(StaticSzObject, TextSpan, bool)> {
    match expression {
        JSXExpression::ObjectExpression(object) => {
            let object_ir = static_object_from_object_expression(object, ctx)?;
            let rewrites_empty_class = object_ir.is_empty();
            Some((object_ir, text_span(object.span), rewrites_empty_class))
        }
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
        Expression::ObjectExpression(object) => {
            let object_ir = static_object_from_object_expression(object, ctx)?;
            let rewrites_empty_class = object_ir.is_empty();
            Some((object_ir, text_span(object.span), rewrites_empty_class))
        }
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

fn static_object_from_argument(
    argument: &Argument<'_>,
    ctx: ResolveContext<'_>,
) -> Option<StaticSzObject> {
    match argument {
        Argument::ObjectExpression(object) => static_object_from_object_expression(object, ctx),
        Argument::Identifier(identifier) => {
            let initializer = ctx.scope.resolve_initializer_before(
                &identifier.name,
                identifier.span.start,
                ctx.program,
            )?;
            static_object_from_expression(initializer, ctx).map(|(object, _, _)| object)
        }
        Argument::ParenthesizedExpression(value) => {
            static_object_from_expression(&value.expression, ctx).map(|(object, _, _)| object)
        }
        Argument::TSAsExpression(value) => {
            static_object_from_expression(&value.expression, ctx).map(|(object, _, _)| object)
        }
        Argument::TSSatisfiesExpression(value) => {
            static_object_from_expression(&value.expression, ctx).map(|(object, _, _)| object)
        }
        Argument::TSNonNullExpression(value) => {
            static_object_from_expression(&value.expression, ctx).map(|(object, _, _)| object)
        }
        _ => None,
    }
}

struct PartialSzObject {
    object: StaticSzObject,
    dynamic_css_vars: Vec<DynamicCssVarIr>,
    ternary: Option<StaticTernaryIr>,
}

fn partial_object_from_jsx_expression(
    expression: &JSXExpression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<(
    StaticSzObject,
    TextSpan,
    Vec<DynamicCssVarIr>,
    Option<StaticTernaryIr>,
)> {
    match expression {
        JSXExpression::ObjectExpression(object) => {
            let partial = partial_object_from_object_expression(object, ctx, None, &[])?;
            if partial.dynamic_css_vars.is_empty() && partial.ternary.is_none() {
                return None;
            }
            Some((
                partial.object,
                text_span(object.span),
                partial.dynamic_css_vars,
                partial.ternary,
            ))
        }
        JSXExpression::TSAsExpression(value) => {
            partial_object_from_expression(&value.expression, ctx)
        }
        JSXExpression::TSSatisfiesExpression(value) => {
            partial_object_from_expression(&value.expression, ctx)
        }
        JSXExpression::TSNonNullExpression(value) => {
            partial_object_from_expression(&value.expression, ctx)
        }
        JSXExpression::ParenthesizedExpression(parenthesized) => {
            partial_object_from_expression(&parenthesized.expression, ctx)
        }
        _ => None,
    }
}

fn partial_object_from_expression(
    expression: &Expression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<(
    StaticSzObject,
    TextSpan,
    Vec<DynamicCssVarIr>,
    Option<StaticTernaryIr>,
)> {
    match expression {
        Expression::ObjectExpression(object) => {
            let partial = partial_object_from_object_expression(object, ctx, None, &[])?;
            if partial.dynamic_css_vars.is_empty() && partial.ternary.is_none() {
                return None;
            }
            Some((
                partial.object,
                text_span(object.span),
                partial.dynamic_css_vars,
                partial.ternary,
            ))
        }
        Expression::ParenthesizedExpression(value) => {
            partial_object_from_expression(&value.expression, ctx)
        }
        Expression::TSAsExpression(value) => partial_object_from_expression(&value.expression, ctx),
        Expression::TSSatisfiesExpression(value) => {
            partial_object_from_expression(&value.expression, ctx)
        }
        Expression::TSNonNullExpression(value) => {
            partial_object_from_expression(&value.expression, ctx)
        }
        _ => None,
    }
}

fn partial_object_from_object_expression(
    object: &ObjectExpression<'_>,
    ctx: ResolveContext<'_>,
    variant_prefix: Option<&str>,
    variant_keys: &[String],
) -> Option<PartialSzObject> {
    if variant_prefix.is_none() {
        if let Some(ternary) = conditional_spread_ternary_from_object_expression(object, ctx) {
            return Some(PartialSzObject {
                object: StaticSzObject::empty(),
                dynamic_css_vars: Vec::new(),
                ternary: Some(ternary),
            });
        }
    }

    let mut properties = Vec::with_capacity(object.properties.len());
    let mut dynamic_css_vars = Vec::new();
    let mut ternary = None;

    for property in &object.properties {
        match property {
            ObjectPropertyKind::ObjectProperty(property) => {
                if is_skippable_static_value(&property.value) {
                    continue;
                }
                if let Some(static_property) = static_property_from_object_property(property, ctx) {
                    properties.push(static_property);
                    continue;
                }

                let key = static_property_key(&property.key)?;
                if let Expression::ObjectExpression(nested) = &property.value {
                    if let Some(color_opacity_ternary) =
                        color_opacity_ternary_from_object(&key, nested, ctx, variant_keys)
                    {
                        if ternary.is_some() {
                            return None;
                        }
                        ternary = Some(color_opacity_ternary);
                        continue;
                    }
                    // A property whose value is an object (color+opacity, gradient,
                    // arbitrary `css`, mask, …) is a value object, not variant
                    // nesting. A fully static one was already captured above, so if
                    // it reached here it carries a dynamic sub-field the static
                    // composers do not cover. Recursing would prefix the sub-key with
                    // the property name and emit a dead `<property>:<subkey>` class
                    // (e.g. `bg:op-(--var)`, `css:text-red`, `bgImg:dir-to-r`). Punt
                    // the whole attribute to the runtime instead, which resolves the
                    // dynamic value correctly. Variant keys (hover, md, supports, …)
                    // are absent from the property map and still nest normally.
                    if super::generated::tables::property_prefix(&key).is_some() || key == "css" {
                        return None;
                    }
                    let variant = variant_prefix_string(variant_prefix, &key);
                    let mut next_keys = variant_keys.to_vec();
                    next_keys.push(key.clone());
                    let nested = partial_object_from_object_expression(
                        nested,
                        ctx,
                        Some(variant.as_str()),
                        &next_keys,
                    )?;
                    if !nested.object.is_empty() {
                        properties.push(StaticSzProperty {
                            key,
                            span: text_span(property.span),
                            value: StaticSzValue::Object(nested.object),
                        });
                    }
                    dynamic_css_vars.extend(nested.dynamic_css_vars);
                    if nested.ternary.is_some() {
                        if ternary.is_some() {
                            return None;
                        }
                        ternary = nested.ternary;
                    }
                    continue;
                }

                if let Expression::ConditionalExpression(conditional) = &property.value {
                    if let Some((conditional_ternary, dynamic_prop)) =
                        nullable_conditional_class_from_property(
                            &key,
                            conditional,
                            ctx,
                            variant_prefix,
                            variant_keys,
                        )
                    {
                        if ternary.is_some() {
                            return None;
                        }
                        ternary = Some(conditional_ternary);
                        if let Some(dynamic_prop) = dynamic_prop {
                            dynamic_css_vars.push(dynamic_prop);
                        }
                        continue;
                    }
                    if let Some(conditional_ternary) =
                        conditional_class_from_property(&key, conditional, ctx, variant_keys)
                    {
                        if ternary.is_some() {
                            return None;
                        }
                        ternary = Some(conditional_ternary);
                        continue;
                    }
                }

                if !is_runtime_expression(&property.value) {
                    return None;
                }
                // Slice the UNWRAPPED expression span: `sz={{ p: (pad) }}` must
                // emit `calc(${pad} …)` like the JS engines, not `calc(${(pad)} …)`
                // — redundant parens broke rust==oxc byte parity.
                dynamic_css_vars.push(dynamic_css_var_from_property(
                    &key,
                    text_span(unwrap_expression(&property.value).span()),
                    variant_prefix,
                ));
            }
            ObjectPropertyKind::SpreadProperty(spread) => {
                properties
                    .extend(static_object_from_spread_argument(&spread.argument, ctx)?.properties);
            }
        }
    }

    // A single conditional prop may coexist with static properties (e.g.
    // `{ ...CONST, scale: cond ? 75 : 100 }`): the static part lowers to literal
    // classes and the conditional becomes a runtime ternary appended in a
    // template literal, matching the Babel/oxc build-time output. Mixing a
    // conditional with runtime css vars is still punted to the runtime.
    if ternary.is_some() && dynamic_css_vars.iter().any(|prop| !prop.skip_class) {
        return None;
    }

    Some(PartialSzObject {
        object: StaticSzObject { properties },
        dynamic_css_vars,
        ternary,
    })
}

fn conditional_spread_ternary_from_object_expression(
    object: &ObjectExpression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<StaticTernaryIr> {
    let mut conditional = None;
    let mut other_properties = Vec::new();

    for property in &object.properties {
        match property {
            ObjectPropertyKind::SpreadProperty(spread) => {
                let Expression::ConditionalExpression(next_conditional) =
                    unwrap_expression(&spread.argument)
                else {
                    return None;
                };
                if conditional.is_some() {
                    return None;
                }
                conditional = Some(next_conditional);
            }
            ObjectPropertyKind::ObjectProperty(property) => {
                other_properties.push(static_property_from_object_property(property, ctx)?);
            }
        }
    }

    let conditional = conditional?;
    let consequent =
        conditional_spread_branch_classes(&conditional.consequent, &other_properties, ctx)?;
    let alternate =
        conditional_spread_branch_classes(&conditional.alternate, &other_properties, ctx)?;
    Some(StaticTernaryIr {
        test_span: text_span(conditional.test.span()),
        consequent_classes: consequent,
        alternate_classes: alternate,
    })
}

fn conditional_spread_branch_classes(
    branch: &Expression<'_>,
    other_properties: &[StaticSzProperty],
    ctx: ResolveContext<'_>,
) -> Option<Vec<String>> {
    let (mut object, _, _) = static_object_from_expression(branch, ctx)?;
    object.properties.extend(other_properties.iter().cloned());
    Some(lower_static_sz_object(&object))
}

fn unwrap_expression<'a>(expression: &'a Expression<'a>) -> &'a Expression<'a> {
    match expression {
        Expression::ParenthesizedExpression(value) => unwrap_expression(&value.expression),
        Expression::TSAsExpression(value) => unwrap_expression(&value.expression),
        Expression::TSSatisfiesExpression(value) => unwrap_expression(&value.expression),
        Expression::TSNonNullExpression(value) => unwrap_expression(&value.expression),
        _ => expression,
    }
}

fn conditional_class_from_property(
    key: &str,
    conditional: &ConditionalExpression<'_>,
    ctx: ResolveContext<'_>,
    variant_keys: &[String],
) -> Option<StaticTernaryIr> {
    let consequent = static_value_from_expression(&conditional.consequent, ctx)?;
    let alternate = static_value_from_expression(&conditional.alternate, ctx)?;
    Some(StaticTernaryIr {
        test_span: text_span(conditional.test.span()),
        consequent_classes: conditional_property_classes(key, consequent, variant_keys),
        alternate_classes: conditional_property_classes(key, alternate, variant_keys),
    })
}

fn nullable_conditional_class_from_property(
    key: &str,
    conditional: &ConditionalExpression<'_>,
    ctx: ResolveContext<'_>,
    variant_prefix: Option<&str>,
    variant_keys: &[String],
) -> Option<(StaticTernaryIr, Option<DynamicCssVarIr>)> {
    let consequent_absent = is_absent_sz_expression(&conditional.consequent);
    let alternate_absent = is_absent_sz_expression(&conditional.alternate);
    if !consequent_absent && !alternate_absent {
        return None;
    }
    if consequent_absent && alternate_absent {
        return Some((
            StaticTernaryIr {
                test_span: text_span(conditional.test.span()),
                consequent_classes: Vec::new(),
                alternate_classes: Vec::new(),
            },
            None,
        ));
    }

    let present = if consequent_absent {
        &conditional.alternate
    } else {
        &conditional.consequent
    };
    let (present_classes, dynamic_prop) =
        if let Some(value) = static_value_from_expression(present, ctx) {
            (conditional_property_classes(key, value, variant_keys), None)
        } else {
            if !is_runtime_expression(present) {
                return None;
            }
            let mut prop =
                dynamic_css_var_from_property(key, text_span(conditional.span), variant_prefix);
            prop.skip_class = true;
            (vec![dynamic_css_var_class(&prop)], Some(prop))
        };
    Some((
        StaticTernaryIr {
            test_span: text_span(conditional.test.span()),
            consequent_classes: if consequent_absent {
                Vec::new()
            } else {
                present_classes.clone()
            },
            alternate_classes: if alternate_absent {
                Vec::new()
            } else {
                present_classes
            },
        },
        dynamic_prop,
    ))
}

fn is_absent_sz_expression(expression: &Expression<'_>) -> bool {
    match unwrap_expression(expression) {
        Expression::NullLiteral(_) => true,
        Expression::Identifier(identifier) => identifier.name == "undefined",
        Expression::BooleanLiteral(value) => !value.value,
        Expression::StringLiteral(value) => value.value.is_empty(),
        _ => false,
    }
}

/// Wraps a leaf object in the given variant-key chain (outer→inner) so the full
/// nesting lowers through `lower_object_into`, which knows the parametric/attachment
/// joins (`group-hover:`, `peer-hover:`, `has-[:checked]:`, `data-[active]:`, …) that
/// a flat `{prefix}:{class}` prepend gets wrong (it emitted `group:hover:…`).
fn wrap_in_variant_keys(variant_keys: &[String], leaf: StaticSzObject) -> StaticSzObject {
    let mut current = leaf;
    for key in variant_keys.iter().rev() {
        current = StaticSzObject {
            properties: vec![StaticSzProperty {
                key: key.clone(),
                span: TextSpan { start: 0, end: 0 },
                value: StaticSzValue::Object(current),
            }],
        };
    }
    current
}

fn conditional_property_classes(
    key: &str,
    value: StaticSzValue,
    variant_keys: &[String],
) -> Vec<String> {
    let leaf = StaticSzObject {
        properties: vec![StaticSzProperty {
            key: key.to_string(),
            span: TextSpan { start: 0, end: 0 },
            value,
        }],
    };
    lower_static_sz_object(&wrap_in_variant_keys(variant_keys, leaf))
}

/// Detects a color-opacity sub-object whose `op` is a ternary, e.g.
/// `{ color: 'black', op: cond ? 30 : 100 }` under a color-capable parent key.
/// Each branch is lowered into a complete color-opacity class (`bg-black/30`,
/// `bg-black/100`) — the same output the object-level ternary produces —
/// instead of the dead `bg:op-30` form a bare sub-property ternary emits.
fn color_opacity_ternary_from_object(
    parent_key: &str,
    object: &ObjectExpression<'_>,
    ctx: ResolveContext<'_>,
    variant_keys: &[String],
) -> Option<StaticTernaryIr> {
    super::generated::tables::property_prefix(parent_key)?;

    // Capture `color` and `op`, each as either a static value or a ternary.
    let mut static_color: Option<String> = None;
    let mut color_conditional: Option<&ConditionalExpression<'_>> = None;
    let mut static_op: Option<StaticSzValue> = None;
    let mut op_conditional: Option<&ConditionalExpression<'_>> = None;

    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(prop) = property else {
            return None;
        };
        if prop.method || prop.computed || prop.shorthand {
            return None;
        }
        match static_property_key(&prop.key)?.as_str() {
            "color" => {
                if let Expression::ConditionalExpression(conditional) =
                    unwrap_expression(&prop.value)
                {
                    color_conditional = Some(conditional);
                } else {
                    let StaticSzValue::String(value) =
                        static_value_from_expression(&prop.value, ctx)?
                    else {
                        return None;
                    };
                    static_color = Some(value);
                }
            }
            "op" => {
                if let Expression::ConditionalExpression(conditional) =
                    unwrap_expression(&prop.value)
                {
                    op_conditional = Some(conditional);
                } else {
                    static_op = Some(static_value_from_expression(&prop.value, ctx)?);
                }
            }
            // Any other member means this is not a plain color-opacity object;
            // leave it to the normal nesting path.
            _ => return None,
        }
    }

    // Exactly one of `color`/`op` may be the ternary; the other (and any
    // sibling) must be static. Both static is a normal static object, and both
    // dynamic falls back to the runtime helper — neither belongs here.
    match (color_conditional, op_conditional) {
        (None, Some(conditional)) => {
            let color = static_color?;
            let consequent = static_value_from_expression(&conditional.consequent, ctx)?;
            let alternate = static_value_from_expression(&conditional.alternate, ctx)?;
            Some(StaticTernaryIr {
                test_span: text_span(conditional.test.span()),
                consequent_classes: color_opacity_branch_classes(
                    parent_key,
                    &color,
                    Some(consequent),
                    variant_keys,
                ),
                alternate_classes: color_opacity_branch_classes(
                    parent_key,
                    &color,
                    Some(alternate),
                    variant_keys,
                ),
            })
        }
        (Some(conditional), None) => {
            let StaticSzValue::String(consequent) =
                static_value_from_expression(&conditional.consequent, ctx)?
            else {
                return None;
            };
            let StaticSzValue::String(alternate) =
                static_value_from_expression(&conditional.alternate, ctx)?
            else {
                return None;
            };
            Some(StaticTernaryIr {
                test_span: text_span(conditional.test.span()),
                consequent_classes: color_opacity_branch_classes(
                    parent_key,
                    &consequent,
                    static_op.clone(),
                    variant_keys,
                ),
                alternate_classes: color_opacity_branch_classes(
                    parent_key,
                    &alternate,
                    static_op,
                    variant_keys,
                ),
            })
        }
        _ => None,
    }
}

/// Lowers one branch of a color-opacity ternary into its complete class,
/// e.g. `(bg, black, 30)` -> `bg-black/30`, applying any variant prefix.
/// `op` is optional so a ternary on `color` alone (`{ color: c ? a : b }`)
/// lowers to bare `bg-a` / `bg-b`.
fn color_opacity_branch_classes(
    parent_key: &str,
    color: &str,
    op: Option<StaticSzValue>,
    variant_keys: &[String],
) -> Vec<String> {
    let mut properties = vec![StaticSzProperty {
        key: "color".to_string(),
        span: TextSpan { start: 0, end: 0 },
        value: StaticSzValue::String(color.to_string()),
    }];
    if let Some(op) = op {
        properties.push(StaticSzProperty {
            key: "op".to_string(),
            span: TextSpan { start: 0, end: 0 },
            value: op,
        });
    }
    let nested = StaticSzObject { properties };
    let leaf = StaticSzObject {
        properties: vec![StaticSzProperty {
            key: parent_key.to_string(),
            span: TextSpan { start: 0, end: 0 },
            value: StaticSzValue::Object(nested),
        }],
    };
    lower_static_sz_object(&wrap_in_variant_keys(variant_keys, leaf))
}

fn dynamic_css_var_from_property(
    key: &str,
    expression_span: TextSpan,
    variant_prefix: Option<&str>,
) -> DynamicCssVarIr {
    DynamicCssVarIr {
        key: key.to_string(),
        class_prefix: super::generated::tables::property_prefix(key)
            .unwrap_or(key)
            .to_string(),
        var_name: css_variable_name(key, variant_prefix),
        category: dynamic_css_var_category(key),
        expression_span,
        variant_prefix: variant_prefix.map(ToString::to_string),
        hoisted: false,
        skip_class: false,
    }
}

fn variant_prefix_string(current: Option<&str>, key: &str) -> String {
    let variant = super::generated::tables::variant_prefix(key).unwrap_or(key);
    current.map_or_else(
        || variant.to_string(),
        |prefix| format!("{prefix}:{variant}"),
    )
}

fn css_variable_name(key: &str, variant_prefix: Option<&str>) -> String {
    let prop = kebab_case(key);
    variant_prefix.map_or_else(
        || format!("--_sz-{prop}"),
        |prefix| format!("--_sz-{}-{prop}", prefix.replace(':', "-")),
    )
}

fn kebab_case(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for (index, ch) in value.chars().enumerate() {
        if ch.is_ascii_uppercase() {
            if index > 0 {
                out.push('-');
            }
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

fn dynamic_css_var_category(key: &str) -> DynamicCssVarCategory {
    match key {
        "p" | "pt" | "pr" | "pb" | "pl" | "px" | "py" | "ps" | "pe" | "pbs" | "pbe" | "m"
        | "mt" | "mr" | "mb" | "ml" | "mx" | "my" | "ms" | "me" | "mbs" | "mbe" | "spaceX"
        | "spaceY" | "gap" | "gapX" | "gapY" | "inset" | "insetX" | "insetY" | "top" | "right"
        | "bottom" | "left" | "start" | "end" | "insetS" | "insetE" | "insetBs" | "insetBe"
        | "w" | "minW" | "maxW" | "h" | "minH" | "maxH" | "size" | "blockSize" | "minBlockSize"
        | "maxBlockSize" | "inlineSize" | "minInlineSize" | "maxInlineSize" | "basis"
        | "indent" | "scrollM" | "scrollMt" | "scrollMr" | "scrollMb" | "scrollMl" | "scrollMs"
        | "scrollMe" | "scrollMx" | "scrollMy" | "scrollP" | "scrollPt" | "scrollPr"
        | "scrollPb" | "scrollPl" | "scrollPs" | "scrollPe" | "scrollPx" | "scrollPy"
        | "scrollPbs" | "scrollPbe" | "scrollMbs" | "scrollMbe" | "translateX" | "translateY"
        | "borderSpacing" | "borderSpacingX" | "borderSpacingY" | "outlineOffset"
        | "ringOffset" | "underlineOffset" => DynamicCssVarCategory::Spacing,
        "bg" | "color" | "borderColor" | "divideColor" | "outlineColor" | "ringColor"
        | "ringOffsetColor" | "shadowColor" | "textShadowColor" | "decorationColor" | "accent"
        | "caret" | "fill" | "stroke" | "from" | "via" | "to" | "dropShadowColor" => {
            DynamicCssVarCategory::Color
        }
        "rotate" | "skewX" | "skewY" => DynamicCssVarCategory::Angle,
        "duration" | "delay" | "animationDelay" => DynamicCssVarCategory::Duration,
        _ => DynamicCssVarCategory::Passthrough,
    }
}

const fn is_runtime_expression(expression: &Expression<'_>) -> bool {
    !matches!(
        expression,
        Expression::ObjectExpression(_)
            | Expression::ArrayExpression(_)
            | Expression::FunctionExpression(_)
            | Expression::ArrowFunctionExpression(_)
    )
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
                merge_static_property(
                    &mut properties,
                    static_property_from_object_property(property, ctx)?,
                );
            }
            ObjectPropertyKind::SpreadProperty(spread) => {
                merge_static_properties(
                    &mut properties,
                    static_object_from_spread_argument(&spread.argument, ctx)?.properties,
                );
            }
        }
    }

    Some(StaticSzObject { properties })
}

fn merge_static_properties(
    properties: &mut Vec<StaticSzProperty>,
    incoming: impl IntoIterator<Item = StaticSzProperty>,
) {
    for property in incoming {
        merge_static_property(properties, property);
    }
}

fn merge_static_property(properties: &mut Vec<StaticSzProperty>, incoming: StaticSzProperty) {
    if let Some(existing) = properties
        .iter_mut()
        .find(|property| property.key == incoming.key)
    {
        *existing = incoming;
    } else {
        properties.push(incoming);
    }
}

/// Deep merge for sz ARRAY composition (`sz={[a, b]}` = later wins): a later
/// leaf value replaces an earlier one at the same key path, while sibling keys
/// survive — the build-time mirror of `szcn`'s class-level group merge.
/// Deliberately separate from [`merge_static_property`], which keeps JS
/// object-spread (shallow) semantics for spreads inside ONE object literal.
fn merge_static_properties_deep(
    properties: &mut Vec<StaticSzProperty>,
    incoming: impl IntoIterator<Item = StaticSzProperty>,
) {
    for property in incoming {
        merge_static_property_deep(properties, property);
    }
}

fn merge_static_property_deep(properties: &mut Vec<StaticSzProperty>, incoming: StaticSzProperty) {
    if let Some(existing) = properties
        .iter_mut()
        .find(|property| property.key == incoming.key)
    {
        match (&mut existing.value, incoming.value) {
            (StaticSzValue::Object(existing_object), StaticSzValue::Object(incoming_object)) => {
                merge_static_properties_deep(
                    &mut existing_object.properties,
                    incoming_object.properties,
                );
            }
            (existing_value, incoming_value) => *existing_value = incoming_value,
        }
    } else {
        properties.push(incoming);
    }
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

/// Resolve an sz array ELEMENT to a static object for the deep-merge lane:
/// an object literal, or an identifier whose initializer unwraps to one.
/// Object-only on purpose — anything else (strings, conditions, dynamics)
/// belongs to the szcn parts lane, matching the JS engines' classification.
fn array_element_static_object(
    expression: &Expression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<StaticSzObject> {
    match unwrap_expression(expression) {
        Expression::ObjectExpression(object) => static_object_from_object_expression(object, ctx),
        Expression::Identifier(identifier) => {
            let initializer = ctx.scope.resolve_initializer_before(
                &identifier.name,
                identifier.span.start,
                ctx.program,
            )?;
            match unwrap_expression(initializer) {
                Expression::ObjectExpression(object) => {
                    static_object_from_object_expression(object, ctx)
                }
                _ => None,
            }
        }
        _ => None,
    }
}

/// Whether an unwrapped array element is a skippable falsy guard.
fn is_falsy_array_element(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::BooleanLiteral(value) => !value.value,
        Expression::NullLiteral(_) => true,
        Expression::Identifier(identifier) => identifier.name == "undefined",
        _ => false,
    }
}

fn static_object_from_array_expression(
    array: &ArrayExpression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<StaticSzObject> {
    let mut properties = Vec::new();

    for element in &array.elements {
        if matches!(element, ArrayExpressionElement::Elision(_)) {
            continue;
        }
        // A spread element keeps the whole array a runtime value.
        let expression = element.as_expression()?;
        let unwrapped = unwrap_expression(expression);
        if is_falsy_array_element(unwrapped) {
            continue;
        }
        // Deep merge (later leaf wins per key path, sibling keys survive):
        // sz array composition is LATER WINS, mirroring szcn's class-level
        // group merge — not JS spread's shallow replace.
        merge_static_properties_deep(
            &mut properties,
            array_element_static_object(unwrapped, ctx)?.properties,
        );
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
        PropertyKey::NumericLiteral(number) => Some(number.value.to_string()),
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
    fn parser_shell_extracts_static_dynamic_call_classes() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "import { dynamic } from '@csszyx/dynamic'; const App = () => <div className={dynamic({ p: 4, rounded: 'md' })} />;".to_string(),
        };

        let parsed = parse_source_shell(&file);
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty());
        assert_eq!(lowered.classes, ["p-4", "rounded-md"]);
    }

    #[test]
    fn parser_shell_extracts_identifier_dynamic_call_classes() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "import { dynamic } from '@csszyx/dynamic'; const boxStyles = { w: 7, h: 8, rounded: 'sm' } as const; const App = () => <div className={dynamic(boxStyles as any)} />;".to_string(),
        };

        let parsed = parse_source_shell(&file);
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty());
        assert_eq!(lowered.classes, ["w-7", "h-8", "rounded-sm"]);
    }

    #[test]
    fn parser_shell_extracts_static_szv_catalog_classes() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "import { szv } from '@csszyx/runtime'; const box = szv({ base: { text: 'xs', leading: 'none' }, variants: { size: { sm: { p: 4 }, lg: { p: 8 } } } });".to_string(),
        };

        let parsed = parse_source_shell(&file);
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty());
        assert_eq!(lowered.classes, ["text-xs/none", "p-4", "p-8"]);
    }

    #[test]
    fn szv_catalog_is_per_key_lenient_and_expands_conditional_branches() {
        // One unreadable leaf (a call) skips ONLY its key; a finite conditional
        // contributes BOTH branches; sibling variants always survive. Matches
        // the oxc/Babel lenient catalog walk (locked by the TS parity suite
        // `szv-catalog-leniency.test.ts`).
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "import { szv } from '@csszyx/runtime'; declare const dense: boolean; declare function calc(): number; const s = szv({ variants: { layout: { a: { grow: 1, w: calc(), p: dense ? 2 : 4, my: 4 }, b: { m: 4 } } } });".to_string(),
        };

        let parsed = parse_source_shell(&file);
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert_eq!(lowered.classes, ["grow-1", "p-2", "my-4", "p-4", "m-4"]);
    }

    #[test]
    fn szv_catalog_const_doubling_chain_stays_linear() {
        // Exponential guard: `const xN = c ? xN-1 : xN-1` doubles the candidate
        // list per level without consuming depth (conditionals and identifier
        // hops keep `depth` unchanged by design). Before the expansion-point
        // truncation this walk built 2^n intermediate objects — ~10s at n=22,
        // OOM at n=30 — from a ~30-line source file. With the cap the walk is
        // linear; a wall-clock bound would be flaky on CI, so the budget bound
        // plus instant completion at n=40 (2^40 uncapped = unreachable) is the
        // regression signal.
        use std::fmt::Write as _;
        let mut source = String::from(
            "import { szv } from '@csszyx/runtime'; declare const c: boolean; const x0 = c ? 'red-500' : 'blue-500';",
        );
        for i in 1..=40 {
            // Conditional doubling: both branches re-reference the same const.
            let _ = write!(source, "const x{i} = c ? x{} : x{};", i - 1, i - 1);
        }
        // Spread doubling and sibling-key doubling take the identifier-memo
        // path with no conditional at all — explores alone cannot gate them.
        source.push_str("const y0 = { p: 4 };");
        for i in 1..=40 {
            let _ = write!(source, "const y{i} = {{ ...y{}, ...y{} }};", i - 1, i - 1);
        }
        source.push_str("const z0 = { m: 2 };");
        for i in 1..=40 {
            let _ = write!(
                source,
                "const z{i} = {{ hover: z{}, focus: z{} }};",
                i - 1,
                i - 1
            );
        }
        source.push_str(
            "const s = szv({ variants: { tone: { a: { color: x40 }, b: y40, c: z40 } } });",
        );

        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source,
        };

        let parsed = parse_source_shell(&file);
        let lowered = lower_source_ir_classes(&parsed.ir);

        // Both original branch values survive; the capped duplicates dedupe.
        assert!(lowered.classes.contains(&"text-red-500".to_string()));
        assert!(lowered.classes.contains(&"text-blue-500".to_string()));
    }

    #[test]
    fn szv_catalog_resolves_const_scalar_refs_and_skips_null_undefined() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "import { szv } from '@csszyx/runtime'; const GUTTER = 0; const s = szv({ variants: { layout: { a: { grow: 1, mx: GUTTER, mt: null, mb: undefined, my: 4 } } } });".to_string(),
        };

        let parsed = parse_source_shell(&file);
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert_eq!(lowered.classes, ["grow-1", "mx-0", "my-4"]);
    }

    #[test]
    fn szv_catalog_keeps_variant_prefix_on_alternate_branches() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "import { szv } from '@csszyx/runtime'; declare const dense: boolean; const s = szv({ variants: { tone: { hot: { hover: { mx: dense ? 0 : 2 }, bg: 'red-500' } } } });".to_string(),
        };

        let parsed = parse_source_shell(&file);
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert_eq!(lowered.classes, ["hover:mx-0", "bg-red-500", "hover:mx-2"]);
    }

    #[test]
    fn parser_shell_extracts_numeric_szv_variant_keys() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "import { szv } from '@csszyx/runtime'; const box = szv({ base: { minH: 2 }, variants: { idx: { 0: { opacity: 50 }, 1: { opacity: 70 } } } });".to_string(),
        };

        let parsed = parse_source_shell(&file);
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty());
        assert_eq!(lowered.classes, ["min-h-2", "opacity-50", "opacity-70"]);
    }

    #[test]
    fn parser_shell_extracts_szv_with_non_static_sibling_key() {
        // A `compoundVariants` array (or any non-static sibling) must NOT drop the
        // base/variants catalog — it is skipped, the variant classes still extract.
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "import { szv } from '@csszyx/runtime'; const box = szv({ base: { rounded: 'md' }, variants: { tone: { ok: { bg: 'success' } } }, compoundVariants: [{ tone: 'ok', sz: { p: 4 } }] });".to_string(),
        };

        let parsed = parse_source_shell(&file);
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty());
        // base (rounded-md) + base∪variant (rounded-md bg-success). compoundVariants ignored.
        assert!(lowered.classes.contains(&"rounded-md".to_string()));
        assert!(lowered.classes.contains(&"bg-success".to_string()));
    }

    #[test]
    fn parser_shell_extracts_szv_dis_value_cases() {
        // szv lowers "dị" variant/important/negative/arbitrary/css-var values in
        // the catalog directly — these must match the same shapes the JS engines
        // emit (the Babel/oxc szv-extraction parity suite locks the JS side).
        let cases: &[(&str, &str)] = &[
            (
                "{ variants: { s: { x: { hover: { bg: 'red-500' } } } } }",
                "hover:bg-red-500",
            ),
            ("{ variants: { s: { x: { md: { p: 8 } } } } }", "md:p-8"),
            (
                "{ variants: { s: { x: { group: { hover: { gap: 8 } } } } } }",
                "group-hover:gap-8",
            ),
            (
                "{ variants: { s: { x: { data: { 'state=open': { gap: 8 } } } } } }",
                "data-[state=open]:gap-8",
            ),
            ("{ variants: { s: { x: { p: '8!' } } } }", "p-8!"),
            ("{ variants: { s: { x: { mt: -2 } } } }", "-mt-2"),
            ("{ variants: { s: { x: { w: '[400px]' } } } }", "w-[400px]"),
            (
                "{ variants: { s: { x: { bg: { color: 'warning', op: 10 } } } } }",
                "bg-warning/10",
            ),
            (
                "{ variants: { s: { x: { color: '--ds-primary' } } } }",
                "text-(--ds-primary)",
            ),
        ];

        for (config, expected) in cases {
            let file = TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source: format!(
                    "import {{ szv }} from '@csszyx/runtime'; const b = szv({config});"
                ),
            };
            let parsed = parse_source_shell(&file);
            let lowered = lower_source_ir_classes(&parsed.ir);
            assert!(
                lowered.classes.contains(&expected.to_string()),
                "szv config {config} should emit {expected}, got {:?}",
                lowered.classes
            );
        }
    }

    #[test]
    fn parser_shell_extracts_szv_from_const_bindings() {
        // Option C: resolve a `const` identifier bound to an object literal — the
        // whole config (`szv(cfg)`) and inner base/variants (`{ variants: V }`).
        let resolves: &[(&str, &str)] = &[
            (
                "const cfg = { base: { rounded: 'md' }, variants: { s: { x: { p: 4 } } } }; const b = szv(cfg);",
                "rounded-md",
            ),
            (
                "const V = { s: { x: { p: 4 } } }; const b = szv({ base: { m: 2 }, variants: V });",
                "p-4",
            ),
            (
                "const B = { rounded: 'md' }; const b = szv({ base: B, variants: { s: { x: { p: 4 } } } });",
                "rounded-md",
            ),
        ];
        for (source, expected) in resolves {
            let file = TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source: format!("import {{ szv }} from '@csszyx/runtime'; {source}"),
            };
            let parsed = parse_source_shell(&file);
            let lowered = lower_source_ir_classes(&parsed.ir);
            assert!(
                lowered.classes.contains(&expected.to_string()),
                "{source} should resolve and emit {expected}, got {:?}",
                lowered.classes
            );
        }
    }

    #[test]
    fn parser_shell_does_not_resolve_reassigned_let_in_szv() {
        // Guard: a reassigned `let` must NOT be followed — its later value is not
        // statically known, so resolving the first object literal would be wrong.
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "import { szv } from '@csszyx/runtime'; let cfg = { variants: { s: { x: { p: 4 } } } }; cfg = { variants: { s: { x: { m: 9 } } } }; const b = szv(cfg);".to_string(),
        };
        let parsed = parse_source_shell(&file);
        let lowered = lower_source_ir_classes(&parsed.ir);
        assert!(
            !lowered.classes.contains(&"p-4".to_string()),
            "a reassigned let must not resolve to its first value, got {:?}",
            lowered.classes
        );
    }

    #[test]
    fn parser_shell_precompiles_conditional_array_parts() {
        let source =
            "const base = { p: 4 }; const App = ({ active }) => <div sz={[base, active && { m: 2 }]} />;";
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        };

        let parsed = parse_source_shell(&file);
        let attribute = &parsed.ir.sz_attributes[0];

        assert!(!attribute.runtime_fallback);
        assert_eq!(attribute.array_parts.len(), 2);
        assert_eq!(attribute.array_parts[0].classes, ["p-4"]);
        assert_eq!(attribute.array_parts[1].classes, ["m-2"]);
        let condition = attribute.array_parts[1]
            .condition_span
            .expect("conditional array part");
        assert_eq!(
            &source[condition.start as usize..condition.end as usize],
            "active"
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
                "export const App = () => <div className=\"block\" sz={{ start: 4, display: 'inline-block' }} />;"
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
        assert_eq!(parsed.ir.jsx_opening_elements.len(), 3);
        assert_eq!(parsed.ir.jsx_opening_elements[0].element_name, "<>");
        assert_eq!(parsed.ir.jsx_opening_elements[0].parent_element_index, None);
        assert!(!parsed.ir.jsx_opening_elements[0].can_host_style);
        assert_eq!(parsed.ir.jsx_opening_elements[1].sz_attribute_indices, [0]);
        assert_eq!(parsed.ir.jsx_opening_elements[1].element_name, "div");
        assert_eq!(
            parsed.ir.jsx_opening_elements[1].parent_element_index,
            Some(0)
        );
        assert!(parsed.ir.jsx_opening_elements[1].can_host_style);
        assert_eq!(
            parsed.ir.jsx_opening_elements[1].class_attribute_index,
            Some(0)
        );
        assert_eq!(
            parsed.ir.jsx_opening_elements[1].recovery_attribute_index,
            None
        );
        assert!(!parsed.ir.jsx_opening_elements[1].has_recovery_token_attribute);
        assert!(parsed.ir.jsx_opening_elements[1]
            .last_attribute_end
            .is_some());
        assert_eq!(parsed.ir.jsx_opening_elements[2].sz_attribute_indices, [1]);
        assert_eq!(parsed.ir.jsx_opening_elements[2].element_name, "span");
        assert_eq!(
            parsed.ir.jsx_opening_elements[2].parent_element_index,
            Some(0)
        );
        assert_eq!(
            parsed.ir.jsx_opening_elements[2].class_attribute_index,
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
                "export const App = () => <div sz={[{ display: 'flex' }, false, null, { p: 4 }]} />;"
                    .to_string(),
        };

        let parsed = parse_source_shell(&file);
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty());
        assert_eq!(lowered.classes, ["flex", "p-4"]);
        assert_eq!(parsed.ir.sz_attributes[0].object.properties.len(), 2);
    }

    #[test]
    fn parser_shell_lowers_identifier_static_array_elements() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const base = { p: 4, rounded: 'lg' }; const App = () => <div sz={[base, { bg: 'blue-500' }]} />;".to_string(),
        };

        let parsed = parse_source_shell(&file);
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty());
        assert!(!parsed.ir.sz_attributes[0].runtime_fallback);
        assert_eq!(lowered.classes, ["p-4", "rounded-lg", "bg-blue-500"]);
    }

    #[test]
    fn parser_shell_collects_runtime_array_candidate_classes() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const base = { p: 4, rounded: 'md' }; const App = ({ active }) => <div sz={[{ ...base }, active && { bg: 'blue-500' }]} />;".to_string(),
        };

        let parsed = parse_source_shell(&file);
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty());
        assert!(!parsed.ir.sz_attributes[0].runtime_fallback);
        assert_eq!(parsed.ir.sz_attributes[0].array_parts.len(), 2);
        assert_eq!(lowered.classes, ["p-4", "rounded-md", "bg-blue-500"]);
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
                "export const App = () => <div sz={([{ display: 'flex' }] as const)} />;",
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
            ("sz={{ fontStyle: 'normal' }}", vec!["not-italic"]),
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
    fn parser_shell_extracts_bare_szr_literal_args() {
        let source =
            r#"import {szr} from "@csszyx/runtime"; export const c = szr({ tracking: "widest" });"#;
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });
        assert!(
            parsed
                .ir
                .extracted_classes
                .contains(&"tracking-widest".to_string()),
            "bare szr literal args must reach the safelist: {:?}",
            parsed.ir.extracted_classes
        );
    }

    #[test]
    fn parser_shell_extracts_szv_catalog_through_ts_wrappers() {
        // `satisfies` / `as` are type-level; extraction must look through them
        // on the config argument and inside the variants tree.
        let source = r#"import {szv} from "@csszyx/runtime"; export const t = szv({ variants: { c: { blue: { bg: "tag-blue" } } satisfies Record<string, object> } } satisfies object);"#;
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });
        assert!(
            parsed
                .ir
                .extracted_classes
                .contains(&"bg-tag-blue".to_string()),
            "szv catalog should extract through TS wrappers: {:?}",
            parsed.ir.extracted_classes
        );
    }

    #[test]
    fn parser_shell_compiles_szs_slot_map() {
        // Each szs slot VALUE compiles to its class string (key kept); classes
        // flow into the manifest AFTER sz-derived classes; the rewrite emits the
        // shared cross-engine format.
        let source = r#"const X = () => <Card sz={{ p: 4 }} szs={{ header: { bg: "gray-100" }, icon: { color: "red-500" } }} />;"#;
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });
        assert!(parsed.diagnostics.is_empty(), "{source}");
        assert!(parsed.ir.szs_diagnostics.is_empty());
        assert_eq!(parsed.ir.szs_attributes.len(), 1);
        let szs = &parsed.ir.szs_attributes[0];
        assert_eq!(szs.entries.len(), 2);
        assert_eq!(szs.entries[0].key, "header");
        assert_eq!(szs.entries[0].class_name, "bg-gray-100");
        assert_eq!(szs.entries[0].emit_text, "\"bg-gray-100\"");
        assert_eq!(szs.entries[1].class_name, "text-red-500");

        // sz classes first, szs classes after (discovery-order parity).
        let lowered = lower_source_ir_classes(&parsed.ir);
        assert_eq!(lowered.classes, ["p-4", "bg-gray-100", "text-red-500"]);

        let rewritten = crate::transform::rewrite::rewrite_static_sz_attributes(
            source,
            "/repo/src/App.tsx",
            &parsed.ir,
        )
        .expect("rewrite succeeds");
        assert!(rewritten.contains(r#"szsc={{ header: "bg-gray-100", icon: "text-red-500" }}"#));
        assert!(rewritten.contains(r#"className="p-4""#));
    }

    #[test]
    fn parser_shell_szs_host_and_unsupported_shapes_left_unchanged() {
        // Host misuse and non-static slot values leave the attribute untouched
        // and record a dev diagnostic instead.
        let host = "const X = () => <div szs={{ header: { p: 2 } }} />;";
        let parsed_host = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: host.to_string(),
        });
        assert_eq!(parsed_host.ir.szs_attributes.len(), 0);
        assert_eq!(parsed_host.ir.szs_diagnostics.len(), 1);
        assert!(parsed_host.ir.szs_diagnostics[0].contains("host element"));

        let non_static = "const X = ({ v }) => <Card szs={{ header: v }} />;";
        let parsed_dynamic = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: non_static.to_string(),
        });
        assert_eq!(parsed_dynamic.ir.szs_attributes.len(), 0);
        assert_eq!(parsed_dynamic.ir.szs_diagnostics.len(), 1);
        assert!(parsed_dynamic.ir.szs_diagnostics[0].contains("identifier key"));

        // All-string map: classes collected AND the attribute still renames to
        // `szsc` — the component reads only the compiled prop.
        let strings = r#"const X = () => <Card szs={{ header: "p-4 bg-red-500" }} />;"#;
        let parsed_strings = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: strings.to_string(),
        });
        let lowered = lower_source_ir_classes(&parsed_strings.ir);
        assert_eq!(lowered.classes, ["p-4", "bg-red-500"]);
        let rewritten = crate::transform::rewrite::rewrite_static_sz_attributes(
            strings,
            "/repo/src/App.tsx",
            &parsed_strings.ir,
        )
        .expect("rewrite succeeds");
        assert!(rewritten.contains(r#"szsc={{ header: "p-4 bg-red-500" }}"#));

        // The compiled output parses as plain JSX: `szsc` is never re-collected,
        // so a second pass leaves it untouched (idempotent by construction).
        let second = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: rewritten,
        });
        assert_eq!(second.ir.szs_attributes.len(), 0);
        assert!(second.ir.szs_diagnostics.is_empty());
    }

    #[test]
    fn parser_shell_expands_conditional_under_attachment_variant() {
        // A finite conditional nested under the `group` attachment variant must
        // join the variants the way the static path does (`group-hover:`), not the
        // flat `group:hover:` a `{prefix}:{class}` prepend produced.
        let source = "const X = ({ c }) => <div sz={{ group: { hover: { bg: c ? \"red-500\" : \"blue-500\" } } }} />;";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });

        assert!(parsed.diagnostics.is_empty(), "{source}");
        let ternary = parsed.ir.sz_attributes[0]
            .ternary
            .as_ref()
            .expect("nested conditional should record a ternary");
        assert_eq!(ternary.consequent_classes, ["group-hover:bg-red-500"]);
        assert_eq!(ternary.alternate_classes, ["group-hover:bg-blue-500"]);
    }

    #[test]
    fn parser_shell_expands_conditional_under_parametric_variant() {
        // The `has` parametric variant brackets its selector child
        // (`has-[:checked]:`); a nested conditional must reuse that lowering.
        let source = "const X = ({ c }) => <div sz={{ has: { checked: { bg: c ? \"red-500\" : \"blue-500\" } } }} />;";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });

        assert!(parsed.diagnostics.is_empty(), "{source}");
        let ternary = parsed.ir.sz_attributes[0]
            .ternary
            .as_ref()
            .expect("nested conditional should record a ternary");
        assert_eq!(ternary.consequent_classes, ["has-[:checked]:bg-red-500"]);
        assert_eq!(ternary.alternate_classes, ["has-[:checked]:bg-blue-500"]);
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
        let lowered = lower_source_ir_classes(&parsed.ir);
        assert_eq!(lowered.classes, ["p-4", "p-8"]);
        let value_text =
            &source[attribute.value_span.start as usize..attribute.value_span.end as usize];
        assert_eq!(value_text, "{ ...BASE, ...(big ? { p: 8 } : {}) }");
    }

    #[test]
    fn parser_shell_flags_only_top_level_spread_for_spread_diagnostic() {
        // A top-level spread of a value the parser can't resolve statically is
        // flagged so the build surfaces it.
        let spread = "const X = ({ props }) => <div sz={{ ...props }} />;";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: spread.to_string(),
        });
        let attribute = &parsed.ir.sz_attributes[0];
        assert!(attribute.runtime_fallback);
        assert!(
            attribute.runtime_fallback_spread,
            "top-level spread must be flagged"
        );

        // A dynamic value-object sub-field also falls back to runtime but carries
        // no top-level spread, so it must NOT be flagged (no noisy warning).
        let value_obj = "const X = ({ v }) => <div sz={{ bg: { color: 'black', op: v } }} />;";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: value_obj.to_string(),
        });
        let attribute = &parsed.ir.sz_attributes[0];
        assert!(attribute.runtime_fallback);
        assert!(
            !attribute.runtime_fallback_spread,
            "value-object backstop must not be flagged as a spread"
        );
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
    fn parser_shell_punts_dynamic_value_object_sub_field_to_runtime() {
        // A dynamic/ternary value on a nested value-object sub-property (color
        // opacity var, arbitrary `css`, gradient direction) must fall back to the
        // runtime, never lower to a dead `<property>:<subkey>` class such as
        // `bg:op-(--var)`, `css:text-red`, or `bgImg:dir-to-r`.
        for source in [
            "const X = ({ v }) => <div sz={{ bg: { color: 'black', op: v } }} />;",
            "const X = ({ c }) => <div sz={{ css: { color: c ? 'red' : 'blue' } }} />;",
            "const X = ({ c }) => <div sz={{ bgImg: { gradient: 'linear', dir: c ? 'to-r' : 'to-l' } }} />;",
        ] {
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source: source.to_string(),
            });
            assert_eq!(parsed.ir.sz_attributes.len(), 1, "{source}");
            assert!(
                parsed.ir.sz_attributes[0].runtime_fallback,
                "must fall back to the runtime: {source}"
            );
            let lowered = lower_source_ir_classes(&parsed.ir);
            for class in &lowered.classes {
                assert!(
                    !class.contains(":op-")
                        && !class.contains(":dir-")
                        && !class.starts_with("css:"),
                    "dead class `{class}` from {source}"
                );
            }
        }
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
