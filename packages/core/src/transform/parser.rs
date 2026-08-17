#[cfg(target_arch = "wasm32")]
use super::engine::Instant;
use oxc_allocator::Allocator;
use oxc_ast::{
    ast::{
        Argument, ArrayExpression, ArrayExpressionElement, CallExpression, ConditionalExpression,
        Expression, ImportDeclaration, ImportDeclarationSpecifier, JSXAttribute, JSXAttributeItem,
        JSXAttributeName, JSXAttributeValue, JSXElement, JSXElementName, JSXExpression,
        JSXFragment, JSXMemberExpression, JSXMemberExpressionObject, JSXOpeningElement,
        JSXSpreadAttribute, LogicalExpression, ObjectExpression, ObjectProperty,
        ObjectPropertyKind, Program, PropertyKey, Statement, TSTypeQuery, TSTypeQueryExprName,
        UnaryOperator, VariableDeclaration,
    },
    AstKind,
};
use oxc_ast_visit::{walk, Visit};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType, Span};
use std::collections::HashSet;
#[cfg(not(target_arch = "wasm32"))]
use std::time::Instant;

use super::{
    lower::{dynamic_css_var_class, is_removed_sz_key, lower_static_sz_object},
    ClassAttributeIr, DroppedKeyReason, DroppedSzKeyIr, DynamicCssVarCategory, DynamicCssVarIr,
    JsxOpeningElementIr, RecoveryAttributeIr, RecoveryMode, SafeStyleSpreadExpressionIr,
    SafeStyleSpreadIr, SafeStyleSpreadObjectIr, SafeStyleSpreadValueIr, SourceIr,
    StaticArrayPartIr, StaticSzObject, StaticSzProperty, StaticSzValue, StaticTernaryIr,
    StyleAttributeIr, SzAttributeIr, SzsAttributeIr, SzsSlotEntryIr, TextSpan, TransformFile,
    TransformTimings, UnsupportedRecoveryIr,
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
    parse_source_shell_with_budget_and_statics(file, ast_budget, &Vec::new())
}

/// [`parse_source_shell_with_budget`] with the bundler's cross-module szv
/// registry, decoded to native IR objects.
pub fn parse_source_shell_with_budget_and_statics(
    file: &TransformFile,
    ast_budget: usize,
    cross_module: &super::szv_precompile::CrossModuleStatics,
) -> ParsedSourceShell {
    parse_source_shell_with_registries(
        file,
        ast_budget,
        CrossModuleRegistries {
            szv_factories: cross_module,
            sz_objects: &Vec::new(),
        },
    )
}

/// The bundler-supplied cross-module registries one parse may consult.
///
/// They travel as a named pair rather than two positional arguments because
/// they decode to the same Rust type: a swap would compile and quietly apply
/// the wrong machinery to each.
#[derive(Clone, Copy)]
pub struct CrossModuleRegistries<'a> {
    /// Imported szv factory configs: specifier → (exported name → config).
    pub szv_factories: &'a super::szv_precompile::CrossModuleStatics,
    /// Imported static sz objects: specifier → (exported name → object).
    pub sz_objects: &'a super::szv_precompile::CrossModuleSzObjects,
}

/// [`parse_source_shell_with_budget`] with both cross-module registries.
pub fn parse_source_shell_with_registries(
    file: &TransformFile,
    ast_budget: usize,
    registries: CrossModuleRegistries<'_>,
) -> ParsedSourceShell {
    let cross_module = registries.szv_factories;
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
        let imported_sz_objects =
            collect_imported_sz_objects(&parsed.program, registries.sz_objects);
        let imported_namespaces =
            collect_imported_namespaces(&parsed.program, registries.sz_objects);
        let imported_names = collect_imported_names(&parsed.program);
        let mut visitor = CsszyxIrVisitor {
            source: &file.source,
            ir: &mut ir,
            node_count: 0,
            ast_budget,
            ast_budget_exceeded: false,
            scope: &scope,
            program: &parsed.program,
            element_stack: Vec::new(),
            szr_import: None,
            szr_call_args: Vec::new(),
            pending_szr_fallbacks: Vec::new(),
            szv_disqualified: Vec::new(),
            szv_candidates: Vec::new(),
            szv_call_sites: Vec::new(),
            szv_type_query_counts: Vec::new(),
            szv_gate: file.source.contains("szv(") || !cross_module.is_empty(),
            cross_module,
            imported_sz_objects: &imported_sz_objects,
            imported_namespaces: &imported_namespaces,
            imported_names: &imported_names,
        };
        let ir_start = Instant::now();
        visitor.visit_program(&parsed.program);
        let replaced_spans = visitor.finalize_szv_precompile();
        visitor.emit_pending_szr_fallbacks(&replaced_spans);
        visitor.name_disqualified_szv_factories_in_attributes();
        visitor.finalize_szr_import_rewrite(&replaced_spans);
        timings.ir_ns = elapsed_ns(ir_start);
        visitor.ast_budget_exceeded
    };

    // oxc 0.140 folds warnings into `diagnostics`; only error-severity entries
    // are parse failures, matching the old `errors` field.
    let mut diagnostics: Vec<String> = parsed
        .diagnostics
        .errors()
        .map(std::string::ToString::to_string)
        .collect();
    let error_count = diagnostics.len();
    if error_count > 0 || parsed.panicked {
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
                error_count
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
    /// Qualifying szr import clause: source-literal span (quotes included),
    /// specifier value, whole-statement span, and the OTHER named specifiers'
    /// spans (non-empty means the clause splits).
    szr_import: Option<SzrImportRecord>,
    /// Direct `szr(...)` calls as per-argument analyses; the proof is
    /// deferred to finalize, where the szv precompile decides which factory
    /// calls become strings.
    szr_call_args: Vec<SzrCallRecord>,
    /// szr calls whose first argument was unresolvable during the walk;
    /// whether that is a real fallback is decided at finalize, after the szv
    /// precompile has proven (or failed to prove) the argument.
    pending_szr_fallbacks: Vec<PendingSzrFallback>,
    /// szv factories THIS parse saw and refused: binding name to the
    /// disqualifying position inside the config, for the szr fallback that
    /// would otherwise blame the factory with generic call advice.
    szv_disqualified: Vec<(String, String)>,
    /// File-local `const F = szv(<literal config>)` candidates that passed the
    /// shape and overlap checks (reference accounting is deferred).
    szv_candidates: Vec<SzvFactoryRecord>,
    /// Every direct identifier-callee call that could be a factory call site.
    szv_call_sites: Vec<SzvCallSite>,
    /// `typeof X` type-query references by name — erased at runtime, so the
    /// reference accounting must not charge them against the factory.
    szv_type_query_counts: Vec<(String, usize)>,
    /// Whether the file can contain an szv factory at all — without an szv
    /// call there is nothing to precompile, and every parsed file would
    /// otherwise pay the call-site vector for nothing.
    szv_gate: bool,
    /// Bundler-resolved imported factories: specifier → (name → config).
    cross_module: &'p super::szv_precompile::CrossModuleStatics,
    /// Imported static sz objects already narrowed to this file's LOCAL
    /// binding names, so identifier lowering is one lookup and a file that
    /// imports none of them pays nothing.
    imported_sz_objects: &'p [(String, StaticSzObject)],
    /// Namespace imports of registry-backed modules, by LOCAL binding name,
    /// each carrying that module's exports as one object.
    imported_namespaces: &'p [(String, StaticSzObject)],
    /// Local names this module introduced with an import, any form.
    imported_names: &'p HashSet<String>,
}

/// One qualifying szr import clause, recorded for the deferred rewrite.
struct SzrImportRecord {
    /// Span of the import source literal, quotes included.
    source_span: super::TextSpan,
    /// Slim entry selected while qualifying the import source.
    target: &'static str,
    /// Original source retained when a mixed import must be rebuilt.
    source_value: String,
    /// Span of the whole import declaration.
    statement_span: super::TextSpan,
    /// Spans of the other named specifiers staying on the original source.
    other_specifier_spans: Vec<super::TextSpan>,
}

/// One direct `szr(...)` call with its per-argument analyses.
struct SzrCallRecord {
    /// Span of the whole call, linking deferred fallbacks back to it.
    span: super::TextSpan,
    /// Per-argument analyses, in argument order.
    args: Vec<SzrArgAnalysis>,
}

/// Verdict for one szr argument: shape plus the factory calls inside it.
struct SzrArgAnalysis {
    /// Whether every non-factory leaf is provably a string or falsy.
    shape_ok: bool,
    /// Spans of identifier-callee calls that must collapse for the proof.
    factory_spans: Vec<super::TextSpan>,
}

/// One deferred szr fallback: the classified diagnostic, held back until the
/// szv precompile decides whether the argument collapsed to a string.
struct PendingSzrFallback {
    /// Span of the enclosing szr call.
    call_span: super::TextSpan,
    /// Pre-classified fallback payload.
    fallback: super::SiteFallbackIr,
}

/// One qualified-so-far szv factory.
struct SzvFactoryRecord {
    /// Factory binding name.
    name: String,
    /// End offset of the declaration statement, for the table insertion.
    statement_end: u32,
    /// Compiled table (shape and overlap already validated).
    table: super::szv_precompile::SzvTable,
}

/// One direct identifier-callee call.
struct SzvCallSite {
    /// Callee name.
    callee: String,
    /// Span of the whole call.
    span: super::TextSpan,
    /// Classified argument shape.
    argument: Option<SzvCallArg>,
}

/// Argument shape of one potential factory call.
enum SzvCallArg {
    /// `F()` — resolved from defaults alone.
    None,
    /// Fully static selection, values pre-stringified.
    Static(super::szv_precompile::StaticSelection),
    /// Anything else with exactly one argument: spliced into `__szvPick`.
    Dynamic {
        /// Span of the whole selection argument.
        span: super::TextSpan,
        /// Set when the selection literal names exactly one static key, which
        /// the splice may collapse to `__szvPick1` once the table confirms the
        /// key is a real dimension.
        single: Option<SzvSingleDimension>,
    },
}

/// A selection literal of exactly one statically named dimension.
struct SzvSingleDimension {
    /// The selected dimension name.
    dimension: String,
    /// Span of the value expression, spliced as the picker's third argument.
    value_span: super::TextSpan,
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

        let index = self.ir.jsx_opening_elements.len();
        self.visit_jsx_opening_element(&element.opening_element);
        self.element_stack.push(index);
        self.visit_jsx_children(&element.children);
        self.element_stack.pop();
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
            has_spread_attribute: false,
            safe_style_spread: None,
            last_attribute_end: None,
            element_name: "<>".to_string(),
            hoisted_dynamic_css_vars: Vec::new(),
        });

        self.element_stack.push(index);
        self.visit_jsx_children(&fragment.children);
        self.element_stack.pop();
    }

    fn visit_jsx_opening_element(&mut self, element: &JSXOpeningElement<'a>) {
        let element_name = jsx_element_name(&element.name);
        let mut sz_attribute_indices = Vec::new();
        let mut class_attribute_index = None;
        let mut style_attribute_index = None;
        let mut recovery_attribute_index = None;
        let mut has_recovery_token_attribute = false;
        let mut has_spread_attribute = false;
        let mut safe_style_spread = None;
        let mut spread_count = 0usize;
        let mut last_attribute_end = None;

        for item in &element.attributes {
            let attr = match item {
                JSXAttributeItem::Attribute(attr) => attr,
                JSXAttributeItem::SpreadAttribute(spread) => {
                    has_spread_attribute = true;
                    spread_count += 1;
                    safe_style_spread = if spread_count == 1 {
                        safe_style_spread_from_attribute(spread)
                    } else {
                        None
                    };
                    continue;
                }
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
                    "szRecover" => match self.collect_recovery_attribute(attr) {
                        Ok(index) => recovery_attribute_index = Some(index),
                        Err(reason) => self.ir.unsupported_recovery_attributes.push(reason),
                    },
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
            has_spread_attribute,
            safe_style_spread: if style_attribute_index.is_none() && spread_count == 1 {
                safe_style_spread
            } else {
                None
            },
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
        self.record_szr_call_proof(call);
        walk::walk_call_expression(self, call);
    }

    fn visit_import_declaration(&mut self, declaration: &ImportDeclaration<'a>) {
        if self.ast_budget_exceeded {
            return;
        }

        self.record_szr_import_candidate(declaration);
        self.record_cross_module_szv_factories(declaration);
        walk::walk_import_declaration(self, declaration);
    }

    fn visit_variable_declaration(&mut self, declaration: &VariableDeclaration<'a>) {
        if self.ast_budget_exceeded {
            return;
        }

        self.record_szv_factory_candidates(declaration);
        walk::walk_variable_declaration(self, declaration);
    }

    fn visit_ts_type_query(&mut self, query: &TSTypeQuery<'a>) {
        if !self.ast_budget_exceeded && self.szv_gate {
            if let TSTypeQueryExprName::IdentifierReference(identifier) = &query.expr_name {
                let name = identifier.name.as_str();
                if let Some(entry) = self
                    .szv_type_query_counts
                    .iter_mut()
                    .find(|(existing, _)| existing == name)
                {
                    entry.1 += 1;
                } else {
                    self.szv_type_query_counts.push((name.to_string(), 1));
                }
            }
        }
        walk::walk_ts_type_query(self, query);
    }
}

/// Classify one JSX spread whose object branches can absorb generated style vars.
fn safe_style_spread_from_attribute(spread: &JSXSpreadAttribute<'_>) -> Option<SafeStyleSpreadIr> {
    let expression = unwrap_expression(&spread.argument);
    let expression = match expression {
        Expression::ObjectExpression(object) => {
            SafeStyleSpreadExpressionIr::Object(safe_style_spread_object(object)?)
        }
        Expression::ConditionalExpression(conditional) => {
            let consequent = unwrap_expression(&conditional.consequent);
            let alternate = unwrap_expression(&conditional.alternate);
            let Expression::ObjectExpression(consequent) = consequent else {
                return None;
            };
            let Expression::ObjectExpression(alternate) = alternate else {
                return None;
            };
            SafeStyleSpreadExpressionIr::Conditional {
                test_span: text_span(conditional.test.span()),
                consequent: safe_style_spread_object(consequent)?,
                alternate: safe_style_spread_object(alternate)?,
            }
        }
        _ => return None,
    };
    Some(SafeStyleSpreadIr {
        attribute_span: text_span(spread.span),
        expression,
    })
}

/// Capture one object-literal spread branch with at most one explicit style key.
fn safe_style_spread_object(object: &ObjectExpression<'_>) -> Option<SafeStyleSpreadObjectIr> {
    let mut style_value = None;
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            return None;
        };
        if property.computed {
            return None;
        }
        if static_property_key(&property.key).as_deref() != Some("style") {
            continue;
        }
        if style_value.is_some() {
            return None;
        }
        let value = unwrap_expression(&property.value);
        style_value = Some(match value {
            Expression::ObjectExpression(style_object) => SafeStyleSpreadValueIr::Object {
                span: text_span(style_object.span),
                has_properties: !style_object.properties.is_empty(),
            },
            _ => SafeStyleSpreadValueIr::Expression(text_span(value.span())),
        });
    }
    Some(SafeStyleSpreadObjectIr {
        object_span: text_span(object.span),
        has_properties: !object.properties.is_empty(),
        style_value,
    })
}

/// Scope + program pair threaded through static-lowering recursions so the
/// `sz={NAME}` identifier path can resolve declarator initializers without
/// each helper learning the scope module directly.
#[derive(Clone, Copy)]
struct ResolveContext<'p> {
    scope: &'p super::scope::DeclaratorScope,
    program: &'p oxc_ast::ast::Program<'p>,
    /// Static sz objects this file imported, by LOCAL binding name.
    imported_sz_objects: &'p [(String, StaticSzObject)],
    /// Namespace imports of registry-backed modules, by LOCAL binding name.
    imported_namespaces: &'p [(String, StaticSzObject)],
}

impl<'p> CsszyxIrVisitor<'_, '_, 'p> {
    const fn resolve_context(&self) -> ResolveContext<'p> {
        ResolveContext {
            scope: self.scope,
            program: self.program,
            imported_sz_objects: self.imported_sz_objects,
            imported_namespaces: self.imported_namespaces,
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
        let unsupported_message =
            super::generated::sz_fallback_matrix::szs_unsupported_diagnostic(&self.ir.filename);
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attr.value else {
            self.ir.szs_diagnostics.push(unsupported_message);
            return;
        };
        let JSXExpression::ObjectExpression(slot_map) = &container.expression else {
            self.ir.szs_diagnostics.push(unsupported_message);
            return;
        };
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
                    let Some(static_object) = static_szs_object(object) else {
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
        // Set only by the runtime-fallback branch below; every statically
        // handled shape leaves it `None` so the engine emits nothing for it.
        let mut runtime_fallback_diagnostic = None;
        let (
            object,
            value_span,
            literal_class_name,
            rewrites_empty_class,
            ternaries,
            array_parts,
            runtime_fallback,
            runtime_fallback_spread,
            candidate_classes,
            dynamic_css_vars,
            dropped_dynamic_keys,
        ) = match &attr.value {
            Some(JSXAttributeValue::StringLiteral(value)) => (
                StaticSzObject::empty(),
                string_value_span(value.span, self.source),
                Some(value.value.to_string()),
                true,
                Vec::new(),
                Vec::new(),
                false,
                false,
                Vec::new(),
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
                        vec![ternary],
                        Vec::new(),
                        false,
                        false,
                        Vec::new(),
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
                        Vec::new(),
                        Vec::new(),
                        false,
                        false,
                        Vec::new(),
                        Vec::new(),
                        Vec::new(),
                    )
                } else if let Some((
                    object,
                    value_span,
                    dynamic_css_vars,
                    ternaries,
                    dropped_dynamic_keys,
                )) = partial_object_from_jsx_expression(&container.expression, ctx)
                {
                    (
                        object,
                        value_span,
                        None,
                        false,
                        ternaries,
                        Vec::new(),
                        false,
                        false,
                        Vec::new(),
                        dynamic_css_vars,
                        dropped_dynamic_keys,
                    )
                } else if let Some((array_parts, value_span)) =
                    static_array_parts_from_jsx_expression(&container.expression, ctx)
                {
                    (
                        StaticSzObject::empty(),
                        value_span,
                        None,
                        false,
                        Vec::new(),
                        array_parts,
                        false,
                        false,
                        Vec::new(),
                        Vec::new(),
                        Vec::new(),
                    )
                } else {
                    let value_span =
                        runtime_fallback_span_from_jsx_expression(&container.expression)?;
                    let candidate_classes =
                        candidate_classes_from_jsx_expression(&container.expression, ctx);
                    runtime_fallback_diagnostic =
                        classify_runtime_fallback(&container.expression, self.imported_names);
                    (
                        StaticSzObject::empty(),
                        value_span,
                        None,
                        false,
                        Vec::new(),
                        Vec::new(),
                        true,
                        jsx_expression_has_top_level_spread(&container.expression),
                        candidate_classes,
                        Vec::new(),
                        Vec::new(),
                    )
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
            ternaries,
            array_parts,
            runtime_fallback,
            runtime_fallback_spread,
            candidate_classes,
            runtime_fallback_diagnostic,
            dynamic_css_vars,
            dropped_dynamic_keys,
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
                    // `szr` compiles its literal argument so the classes reach
                    // the safelist; an argument it cannot read means those
                    // classes are never collected and the CSS is simply absent.
                    // `dynamic()` is exempt — it injects its own rules at
                    // runtime, which is the whole point of it. The diagnostic
                    // itself is DEFERRED: whether this argument is a real
                    // fallback depends on the szv precompile, decided at
                    // finalize.
                    if callee.name == "szr" {
                        if let Some(expression) = argument.as_expression() {
                            let (kind, detail) =
                                classify_expression_fallback(expression, self.imported_names);
                            self.pending_szr_fallbacks.push(PendingSzrFallback {
                                call_span: text_span(call.span()),
                                fallback: super::SiteFallbackIr {
                                    site: super::SzFallbackSiteIr::Szr,
                                    kind,
                                    detail,
                                    offset: fallback_expression_offset(expression),
                                    path: String::new(),
                                },
                            });
                        }
                    }
                    return;
                };
                self.ir
                    .extracted_classes
                    .extend(lower_static_sz_object(&object));
                // The same key checks an sz prop gets: a typo inside a static
                // szr() argument must be findable by `csszyx check`. dynamic()
                // stays exempt — its runtime dev-warning owns that surface,
                // and its static argument is often a partial base merged with
                // runtime values.
                if callee.name.as_str() == "szr" {
                    self.ir.catalog_sz_objects.push(object);
                }
            }
            "szv" => {
                let Some(classes) = collect_szv_catalog_classes(
                    argument,
                    self.resolve_context(),
                    &mut self.ir.catalog_sz_objects,
                ) else {
                    // No catalogue is emitted, so none of the variant classes
                    // are safelisted — under Tailwind `source(none)` that is
                    // silently missing CSS for every variant it can produce.
                    self.record_site_fallback(super::SzFallbackSiteIr::Szv, argument);
                    return;
                };
                self.ir.extracted_classes.extend(classes);
            }
            _ => {}
        }
    }

    /// Record an import declaration when it is the rewritable szr clause.
    ///
    /// Same qualifying shape as the JS lanes: one value import of `szr`, no
    /// alias, from a mapped source. Anything else is simply not recorded — the
    /// reference accounting then fails the proof.
    fn record_szr_import_candidate(&mut self, declaration: &ImportDeclaration<'_>) {
        if declaration.import_kind.is_type() {
            return;
        }
        let source_value = declaration.source.value.as_str();
        let Some(target) = szr_rewrite_target(source_value) else {
            return;
        };
        let Some(specifiers) = &declaration.specifiers else {
            return;
        };
        let mut saw_szr = false;
        let mut other_specifier_spans: Vec<super::TextSpan> = Vec::new();
        for entry in specifiers {
            // A default or namespace specifier makes the clause shape one this
            // rewrite does not rebuild — leave the whole declaration alone.
            let ImportDeclarationSpecifier::ImportSpecifier(specifier) = entry else {
                return;
            };
            if !specifier.import_kind.is_type()
                && specifier.imported.name() == "szr"
                && specifier.local.name == "szr"
            {
                saw_szr = true;
            } else {
                other_specifier_spans.push(text_span(specifier.span));
            }
        }
        if !saw_szr {
            return;
        }
        self.szr_import = Some(SzrImportRecord {
            source_span: text_span(declaration.source.span),
            target,
            source_value: source_value.to_string(),
            statement_span: text_span(declaration.span),
            other_specifier_spans,
        });
    }

    /// Record one direct identifier-callee call for the deferred proofs.
    fn record_szr_call_proof(&mut self, call: &CallExpression<'_>) {
        let Expression::Identifier(callee) = &call.callee else {
            return;
        };
        if callee.name == "szr" {
            let args = call
                .arguments
                .iter()
                .map(|argument| analyze_szr_call_argument(argument))
                .collect();
            self.szr_call_args.push(SzrCallRecord {
                span: text_span(call.span()),
                args,
            });
            return;
        }
        if !self.szv_gate || SZV_RESERVED_FACTORY_NAMES.contains(&callee.name.as_str()) {
            return;
        }
        let argument = classify_szv_call_argument(call);
        self.szv_call_sites.push(SzvCallSite {
            callee: callee.name.to_string(),
            span: text_span(call.span()),
            argument,
        });
    }

    /// Record every `const F = szv(<literal config>)` declarator, compiling
    /// the table when the config passes the shape and overlap checks.
    fn record_szv_factory_candidates(&mut self, declaration: &VariableDeclaration<'_>) {
        if !self.szv_gate {
            return;
        }
        for declarator in &declaration.declarations {
            let Some(name) = declarator.id.get_identifier_name() else {
                continue;
            };
            if SZV_RESERVED_FACTORY_NAMES.contains(&name.as_str()) {
                continue;
            }
            let Some(init) = &declarator.init else {
                continue;
            };
            let Expression::CallExpression(call) = unwrap_expression(init) else {
                continue;
            };
            let Expression::Identifier(callee) = &call.callee else {
                continue;
            };
            if callee.name != "szv" || call.arguments.len() != 1 {
                continue;
            }
            let Some(argument) = call.arguments[0].as_expression() else {
                continue;
            };
            let Expression::ObjectExpression(object) = unwrap_expression(argument) else {
                self.record_szv_disqualified(&name, String::from("config"));
                continue;
            };
            let config_object = match strict_literal_object_diagnosed(object, "") {
                Ok(config_object) => config_object,
                Err(path) => {
                    self.record_szv_disqualified(&name, path);
                    continue;
                }
            };
            let config = match super::szv_precompile::static_szv_config_from_object_diagnosed(
                &config_object,
            ) {
                Ok(config) => config,
                Err(path) => {
                    self.record_szv_disqualified(&name, path);
                    continue;
                }
            };
            if let Some(path) = super::szv_precompile::overlap_disqualify_path(&config) {
                self.record_szv_disqualified(&name, path);
                continue;
            }
            self.szv_candidates.push(SzvFactoryRecord {
                name: name.to_string(),
                statement_end: declaration.span.end,
                table: super::szv_precompile::compile_szv_table(&config),
            });
        }
    }

    /// Record factory candidates that arrive through imports, resolved by the
    /// bundler's cross-module registry. The LOCAL binding name becomes the
    /// factory name; qualification and table compilation run the same code the
    /// local candidates use, so a `build.parser` flip cannot differ.
    fn record_cross_module_szv_factories(&mut self, declaration: &ImportDeclaration<'_>) {
        if declaration.import_kind.is_type() || self.cross_module.is_empty() {
            return;
        }
        let source_value = declaration.source.value.as_str();
        let Some((_, entries)) = self
            .cross_module
            .iter()
            .find(|(specifier, _)| specifier == source_value)
        else {
            return;
        };
        let Some(specifiers) = &declaration.specifiers else {
            return;
        };
        for entry in specifiers {
            let ImportDeclarationSpecifier::ImportSpecifier(specifier) = entry else {
                continue;
            };
            if specifier.import_kind.is_type() {
                continue;
            }
            let imported = specifier.imported.name();
            let Some((_, config_object)) =
                entries.iter().find(|(name, _)| name.as_str() == imported)
            else {
                continue;
            };
            let local = specifier.local.name.as_str();
            if SZV_RESERVED_FACTORY_NAMES.contains(&local)
                || self.szv_candidates.iter().any(|c| c.name == local)
            {
                continue;
            }
            let Some(config) = super::szv_precompile::static_szv_config_from_object(config_object)
            else {
                continue;
            };
            if !super::szv_precompile::szv_config_free_of_overlap(&config) {
                continue;
            }
            self.szv_candidates.push(SzvFactoryRecord {
                name: local.to_string(),
                statement_end: declaration.span.end,
                table: super::szv_precompile::compile_szv_table(&config),
            });
        }
    }

    /// Standalone occurrences of one identifier in the source, comments
    /// excluded — the reference accounting shared by a factory binding and its
    /// emitted table constant.
    fn word_occurrences_outside_comments(&self, word: &str) -> usize {
        subtract_comment_occurrences(
            super::szv_precompile::count_word_occurrences(self.source, word),
            self.source,
            &self.program.comments,
            |slice| super::szv_precompile::count_word_occurrences(slice, word),
        )
    }

    /// Whether a span sits inside an `sz` attribute the rewrite replaces.
    fn span_inside_sz_attribute(&self, span: super::TextSpan) -> bool {
        self.ir.sz_attributes.iter().any(|attribute| {
            span.start >= attribute.attribute_span.start && span.end <= attribute.attribute_span.end
        })
    }

    /// Decide the szv precompile after the whole file was walked, writing the
    /// splices into the IR. Returns the spans of replaced factory calls so the
    /// szr proof can treat them as strings.
    fn finalize_szv_precompile(&mut self) -> Vec<super::TextSpan> {
        let mut replaced: Vec<super::TextSpan> = Vec::new();
        if self.szv_candidates.is_empty() {
            return replaced;
        }
        let szr_factory_spans: Vec<super::TextSpan> = self
            .szr_call_args
            .iter()
            .flat_map(|record| &record.args)
            .flat_map(|analysis| analysis.factory_spans.iter().copied())
            .collect();
        let candidates = std::mem::take(&mut self.szv_candidates);
        for candidate in &candidates {
            let calls: Vec<&SzvCallSite> = self
                .szv_call_sites
                .iter()
                .filter(|site| site.callee == candidate.name)
                .collect();
            if calls.is_empty() {
                continue;
            }
            let accounted = calls
                .iter()
                .all(|site| szr_factory_spans.contains(&site.span) && site.argument.is_some());
            if !accounted {
                continue;
            }
            // Everything under an `sz` attribute is replaced by a generated
            // expression, so a call nested in it cannot also be spliced: the
            // rewrite buffer refuses to split a range it already replaced and
            // aborts the process. Mirrors `callInsideRewrittenSpan` in the JS
            // lanes, so all three keep the runtime path for this shape.
            if calls
                .iter()
                .any(|site| self.span_inside_sz_attribute(site.span))
            {
                continue;
            }
            let type_queries = self
                .szv_type_query_counts
                .iter()
                .find(|(name, _)| name == &candidate.name)
                .map_or(0, |(_, count)| *count);
            if self.word_occurrences_outside_comments(&candidate.name)
                != 1 + calls.len() + type_queries
            {
                continue;
            }
            let table_ident = super::szv_precompile::szv_table_identifier(&candidate.name);
            if self.word_occurrences_outside_comments(&table_ident) != 0 {
                continue;
            }
            let mut needs_full_pick = false;
            let mut needs_single_pick = false;
            for (site, argument) in calls
                .iter()
                .filter_map(|site| site.argument.as_ref().map(|argument| (*site, argument)))
            {
                let replacement = match argument {
                    SzvCallArg::None => super::szv_precompile::json_string_literal(
                        &super::szv_precompile::compute_static_szv_pick(&candidate.table, None),
                    ),
                    SzvCallArg::Static(selection) => super::szv_precompile::json_string_literal(
                        &super::szv_precompile::compute_static_szv_pick(
                            &candidate.table,
                            Some(selection),
                        ),
                    ),
                    SzvCallArg::Dynamic { span, single } => {
                        let (text, used_single) = dynamic_szv_replacement(
                            self.source,
                            &table_ident,
                            &candidate.table,
                            *span,
                            single.as_ref(),
                        );
                        if used_single {
                            needs_single_pick = true;
                        } else {
                            needs_full_pick = true;
                        }
                        text
                    }
                };
                self.ir.szv_replacements.push(super::SzvReplacementIr {
                    span: site.span,
                    replacement,
                });
                replaced.push(site.span);
            }
            if needs_full_pick || needs_single_pick {
                self.ir
                    .szv_table_insertions
                    .push(super::SzvTableInsertionIr {
                        offset: candidate.statement_end,
                        text: format!(
                            "\nconst {table_ident} = {};",
                            super::szv_precompile::serialize_szv_table(&candidate.table)
                        ),
                    });
                self.ir.uses_szv_pick |= needs_full_pick;
                self.ir.uses_szv_pick1 |= needs_single_pick;
            }
        }
        replaced
    }

    /// Emit the deferred szr fallback diagnostics for arguments that stayed
    /// unproven after the szv precompile, in their recorded (source) order.
    fn emit_pending_szr_fallbacks(&mut self, replaced_spans: &[super::TextSpan]) {
        let pending = std::mem::take(&mut self.pending_szr_fallbacks);
        for mut record in pending {
            let proven = self
                .szr_call_args
                .iter()
                .find(|call| call.span == record.call_span)
                .and_then(|call| call.args.first())
                .is_some_and(|analysis| szr_argument_proven(analysis, replaced_spans));
            if proven {
                continue;
            }
            // A call to a factory this parse saw declared as szv and refused:
            // the generic call advice ("convert to szv()") is circular there,
            // so name the factory as what it is and the config position that
            // disqualified it. Only CONFIG-level refusals rewrite — a factory
            // that qualified but kept its runtime path for usage reasons has
            // nothing wrong in its config to point at.
            if record.fallback.kind == super::RuntimeFallbackKindIr::Call {
                if let Some((_, path)) = self
                    .szv_disqualified
                    .iter()
                    .find(|(name, _)| *name == record.fallback.detail)
                {
                    record.fallback.kind = super::RuntimeFallbackKindIr::SzvFactory;
                    record.fallback.path.clone_from(path);
                }
            }
            self.ir.site_fallbacks.push(record.fallback);
        }
    }

    /// Re-classify sz-attribute fallbacks that call a refused szv factory.
    ///
    /// Same substitution `emit_pending_szr_fallbacks` makes for the szr
    /// position, for the same reason: telling an author to "convert to szv()" a
    /// factory that IS an szv reads as the compiler not understanding the code,
    /// and the generic message names no position, so the reader bisects the call
    /// site while the fault is in the config.
    ///
    /// Runs after the walk because an attribute can precede the declaration it
    /// calls — deciding during the walk would answer correctly only when the
    /// factory happened to be declared first.
    fn name_disqualified_szv_factories_in_attributes(&mut self) {
        if self.szv_disqualified.is_empty() {
            return;
        }
        for attribute in &mut self.ir.sz_attributes {
            let Some(diagnostic) = &mut attribute.runtime_fallback_diagnostic else {
                continue;
            };
            if diagnostic.kind != super::RuntimeFallbackKindIr::Call {
                continue;
            }
            if let Some((_, path)) = self
                .szv_disqualified
                .iter()
                .find(|(name, _)| *name == diagnostic.detail)
            {
                diagnostic.kind = super::RuntimeFallbackKindIr::SzvFactory;
                diagnostic.path.clone_from(path);
            }
        }
    }

    /// Remember one refused szv factory, first declaration wins.
    fn record_szv_disqualified(&mut self, name: &str, path: String) {
        if !self.szv_disqualified.iter().any(|(seen, _)| seen == name) {
            self.szv_disqualified.push((name.to_string(), path));
        }
    }

    /// Decide the szr import rewrite after the whole file was walked.
    ///
    /// Mirrors the JS lanes' `szrRewriteApproved`: no unsafe call, and the raw
    /// word count of `szr` equals one import specifier plus the proven calls.
    /// A `build.parser` flip must not change the emitted import, so the three
    /// verdicts are locked together by the cross-engine suite.
    fn finalize_szr_import_rewrite(&mut self, replaced_spans: &[super::TextSpan]) {
        let Some(record) = self.szr_import.take() else {
            return;
        };
        let mut proven_calls = 0;
        for record in &self.szr_call_args {
            let all_safe = record
                .args
                .iter()
                .all(|analysis| szr_argument_proven(analysis, replaced_spans));
            if !all_safe {
                return;
            }
            proven_calls += 1;
        }
        let occurrences = subtract_comment_occurrences(
            count_szr_word_occurrences(self.source),
            self.source,
            &self.program.comments,
            count_szr_word_occurrences,
        );
        if occurrences != 1 + proven_calls {
            return;
        }
        let target = record.target;
        // Preserve the author's quote character — the span covers it.
        let quote = if self
            .source
            .as_bytes()
            .get(record.source_span.start as usize)
            == Some(&b'"')
        {
            '"'
        } else {
            '\''
        };
        if record.other_specifier_spans.is_empty() {
            self.ir.szr_import_rewrite = Some(super::SzrImportRewriteIr {
                span: record.source_span,
                replacement: format!("{quote}{target}{quote}"),
            });
            return;
        }
        // Split the clause: rebuild the statement as the other specifiers on
        // the original source, then szr alone on the core entry. Rebuilding
        // from the specifier spans drops comments inside the clause; a comment
        // mentioning szr already failed the reference accounting above.
        let others = record
            .other_specifier_spans
            .iter()
            .map(|span| &self.source[span.start as usize..span.end as usize])
            .collect::<Vec<_>>()
            .join(", ");
        let source_value = &record.source_value;
        self.ir.szr_import_rewrite = Some(super::SzrImportRewriteIr {
            span: record.statement_span,
            replacement: format!(
                "import {{ {others} }} from {quote}{source_value}{quote};\nimport {{ szr }} from {quote}{target}{quote};"
            ),
        });
    }

    /// Record a `szr`/`szv` argument the parser could not read, classified for
    /// the shared fallback matrix.
    fn record_site_fallback(&mut self, site: super::SzFallbackSiteIr, argument: &Argument<'_>) {
        let Some(expression) = argument.as_expression() else {
            return;
        };
        let (kind, detail) = classify_expression_fallback(expression, self.imported_names);
        self.ir.site_fallbacks.push(super::SiteFallbackIr {
            site,
            kind,
            detail,
            offset: fallback_expression_offset(expression),
            path: String::new(),
        });
    }

    fn collect_recovery_attribute(
        &mut self,
        attr: &JSXAttribute<'_>,
    ) -> Result<usize, UnsupportedRecoveryIr> {
        let Some(JSXAttributeValue::StringLiteral(value)) = &attr.value else {
            return Err(UnsupportedRecoveryIr::NonLiteral);
        };
        let mode = match value.value.as_str() {
            "csr" => RecoveryMode::Csr,
            "dev-only" => RecoveryMode::DevOnly,
            other => return Err(UnsupportedRecoveryIr::UnknownMode(other.to_string())),
        };

        let index = self.ir.recovery_attributes.len();
        self.ir.recovery_attributes.push(RecoveryAttributeIr {
            attribute_span: text_span(attr.span),
            mode,
        });
        Ok(index)
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
    catalog_objects: &mut Vec<StaticSzObject>,
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
    if !base.properties.is_empty() {
        catalog_objects.push(base.clone());
    }
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
                    // The RAW leaf, not the base-merged copy: merging would
                    // re-report every base key once per variant value.
                    catalog_objects.push(candidate.clone());
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
                let first = values.remove(0);
                let rest = values;
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

/// Convert a value allowed inside an `szs` slot object: string / number /
/// boolean literals, a negated number, or a nested object of the same.
/// Deliberately STRICTER than the sz path (no identifiers, spreads,
/// conditionals, parens, or `as` casts) so all three engines can enforce the
/// exact same contract without a scope resolver.
fn static_szs_value(expression: &Expression<'_>) -> Option<StaticSzValue> {
    match expression {
        Expression::StringLiteral(value) => Some(StaticSzValue::String(value.value.to_string())),
        Expression::NumericLiteral(value) => Some(StaticSzValue::Number(value.value)),
        Expression::BooleanLiteral(value) => Some(StaticSzValue::Boolean(value.value)),
        Expression::UnaryExpression(unary) => {
            if unary.operator != UnaryOperator::UnaryNegation {
                return None;
            }
            let Expression::NumericLiteral(value) = &unary.argument else {
                return None;
            };
            Some(StaticSzValue::Number(-value.value))
        }
        Expression::ObjectExpression(object) => {
            Some(StaticSzValue::Object(static_szs_object(object)?))
        }
        _ => None,
    }
}

/// Convert an object only when every property is a non-computed,
/// identifier-keyed pure literal (see [`static_szs_value`]).
fn static_szs_object(object: &ObjectExpression<'_>) -> Option<StaticSzObject> {
    let mut properties = Vec::with_capacity(object.properties.len());
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(prop) = property else {
            return None;
        };
        if prop.computed {
            return None;
        }
        let PropertyKey::StaticIdentifier(identifier) = &prop.key else {
            return None;
        };
        merge_static_property(
            &mut properties,
            StaticSzProperty {
                key: identifier.name.to_string(),
                value: static_szs_value(&prop.value)?,
                span: text_span(prop.span),
            },
        );
    }
    Some(StaticSzObject { properties })
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
        JSXExpression::LogicalExpression(logical) => static_ternary_from_logical(logical, ctx),
        JSXExpression::Identifier(identifier) => {
            let initializer = ctx.scope.resolve_initializer_before(
                &identifier.name,
                identifier.span.start,
                ctx.program,
            )?;
            let (ternary, _) = static_ternary_from_expression(initializer, ctx)?;
            Some((ternary, text_span(identifier.span)))
        }
        JSXExpression::ParenthesizedExpression(value) => {
            static_ternary_from_expression(&value.expression, ctx)
        }
        JSXExpression::TSAsExpression(value) => {
            static_ternary_from_expression(&value.expression, ctx)
        }
        JSXExpression::TSSatisfiesExpression(value) => {
            static_ternary_from_expression(&value.expression, ctx)
        }
        JSXExpression::TSNonNullExpression(value) => {
            static_ternary_from_expression(&value.expression, ctx)
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
        Expression::LogicalExpression(logical) => static_ternary_from_logical(logical, ctx),
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

/// Lower one branch of a conditional sz value to the classes it contributes.
///
/// A falsy branch is the EMPTY style rather than an unknown one, so it folds
/// to no classes instead of dropping the whole attribute onto the runtime.
/// Reading only the object shape made `: undefined` and `: {}` — two spellings
/// of the same intent, and `undefined` is the one a typed style pushes authors
/// toward — compile to different code for no reason a caller could see.
fn conditional_branch_classes(
    expression: &Expression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<Vec<String>> {
    if is_falsy_style_literal(unwrap_expression(expression)) {
        return Some(Vec::new());
    }
    let (object, _, _) = static_object_from_expression(expression, ctx)?;
    Some(lower_static_sz_object(&object))
}

/// The depth a chained conditional is followed to.
///
/// A bound rather than a judgement about style: each arm adds a class list to
/// the IR and a nesting level to the emitted expression, and a chain long enough
/// to matter is better served by `szv()`. Past this the whole attribute keeps
/// the runtime path it had before, which is correct, just not folded.
const MAX_CONDITIONAL_CHAIN_ARMS: usize = 8;

fn static_ternary_from_conditional(
    conditional: &ConditionalExpression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<(StaticTernaryIr, TextSpan)> {
    // Follow `a ? X : b ? Y : Z` down its else side. Every arm has to lower for
    // the fold to happen: a chain is a choice, so a branch left unread would
    // mean emitting a conditional that can pick a class list the compiler never
    // saw.
    let mut arms = Vec::new();
    let mut alternate = &conditional.alternate;
    while let Expression::ConditionalExpression(next) = unwrap_expression(alternate) {
        if arms.len() == MAX_CONDITIONAL_CHAIN_ARMS {
            return None;
        }
        arms.push(super::StaticTernaryArmIr {
            test_span: text_span(next.test.span()),
            classes: conditional_branch_classes(&next.consequent, ctx)?,
        });
        alternate = &next.alternate;
    }
    Some((
        StaticTernaryIr {
            test_span: text_span(conditional.test.span()),
            consequent_classes: conditional_branch_classes(&conditional.consequent, ctx)?,
            alternate_classes: conditional_branch_classes(alternate, ctx)?,
            chain_arms: arms,
            bool_class_key: None,
        },
        text_span(conditional.span),
    ))
}

/// Lower `cond && { … }` to the ternary it already is.
///
/// `&&` yields its RIGHT operand when the test passes and its LEFT operand
/// otherwise — and a left operand that reached the else arm is falsy by
/// definition, so that arm is the empty style. `||` is refused for the mirror
/// reason: its left operand is what survives a TRUTHY test, and that value can
/// be a style object, so folding `base || { p: 4 }` would silently drop `base`.
fn static_ternary_from_logical(
    logical: &LogicalExpression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<(StaticTernaryIr, TextSpan)> {
    if !logical.operator.is_and() {
        return None;
    }
    Some((
        StaticTernaryIr {
            test_span: text_span(logical.left.span()),
            consequent_classes: conditional_branch_classes(&logical.right, ctx)?,
            alternate_classes: Vec::new(),
            chain_arms: Vec::new(),
            bool_class_key: None,
        },
        text_span(logical.span),
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
        if let Some(part) = static_array_part_from_expression(expression, ctx) {
            parts.push(part);
        }
    }

    Some(parts)
}

fn static_array_part_from_expression(
    expression: &Expression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<StaticArrayPartIr> {
    let unwrapped = unwrap_expression(expression);
    if is_falsy_style_literal(unwrapped) {
        return None;
    }
    if let Expression::StringLiteral(value) = unwrapped {
        return Some(static_array_part(split_class_tokens(&value.value), None));
    }
    let logical = match unwrapped {
        Expression::LogicalExpression(logical) if logical.operator.is_and() => Some(logical),
        _ => None,
    };
    if let Some(logical) = logical {
        let right = unwrap_expression(&logical.right);
        let classes = if let Expression::StringLiteral(value) = right {
            Some(split_class_tokens(&value.value))
        } else {
            array_element_static_object(right, ctx).map(|object| lower_static_sz_object(&object))
        };
        return match classes {
            None => Some({
                // Dynamic right side: the whole guarded element resolves at
                // runtime through `_szPart`.
                dynamic_array_part(expression, unwrapped, ctx)
            }),
            Some(classes) if classes.is_empty() => None,
            Some(classes) => Some(static_array_part(
                classes,
                Some(text_span(logical.left.span())),
            )),
        };
    }
    let conditional_part = match unwrapped {
        Expression::ConditionalExpression(conditional) => {
            static_array_ternary_from_conditional(conditional, ctx)
        }
        _ => None,
    }
    .map(|ternary| StaticArrayPartIr {
        condition_span: None,
        classes: Vec::new(),
        ternary: Some(ternary),
        dynamic_span: None,
        dynamic_provable: false,
        candidates: Vec::new(),
        dynamic_object_literal: false,
    });
    if conditional_part.is_some() {
        return conditional_part;
    }
    if let Some(object) = array_element_static_object(unwrapped, ctx) {
        return Some(static_array_part(lower_static_sz_object(&object), None));
    }
    let partial = match unwrapped {
        Expression::ObjectExpression(object) => {
            partial_object_from_object_expression(object, ctx, None, &[])
        }
        _ => None,
    };
    if let Some(mut partial) = partial
        .filter(|partial| partial.dynamic_css_vars.is_empty() && partial.ternaries.len() == 1)
    {
        // Array parts keep the single-ternary contract of StaticArrayPartIr;
        // multi-ternary parts stay on their existing runtime lane.
        return Some(StaticArrayPartIr {
            condition_span: None,
            classes: lower_static_sz_object(&partial.object),
            ternary: Some(partial.ternaries.remove(0)),
            dynamic_span: None,
            dynamic_provable: false,
            candidates: Vec::new(),
            dynamic_object_literal: false,
        });
    }
    // Safelist best-effort: static object literals reachable inside the
    // dynamic expression (ternary branches, etc.) still get their CSS.
    // An object literal that lands here carried a runtime value, so the
    // whole element defers to `_szPart` — flagged for a build diagnostic.
    Some(dynamic_array_part(expression, unwrapped, ctx))
}

const fn static_array_part(
    classes: Vec<String>,
    condition_span: Option<TextSpan>,
) -> StaticArrayPartIr {
    StaticArrayPartIr {
        condition_span,
        classes,
        ternary: None,
        dynamic_span: None,
        dynamic_provable: false,
        candidates: Vec::new(),
        dynamic_object_literal: false,
    }
}

/// Preserve one unresolved array element for runtime lowering and safelisting.
fn dynamic_array_part(
    expression: &Expression<'_>,
    unwrapped: &Expression<'_>,
    ctx: ResolveContext<'_>,
) -> StaticArrayPartIr {
    StaticArrayPartIr {
        condition_span: None,
        classes: Vec::new(),
        ternary: None,
        dynamic_span: Some(text_span(expression.span())),
        // Same safety vocabulary as the szr proof: a provably string-or-falsy
        // element never needs the object lowering at runtime.
        dynamic_provable: is_provably_non_object_argument(expression),
        candidates: candidate_classes_from_expression(expression, ctx),
        dynamic_object_literal: matches!(unwrapped, Expression::ObjectExpression(_)),
    }
}

/// Pre-lower a finite array-element ternary with static object or string branches.
fn static_array_ternary_from_conditional(
    conditional: &ConditionalExpression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<StaticTernaryIr> {
    let branch_classes = |branch: &Expression<'_>| {
        let unwrapped = unwrap_expression(branch);
        if let Expression::StringLiteral(value) = unwrapped {
            return Some(split_class_tokens(&value.value));
        }
        let (object, _, _) = static_object_from_expression(unwrapped, ctx)?;
        Some(lower_static_sz_object(&object))
    };
    Some(StaticTernaryIr {
        test_span: text_span(conditional.test.span()),
        consequent_classes: branch_classes(&conditional.consequent)?,
        alternate_classes: branch_classes(&conditional.alternate)?,
        chain_arms: Vec::new(),
        bool_class_key: None,
    })
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
/// Classify a runtime-fallback sz expression for the diagnostic matrix.
///
/// Mirrors the Babel lane's `describeRuntimeFallback` byte for byte, because a
/// `build.parser` flip must not change the build log:
///
/// - Parentheses are seen through (Babel's AST has no parenthesized nodes).
/// - TS wrappers are NOT seen through — Babel classifies `x as T` as
///   `other`/`TSAsExpression`, so this lane must too, even though the span
///   helpers below unwrap them for position purposes.
/// - A computed member callee reports the index identifier (`table[key]()` →
///   `` `key()` ``): Babel reads `callee.property` without checking
///   `computed`, and that shared quirk is pinned by the parity suite.
fn classify_runtime_fallback(
    expression: &JSXExpression<'_>,
    imported: &HashSet<String>,
) -> Option<super::RuntimeFallbackDiagnosticIr> {
    use super::RuntimeFallbackDiagnosticIr;

    let (kind, detail) = classify_expression_fallback(expression.as_expression()?, imported);
    // `path` stays empty until the post-walk pass finds the callee among the
    // refused szv factories — see
    // `name_disqualified_szv_factories_in_attributes`.
    Some(RuntimeFallbackDiagnosticIr {
        kind,
        detail,
        path: String::new(),
    })
}

/// Names that can never be szv factory bindings for the precompile.
const SZV_RESERVED_FACTORY_NAMES: [&str; 5] = ["szr", "szv", "dynamic", "__szvPick", "__szvPick1"];

/// Analyze one szr argument for the deferred proof.
fn analyze_szr_call_argument(argument: &Argument<'_>) -> SzrArgAnalysis {
    let Some(expression) = argument.as_expression() else {
        return SzrArgAnalysis {
            shape_ok: false,
            factory_spans: Vec::new(),
        };
    };
    let mut factory_spans = Vec::new();
    let shape_ok = analyze_szr_argument(expression, &mut factory_spans);
    SzrArgAnalysis {
        shape_ok,
        factory_spans,
    }
}

/// Analyze one szr argument expression: provably string-or-falsy, allowing
/// identifier factory calls as leaves.
///
/// Mirror of the JS lanes' walk. The collected factory spans are candidates
/// only — the argument is proven when the shape holds AND every collected
/// call was rewritten by the szv precompile.
fn analyze_szr_argument(expression: &Expression<'_>, factories: &mut Vec<super::TextSpan>) -> bool {
    let mut expression = expression;
    while let Expression::ParenthesizedExpression(inner) = expression {
        expression = &inner.expression;
    }
    match expression {
        Expression::CallExpression(call) => {
            if let Expression::Identifier(callee) = &call.callee {
                if !SZV_RESERVED_FACTORY_NAMES.contains(&callee.name.as_str()) {
                    factories.push(text_span(call.span()));
                    return true;
                }
            }
            false
        }
        Expression::StringLiteral(_)
        | Expression::TemplateLiteral(_)
        | Expression::NullLiteral(_) => true,
        Expression::BooleanLiteral(literal) => !literal.value,
        Expression::Identifier(identifier) => identifier.name == "undefined",
        Expression::LogicalExpression(logical) => match logical.operator {
            oxc_ast::ast::LogicalOperator::And => analyze_szr_argument(&logical.right, factories),
            _ => {
                analyze_szr_argument(&logical.left, factories)
                    && analyze_szr_argument(&logical.right, factories)
            }
        },
        Expression::ConditionalExpression(conditional) => {
            analyze_szr_argument(&conditional.consequent, factories)
                && analyze_szr_argument(&conditional.alternate, factories)
        }
        Expression::ArrayExpression(array) => array.elements.iter().all(|element| {
            element
                .as_expression()
                .is_some_and(|expression| analyze_szr_argument(expression, factories))
        }),
        _ => false,
    }
}

/// Whether one analyzed szr argument is fully proven: the shape held and
/// every factory candidate inside it was rewritten to a string.
fn szr_argument_proven(analysis: &SzrArgAnalysis, replaced_spans: &[super::TextSpan]) -> bool {
    analysis.shape_ok
        && analysis
            .factory_spans
            .iter()
            .all(|span| replaced_spans.contains(span))
}

/// Classify one potential factory call's argument shape.
///
/// Static selections carry only string/boolean/safe-integer literal values
/// (the tri-lane contract); everything else with exactly one argument splices
/// into `__szvPick`, and extra arguments disqualify (dropping them would drop
/// their evaluation).
fn classify_szv_call_argument(call: &CallExpression<'_>) -> Option<SzvCallArg> {
    match call.arguments.len() {
        0 => Some(SzvCallArg::None),
        1 => {
            let expression = call.arguments[0].as_expression()?;
            let unwrapped = unwrap_expression(expression);
            let single = if let Expression::ObjectExpression(object) = unwrapped {
                if let Some(selection) = strict_static_selection(object) {
                    return Some(SzvCallArg::Static(selection));
                }
                single_dimension_selection(object)
            } else {
                None
            };
            Some(SzvCallArg::Dynamic {
                span: text_span(unwrapped.span()),
                single,
            })
        }
        _ => None,
    }
}

/// Read a selection literal that names exactly one static dimension, e.g.
/// `F({ direction: dir })` — mirror of the JS lanes' `planSingleDimensionPick`
/// shape check. Whether the named key is a real dimension is decided later,
/// where the compiled table is in hand.
fn single_dimension_selection(object: &ObjectExpression<'_>) -> Option<SzvSingleDimension> {
    let [property] = object.properties.as_slice() else {
        return None;
    };
    let ObjectPropertyKind::ObjectProperty(entry) = property else {
        return None;
    };
    if entry.computed {
        return None;
    }
    // Identifier and string keys only. `static_property_key` also accepts a
    // NUMERIC key, which the JS lanes reject here — using it would let this
    // engine collapse a call the other two leave alone.
    let dimension = match &entry.key {
        PropertyKey::StaticIdentifier(identifier) => identifier.name.to_string(),
        PropertyKey::StringLiteral(string) => string.value.to_string(),
        _ => return None,
    };
    // `{ __proto__: v }` in a literal sets the PROTOTYPE instead of creating an
    // own property, so the full picker's own-property probe selects nothing.
    if dimension == "__proto__" {
        return None;
    }
    Some(SzvSingleDimension {
        dimension,
        value_span: text_span(entry.value.span()),
    })
}

/// Build the replacement text for one DYNAMIC factory call, preferring the
/// single-dimension picker whenever it reproduces the full one. Returns the
/// text and whether the single-dimension helper was the one emitted.
fn dynamic_szv_replacement(
    source: &str,
    table_ident: &str,
    table: &super::szv_precompile::SzvTable,
    span: super::TextSpan,
    single: Option<&SzvSingleDimension>,
) -> (String, bool) {
    if let Some(it) = single.filter(|it| single_dimension_pick_applies(table, &it.dimension)) {
        let value = &source[it.value_span.start as usize..it.value_span.end as usize];
        let dimension = super::szv_precompile::json_string_literal(&it.dimension);
        return (
            format!("__szvPick1({table_ident}, {dimension}, {value})"),
            true,
        );
    }
    let text = &source[span.start as usize..span.end as usize];
    (format!("__szvPick({table_ident}, {text})"), false)
}

/// Whether the single-dimension picker reproduces the full picker for one
/// table and dimension: no defaults (which make the OMITTED dimensions
/// contribute classes the single-dimension picker never visits), and the key is
/// a real dimension (so the unknown-variant dev warning keeps running through
/// the full picker).
fn single_dimension_pick_applies(table: &super::szv_precompile::SzvTable, dimension: &str) -> bool {
    if table
        .defaults
        .as_ref()
        .is_some_and(|pairs| !pairs.is_empty())
    {
        return false;
    }
    table.dimensions.iter().any(|(name, _)| name == dimension)
}

/// Evaluate a selection object literal under the tri-lane static contract.
fn strict_static_selection(
    object: &ObjectExpression<'_>,
) -> Option<super::szv_precompile::StaticSelection> {
    let mut selection: super::szv_precompile::StaticSelection = Vec::new();
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(entry) = property else {
            return None;
        };
        if entry.computed {
            return None;
        }
        let key = static_property_key(&entry.key)?;
        let value = match unwrap_expression(&entry.value) {
            Expression::StringLiteral(literal) => literal.value.to_string(),
            Expression::BooleanLiteral(literal) => literal.value.to_string(),
            Expression::NumericLiteral(literal) => {
                super::szv_precompile::parity_safe_scalar_string(&super::StaticSzValue::Number(
                    literal.value,
                ))?
            }
            Expression::UnaryExpression(unary) => {
                // Negated safe integers are part of the tri-lane contract.
                if unary.operator != UnaryOperator::UnaryNegation {
                    return None;
                }
                match unwrap_expression(&unary.argument) {
                    Expression::NumericLiteral(literal) => {
                        super::szv_precompile::parity_safe_scalar_string(
                            &super::StaticSzValue::Number(-literal.value),
                        )?
                    }
                    _ => return None,
                }
            }
            _ => return None,
        };
        selection.push((key, value));
    }
    Some(selection)
}

/// Evaluate an object expression under the literal-only vocabulary —
/// string/number/boolean literals, a negated number, nested objects; TS
/// wrappers and parentheses unwrap. Deliberately NOT the
/// identifier-resolving extractor: a broader evaluator here would qualify a
/// config the runtime lowering bails on.
///
/// `Err` names the first non-literal position as a dot-joined key path under
/// `prefix`, because one walk serves both the precompile's verdict and the
/// szr diagnostic that has to tell the author WHERE their config stopped
/// being static. A shape with no key to name — a spread, a computed key —
/// reports the object holding it.
fn strict_literal_object_diagnosed(
    object: &ObjectExpression<'_>,
    prefix: &str,
) -> Result<StaticSzObject, String> {
    let holder = || {
        if prefix.is_empty() {
            String::from("config")
        } else {
            prefix.to_string()
        }
    };
    let mut properties = Vec::new();
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(entry) = property else {
            return Err(holder());
        };
        if entry.computed {
            return Err(holder());
        }
        let Some(key) = static_property_key(&entry.key) else {
            return Err(holder());
        };
        let path = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{prefix}.{key}")
        };
        let value = strict_literal_value_diagnosed(&entry.value, &path)?;
        properties.push(super::StaticSzProperty {
            key,
            value,
            span: text_span(entry.span),
        });
    }
    Ok(StaticSzObject { properties })
}

/// One literal value for `strict_literal_object_diagnosed`.
fn strict_literal_value_diagnosed(
    expression: &Expression<'_>,
    path: &str,
) -> Result<StaticSzValue, String> {
    match unwrap_expression(expression) {
        Expression::StringLiteral(literal) => Ok(StaticSzValue::String(literal.value.to_string())),
        Expression::NumericLiteral(literal) => Ok(StaticSzValue::Number(literal.value)),
        Expression::BooleanLiteral(literal) => Ok(StaticSzValue::Boolean(literal.value)),
        Expression::UnaryExpression(unary) => {
            if unary.operator != UnaryOperator::UnaryNegation {
                return Err(path.to_string());
            }
            match unwrap_expression(&unary.argument) {
                Expression::NumericLiteral(literal) => Ok(StaticSzValue::Number(-literal.value)),
                _ => Err(path.to_string()),
            }
        }
        Expression::ObjectExpression(nested) => {
            strict_literal_object_diagnosed(nested, path).map(StaticSzValue::Object)
        }
        _ => Err(path.to_string()),
    }
}

/// Slim-entry target for a rewritable szr import source.
///
/// Same-package subpaths only, mirroring `SZR_IMPORT_REWRITE_TARGETS` in the
/// TypeScript lanes: an app importing from `csszyx` may not resolve
/// `@csszyx/runtime` under strict node_modules layouts.
fn szr_rewrite_target(source: &str) -> Option<&'static str> {
    match source {
        "@csszyx/runtime" => Some("@csszyx/runtime/core"),
        "csszyx" => Some("csszyx/core"),
        _ => None,
    }
}

/// True when the byte continues an identifier around `szr`.
const fn is_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$'
}

/// Subtract in-comment occurrences from a raw word count.
///
/// Mirrors `countWordOccurrencesOutsideComments` in the TypeScript lanes:
/// comments are erased at runtime, so a doc comment mentioning a factory (or
/// `szr`) must not fail the reference accounting. The spans come from the
/// parser, delimiters included; subtraction per span is exact because comment
/// delimiters are non-identifier characters, so no word straddles a span
/// edge.
fn subtract_comment_occurrences<F: Fn(&str) -> usize>(
    count: usize,
    source: &str,
    comments: &oxc_allocator::Vec<'_, oxc_ast::ast::Comment>,
    counter: F,
) -> usize {
    let mut count = count;
    for comment in comments {
        let slice = &source[comment.span.start as usize..comment.span.end as usize];
        count = count.saturating_sub(counter(slice));
    }
    count
}

/// Count word-boundary occurrences of `szr` in the raw source.
///
/// Mirrors `countSzrWordOccurrences` in the TypeScript lanes byte for byte: a
/// boundary is "not an ASCII identifier character", so a non-ASCII identifier
/// continuation still counts — an overcount, which can only fail the proof.
fn count_szr_word_occurrences(source: &str) -> usize {
    let bytes = source.as_bytes();
    let mut count = 0;
    let mut at = 0;
    while at + 3 <= bytes.len() {
        if &bytes[at..at + 3] == b"szr" {
            let before_ok = at == 0 || !is_identifier_byte(bytes[at - 1]);
            let after_ok = at + 3 == bytes.len() || !is_identifier_byte(bytes[at + 3]);
            if before_ok && after_ok {
                count += 1;
            }
            at += 3;
        } else {
            at += 1;
        }
    }
    count
}

/// Whether an expression can never evaluate to a truthy non-string.
///
/// Mirror of the JS lanes' check: string/template literals, `false`, `null`,
/// `undefined`, `&&` with a safe right side (a falsy left short-circuits to a
/// skipped falsy), `||`/`??`/ternary with all reachable results safe, arrays
/// of safe elements. Parentheses are seen through (Babel's AST has no node for
/// them); anything else — TS wrappers included — is unsafe, so the proof only
/// errs toward keeping today's import.
fn is_provably_non_object_argument(expression: &Expression<'_>) -> bool {
    let mut expression = expression;
    while let Expression::ParenthesizedExpression(inner) = expression {
        expression = &inner.expression;
    }
    match expression {
        Expression::StringLiteral(_)
        | Expression::TemplateLiteral(_)
        | Expression::NullLiteral(_) => true,
        Expression::BooleanLiteral(literal) => !literal.value,
        Expression::Identifier(identifier) => identifier.name == "undefined",
        Expression::LogicalExpression(logical) => match logical.operator {
            oxc_ast::ast::LogicalOperator::And => is_provably_non_object_argument(&logical.right),
            _ => {
                is_provably_non_object_argument(&logical.left)
                    && is_provably_non_object_argument(&logical.right)
            }
        },
        Expression::ConditionalExpression(conditional) => {
            is_provably_non_object_argument(&conditional.consequent)
                && is_provably_non_object_argument(&conditional.alternate)
        }
        Expression::ArrayExpression(array) => array.elements.iter().all(|element| {
            element
                .as_expression()
                .is_some_and(is_provably_non_object_argument)
        }),
        _ => false,
    }
}

/// Classify an expression into the shared matrix vocabulary.
///
/// Parentheses are seen through (Babel's AST has no node for them); TS wrappers
/// Every local name this module introduced with an import, any form.
///
/// Named, default and namespace alike: what decides the diagnostic is only
/// that the binding comes from another module, not which form brought it in.
fn collect_imported_names(program: &Program<'_>) -> HashSet<String> {
    let mut names = HashSet::new();
    for statement in &program.body {
        let Statement::ImportDeclaration(declaration) = statement else {
            continue;
        };
        let Some(specifiers) = &declaration.specifiers else {
            continue;
        };
        for specifier in specifiers {
            let local = match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(entry) => &entry.local.name,
                ImportDeclarationSpecifier::ImportDefaultSpecifier(default) => &default.local.name,
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(namespace) => {
                    &namespace.local.name
                }
            };
            names.insert(local.to_string());
        }
    }
    names
}

/// The imported binding an unresolved expression roots in, when it has one.
///
/// A member expression is judged by its ROOT object, so `S.cardSz` on a
/// namespace import counts while `props.sz` does not. Parentheses are already
/// gone by the time this is asked: the caller unwraps them so that its own
/// position reporting matches Babel's, which has no such node.
fn imported_root_name(expression: &Expression<'_>, imported: &HashSet<String>) -> Option<String> {
    let mut current = expression;
    loop {
        current = match current {
            Expression::StaticMemberExpression(member) => &member.object,
            Expression::ComputedMemberExpression(member) => &member.object,
            Expression::Identifier(identifier) => {
                let name = identifier.name.as_str();
                return imported.contains(name).then(|| name.to_string());
            }
            _ => return None,
        };
    }
}

/// are NOT, because Babel classifies those as `other`.
fn classify_expression_fallback(
    expression: &Expression<'_>,
    imported: &HashSet<String>,
) -> (super::RuntimeFallbackKindIr, String) {
    use super::RuntimeFallbackKindIr;

    let mut expression = expression;
    while let Expression::ParenthesizedExpression(inner) = expression {
        expression = &inner.expression;
    }

    if let Some(name) = imported_root_name(expression, imported) {
        // An import names a module-level value this build tried to read and
        // could not, so nothing collected its classes. Everything below is
        // usually a prop the caller supplies, collected where it is written.
        return (RuntimeFallbackKindIr::Import, name);
    }

    let (kind, detail) = match expression {
        Expression::CallExpression(call) => {
            let callee_name = match &call.callee {
                Expression::Identifier(identifier) => identifier.name.as_str(),
                Expression::StaticMemberExpression(member) => member.property.name.as_str(),
                Expression::ComputedMemberExpression(member) => match &member.expression {
                    Expression::Identifier(identifier) => identifier.name.as_str(),
                    _ => super::generated::sz_fallback_matrix::SZ_FALLBACK_UNKNOWN_CALLEE,
                },
                _ => super::generated::sz_fallback_matrix::SZ_FALLBACK_UNKNOWN_CALLEE,
            };
            (RuntimeFallbackKindIr::Call, callee_name.to_string())
        }
        Expression::Identifier(identifier) => (
            RuntimeFallbackKindIr::Identifier,
            identifier.name.to_string(),
        ),
        Expression::StaticMemberExpression(_)
        | Expression::ComputedMemberExpression(_)
        | Expression::PrivateFieldExpression(_) => (RuntimeFallbackKindIr::Member, String::new()),
        other => (
            RuntimeFallbackKindIr::Other,
            estree_expression_type_name(other).to_string(),
        ),
    };
    (kind, detail)
}

/// Resolve the position Babel reports after discarding grouping parentheses.
fn fallback_expression_offset(expression: &Expression<'_>) -> u32 {
    let mut expression = expression;
    while let Expression::ParenthesizedExpression(inner) = expression {
        expression = &inner.expression;
    }
    // oxc may preserve the OUTER parentheses in a call's span even after
    // `Argument::as_expression()` yields the call node. The callee starts where
    // Babel's parenthesis-free CallExpression starts; for `(cond ? a : b)()`,
    // the callee span still correctly begins at that grouping parenthesis.
    match expression {
        Expression::CallExpression(call) => call.callee.span().start,
        other => other.span().start,
    }
}

/// Babel-compatible node type name for the `other` matrix arm.
///
/// Curated to the shapes a real sz attribute can carry; the audited ones
/// (TSAsExpression, TSNonNullExpression, ObjectExpression, NewExpression,
/// LogicalExpression, ConditionalExpression, TemplateLiteral, AwaitExpression)
/// are pinned against Babel by tests. Anything exotic falls back to a generic
/// name rather than leaking oxc's internal variant vocabulary.
const fn estree_expression_type_name(expression: &Expression<'_>) -> &'static str {
    match expression {
        Expression::ObjectExpression(_) => "ObjectExpression",
        Expression::ArrayExpression(_) => "ArrayExpression",
        Expression::TemplateLiteral(_) => "TemplateLiteral",
        Expression::ConditionalExpression(_) => "ConditionalExpression",
        Expression::LogicalExpression(_) => "LogicalExpression",
        Expression::AwaitExpression(_) => "AwaitExpression",
        Expression::NewExpression(_) => "NewExpression",
        Expression::BinaryExpression(_) => "BinaryExpression",
        Expression::UnaryExpression(_) => "UnaryExpression",
        Expression::UpdateExpression(_) => "UpdateExpression",
        Expression::AssignmentExpression(_) => "AssignmentExpression",
        Expression::SequenceExpression(_) => "SequenceExpression",
        Expression::TaggedTemplateExpression(_) => "TaggedTemplateExpression",
        Expression::ArrowFunctionExpression(_) => "ArrowFunctionExpression",
        Expression::FunctionExpression(_) => "FunctionExpression",
        Expression::ClassExpression(_) => "ClassExpression",
        Expression::ThisExpression(_) => "ThisExpression",
        Expression::ChainExpression(_) => "ChainExpression",
        Expression::YieldExpression(_) => "YieldExpression",
        Expression::MetaProperty(_) => "MetaProperty",
        Expression::TSAsExpression(_) => "TSAsExpression",
        Expression::TSSatisfiesExpression(_) => "TSSatisfiesExpression",
        Expression::TSNonNullExpression(_) => "TSNonNullExpression",
        Expression::TSTypeAssertion(_) => "TSTypeAssertion",
        Expression::TSInstantiationExpression(_) => "TSInstantiationExpression",
        Expression::BooleanLiteral(_) => "BooleanLiteral",
        Expression::NumericLiteral(_) => "NumericLiteral",
        Expression::StringLiteral(_) => "StringLiteral",
        Expression::NullLiteral(_) => "NullLiteral",
        Expression::BigIntLiteral(_) => "BigIntLiteral",
        Expression::RegExpLiteral(_) => "RegExpLiteral",
        Expression::JSXElement(_) => "JSXElement",
        Expression::JSXFragment(_) => "JSXFragment",
        _ => "Expression",
    }
}

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

/// Returns true when an `sz` expression is an object literal carrying a
/// top-level spread (`sz={{ ...x }}`). This is the unresolvable-spread shape
/// that forces a runtime fallback the static layer can't evaluate — flagged so
/// a build-log diagnostic can surface it, distinct from other fallback shapes
/// (e.g. a dynamic value-object sub-field) which must not warn.
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

#[allow(clippy::too_many_lines)]
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
                        // Nested object under a PROPERTY key (`bg: { … }`) that
                        // is not fully static: walk it WITH the parent key. The
                        // old keyless walk compiled `color: 'black'` as a bare
                        // `{ color }` → a junk `text-black` candidate, while the
                        // class the runtime actually produces (`bg-black/30`)
                        // never reached the safelist.
                        Expression::ObjectExpression(nested) => {
                            if let Some(ternary) =
                                color_opacity_ternary_from_object(&key, nested, ctx, variant_keys)
                            {
                                classes.extend(ternary.consequent_classes);
                                classes.extend(
                                    ternary.chain_arms.into_iter().flat_map(|arm| arm.classes),
                                );
                                classes.extend(ternary.alternate_classes);
                            } else {
                                classes.extend(candidate_classes_from_keyed_object(
                                    std::slice::from_ref(&key),
                                    nested,
                                    ctx,
                                    variant_keys,
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

/// Best-effort candidates for a nested object under a chain of PROPERTY keys:
/// each resolvable leaf (and each static conditional branch) compiles at its
/// full key path, so `bg: { color: 'black' }` yields `bg-black`, never a
/// keyless junk `text-black`. Unresolvable members are skipped — candidates
/// are a safelist best-effort for runtime-fallback shapes, which always carry
/// a build diagnostic.
fn candidate_classes_from_keyed_object(
    path: &[String],
    object: &ObjectExpression<'_>,
    ctx: ResolveContext<'_>,
    variant_keys: &[String],
) -> Vec<String> {
    fn leaf_classes(path: &[String], value: StaticSzValue, variant_keys: &[String]) -> Vec<String> {
        let mut wrapped = value;
        for key in path.iter().skip(1).rev() {
            wrapped = StaticSzValue::Object(StaticSzObject {
                properties: vec![StaticSzProperty {
                    key: key.clone(),
                    span: TextSpan { start: 0, end: 0 },
                    value: wrapped,
                }],
            });
        }
        conditional_property_classes(&path[0], wrapped, variant_keys)
    }

    let mut classes = Vec::new();
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(prop) = property else {
            continue;
        };
        let Some(sub_key) = static_property_key(&prop.key) else {
            continue;
        };
        let mut next_path = path.to_vec();
        next_path.push(sub_key);
        match unwrap_expression(&prop.value) {
            Expression::ObjectExpression(nested) => {
                classes.extend(candidate_classes_from_keyed_object(
                    &next_path,
                    nested,
                    ctx,
                    variant_keys,
                ));
            }
            Expression::ConditionalExpression(conditional) => {
                for branch in [&conditional.consequent, &conditional.alternate] {
                    if let Some(value) = static_value_from_expression(branch, ctx) {
                        classes.extend(leaf_classes(
                            &next_path[..next_path.len() - 1],
                            StaticSzValue::Object(StaticSzObject {
                                properties: vec![StaticSzProperty {
                                    key: next_path[next_path.len() - 1].clone(),
                                    span: TextSpan { start: 0, end: 0 },
                                    value,
                                }],
                            }),
                            variant_keys,
                        ));
                    }
                }
            }
            _ => {
                if let Some(value) = static_value_from_expression(&prop.value, ctx) {
                    classes.extend(leaf_classes(
                        &next_path[..next_path.len() - 1],
                        StaticSzValue::Object(StaticSzObject {
                            properties: vec![StaticSzProperty {
                                key: next_path[next_path.len() - 1].clone(),
                                span: TextSpan { start: 0, end: 0 },
                                value,
                            }],
                        }),
                        variant_keys,
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

/// The registry name a default import resolves against.
///
/// Spelled the same in `cross-module-extract.ts`, which files the entry. The
/// two are not generated from one source because this is not project wording
/// that can drift: `default` is what ECMAScript calls the slot, and a module
/// that renamed it would no longer be describing a default export.
const DEFAULT_EXPORT_SLOT: &str = "default";

/// Narrow the bundler's sz-object registry to this file's LOCAL binding names.
///
/// Resolved once per file rather than per reference: identifier lowering is
/// then a single lookup, and a file importing nothing the registry carries
/// pays one pass over the module's top level.
///
/// The registry is keyed by EXPORT name while the code writes the LOCAL one,
/// so every specifier must be read through. Matching a local name against the
/// registry would resolve the wrong entry the moment an alias makes the two
/// differ.
///
/// A named or default value import resolves; a namespace or type-only import
/// keeps the runtime path it has today rather than being guessed at.
fn collect_imported_sz_objects(
    program: &Program<'_>,
    registry: &super::szv_precompile::CrossModuleSzObjects,
) -> Vec<(String, StaticSzObject)> {
    let mut out = Vec::new();
    if registry.is_empty() {
        return out;
    }
    for statement in &program.body {
        let Statement::ImportDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.import_kind.is_type() {
            continue;
        }
        let source_value = declaration.source.value.as_str();
        let Some((_, entries)) = registry
            .iter()
            .find(|(specifier, _)| specifier == source_value)
        else {
            continue;
        };
        let Some(specifiers) = &declaration.specifiers else {
            continue;
        };
        for entry in specifiers {
            // The name to look the registry up by, paired with the local name
            // the file refers to it as. A default import names no export at
            // all, so it resolves against the slot the extractor files
            // `export default` under; every other form asks for what it wrote.
            let (imported, local) = match entry {
                ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
                    if specifier.import_kind.is_type() {
                        continue;
                    }
                    (specifier.imported.name().to_string(), &specifier.local.name)
                }
                ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                    (DEFAULT_EXPORT_SLOT.to_string(), &specifier.local.name)
                }
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(_) => continue,
            };
            let Some((_, object)) = entries.iter().find(|(name, _)| name.as_str() == imported)
            else {
                continue;
            };
            out.push((local.as_str().to_string(), object.clone()));
        }
    }
    out
}

/// Collect namespace imports of modules the registry carries.
///
/// A namespace binding stands for the module's whole export map, so it is
/// recorded as ONE object whose properties are the exports. That is what makes
/// `T.LAYER.modal` fall out of the reads that already work: the first hop
/// yields the export, and every hop after it is an ordinary map read.
///
/// Kept in its own table rather than added to the sz-object one, and the
/// separation is the safety property. Namespaces are consulted only where a
/// member expression reads THROUGH them; putting them in the object table
/// would make `sz={T}` lower a module's export map as a style, turning export
/// names into utility keys and emitting classes for a shape nobody wrote.
fn collect_imported_namespaces(
    program: &Program<'_>,
    registry: &super::szv_precompile::CrossModuleSzObjects,
) -> Vec<(String, StaticSzObject)> {
    let mut out = Vec::new();
    if registry.is_empty() {
        return out;
    }
    for statement in &program.body {
        let Statement::ImportDeclaration(declaration) = statement else {
            continue;
        };
        if declaration.import_kind.is_type() {
            continue;
        }
        let source_value = declaration.source.value.as_str();
        let Some((_, entries)) = registry
            .iter()
            .find(|(specifier, _)| specifier == source_value)
        else {
            continue;
        };
        let Some(specifiers) = &declaration.specifiers else {
            continue;
        };
        for entry in specifiers {
            let ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) = entry else {
                continue;
            };
            let module = StaticSzObject {
                properties: entries
                    .iter()
                    .map(|(name, object)| StaticSzProperty {
                        key: name.clone(),
                        value: StaticSzValue::Object(object.clone()),
                        span: TextSpan { start: 0, end: 0 },
                    })
                    .collect(),
            };
            out.push((specifier.local.name.as_str().to_string(), module));
        }
    }
    out
}

/// The module a namespace binding stands for, when an expression is that bare
/// binding and nothing in this file has shadowed it.
///
/// Scope is asked FIRST and a local binding wins outright, even one whose value
/// is not static. Without that, a local `const T` that resolves to nothing
/// would fall through and let the imported module answer for a name the code
/// does not read.
fn imported_namespace_object(
    expression: &Expression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<StaticSzValue> {
    let Expression::Identifier(identifier) = expression else {
        return None;
    };
    if ctx
        .scope
        .resolve_initializer_before(&identifier.name, identifier.span.start, ctx.program)
        .is_some()
    {
        return None;
    }
    ctx.imported_namespaces
        .iter()
        .find(|(local, _)| local == identifier.name.as_str())
        .map(|(_, module)| StaticSzValue::Object(module.clone()))
}

/// The imported static sz object a local binding name stands for, if the
/// bundler's registry carried one for this file.
fn imported_sz_object<'a>(
    imports: &'a [(String, StaticSzObject)],
    name: &str,
) -> Option<&'a StaticSzObject> {
    imports
        .iter()
        .find(|(local, _)| local == name)
        .map(|(_, object)| object)
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
            // The same-file binding is asked first, so a local declaration of
            // the name wins over an import of it without the two needing to be
            // ordered by hand — a local const is what the code refers to.
            if let Some(initializer) = ctx.scope.resolve_initializer_before(
                &identifier.name,
                identifier.span.start,
                ctx.program,
            ) {
                let (object, _, rewrites_empty_class) =
                    static_object_from_expression(initializer, ctx)?;
                return Some((object, text_span(identifier.span), rewrites_empty_class));
            }
            let object = imported_sz_object(ctx.imported_sz_objects, &identifier.name)?.clone();
            let rewrites_empty_class = object.is_empty();
            Some((object, text_span(identifier.span), rewrites_empty_class))
        }
        // `sz={S.cardSz}` — one style read off a map, whether that map is a
        // namespace import or a local constant. The value resolver already
        // knows how to perform the read; all this arm adds is accepting an
        // object as the whole attribute. A read that lands on anything other
        // than an object is refused, so a number or a string cannot be
        // stringified into a class list.
        JSXExpression::StaticMemberExpression(member) => {
            let StaticSzValue::Object(object) = static_value_from_member(member, ctx)? else {
                return None;
            };
            let rewrites_empty_class = object.is_empty();
            Some((object, text_span(member.span), rewrites_empty_class))
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
    /// Property-level conditionals in source order — each lowers to one
    /// appended `${cond ? "…" : "…"}` template segment.
    ternaries: Vec<StaticTernaryIr>,
    dropped_dynamic_keys: Vec<DroppedSzKeyIr>,
}

type PartialObjectResult = (
    StaticSzObject,
    TextSpan,
    Vec<DynamicCssVarIr>,
    Vec<StaticTernaryIr>,
    Vec<DroppedSzKeyIr>,
);

fn partial_object_from_jsx_expression(
    expression: &JSXExpression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<PartialObjectResult> {
    match expression {
        JSXExpression::ObjectExpression(object) => {
            let partial = partial_object_from_object_expression(object, ctx, None, &[])?;
            Some((
                partial.object,
                text_span(object.span),
                partial.dynamic_css_vars,
                partial.ternaries,
                partial.dropped_dynamic_keys,
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
) -> Option<PartialObjectResult> {
    match expression {
        Expression::ObjectExpression(object) => {
            let partial = partial_object_from_object_expression(object, ctx, None, &[])?;
            Some((
                partial.object,
                text_span(object.span),
                partial.dynamic_css_vars,
                partial.ternaries,
                partial.dropped_dynamic_keys,
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

/// Record a dynamic property that must emit neither a class nor a variable.
///
/// The two callers drop for unrelated reasons and at deliberately different
/// points in the walk — a removed key is refused before any value shape is
/// examined, while a var-hostile key is refused only after the static and
/// conditional lanes have declined, so a fully static conditional on such a key
/// still compiles. Only the recording is shared.
fn drop_dynamic_key(
    partial: &mut PartialSzObject,
    key: String,
    property: &ObjectProperty<'_>,
    reason: DroppedKeyReason,
) {
    partial.dropped_dynamic_keys.push(DroppedSzKeyIr {
        key,
        span: text_span(property.span),
        reason,
    });
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
                ternaries: vec![ternary],
                dropped_dynamic_keys: Vec::new(),
            });
        }
    }

    let mut partial = PartialSzObject {
        object: StaticSzObject {
            properties: Vec::with_capacity(object.properties.len()),
        },
        dynamic_css_vars: Vec::new(),
        ternaries: Vec::new(),
        dropped_dynamic_keys: Vec::new(),
    };

    for property in &object.properties {
        match property {
            ObjectPropertyKind::ObjectProperty(property) => {
                if is_skippable_static_value(&property.value) {
                    continue;
                }
                if let Some(static_property) = static_property_from_object_property(property, ctx) {
                    partial.object.properties.push(static_property);
                    continue;
                }

                let key = static_property_key(&property.key)?;
                if is_removed_sz_key(&key) {
                    // Retain only diagnostic identity: no class or CSS variable
                    // may be emitted, while a literal false was skipped above
                    // and remains silent like the runtime path.
                    drop_dynamic_key(&mut partial, key, property, DroppedKeyReason::RemovedKey);
                    continue;
                }
                if let Expression::ObjectExpression(nested) = &property.value {
                    collect_nested_partial_property(
                        &mut partial,
                        key,
                        property,
                        nested,
                        ctx,
                        variant_prefix,
                        variant_keys,
                    )?;
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
                        set_partial_ternary(&mut partial, conditional_ternary);
                        if let Some(dynamic_prop) = dynamic_prop {
                            partial.dynamic_css_vars.push(dynamic_prop);
                        }
                        continue;
                    }
                    if let Some(conditional_ternary) =
                        conditional_class_from_property(&key, conditional, ctx, variant_keys)
                    {
                        set_partial_ternary(&mut partial, conditional_ternary);
                        continue;
                    }
                }

                if !is_runtime_expression(&property.value) {
                    return None;
                }

                // A key whose literal vocabulary is a boolean has no usable
                // css-var form: React drops booleans in `style`, so the
                // variable is never set, and the valued utility resolves to a
                // different CSS property than the bare class. Lower the value
                // as a conditional class through the runtime helper instead.
                if let Some(ternary) = bool_class_ternary_from_property(
                    &key,
                    text_span(unwrap_expression(&property.value).span()),
                    variant_keys,
                ) {
                    set_partial_ternary(&mut partial, ternary);
                    continue;
                }

                // A key Tailwind has no `-(--var)` utility for cannot take the
                // css-var lane at all: the class it would carry either matches
                // nothing or resolves to a different CSS property. Drop both
                // the class and the variable and let the engine report it —
                // emitting a dead class beside a warning is the shape that
                // made removed aliases look like they still worked.
                if super::var_hostile::is_var_hostile_dynamic(&key) {
                    drop_dynamic_key(&mut partial, key, property, DroppedKeyReason::NoVarForm);
                    continue;
                }

                // Slice the UNWRAPPED expression span: `sz={{ p: (pad) }}` must
                // emit `calc(${pad} …)` like the JS engines, not `calc(${(pad)} …)`
                // — redundant parens broke rust==oxc byte parity.
                partial.dynamic_css_vars.push(dynamic_css_var_from_property(
                    &key,
                    text_span(unwrap_expression(&property.value).span()),
                    variant_prefix,
                ));
            }
            ObjectPropertyKind::SpreadProperty(spread) => {
                partial
                    .object
                    .properties
                    .extend(static_object_from_spread_argument(&spread.argument, ctx)?.properties);
            }
        }
    }

    // A single conditional prop may coexist with static properties AND runtime
    // css vars (e.g. `{ w: width, h: 'max', flex: cond ? flex : undefined }`):
    // statics lower to literal classes, each runtime var contributes its
    // `<prefix>-(--_sz-*)` class plus a style prop, and the conditional becomes
    // a runtime ternary appended in a template literal — the same shape the
    // Babel build-time output emits. This mix used to be punted to the runtime
    // fallback, which never safelists the dynamic utilities: Tailwind emitted
    // no CSS for them and the styling silently never applied (field-reported).
    Some(partial)
}

/// Merge one nested variant/value object into an in-progress partial object.
fn collect_nested_partial_property(
    partial: &mut PartialSzObject,
    key: String,
    property: &ObjectProperty<'_>,
    nested: &ObjectExpression<'_>,
    ctx: ResolveContext<'_>,
    variant_prefix: Option<&str>,
    variant_keys: &[String],
) -> Option<()> {
    if let Some(ternary) = color_opacity_ternary_from_object(&key, nested, ctx, variant_keys) {
        set_partial_ternary(partial, ternary);
        return Some(());
    }

    // Value objects with a dynamic sub-field cannot be lowered as variants:
    // doing so would emit a dead `<property>:<subkey>` class. True variant keys
    // are absent from the property table and remain safe to recurse through.
    if super::generated::tables::property_prefix(&key).is_some() || key == "css" {
        return None;
    }
    let variant = variant_prefix_string(variant_prefix, &key);
    let mut next_keys = variant_keys.to_vec();
    next_keys.push(key.clone());
    let nested =
        partial_object_from_object_expression(nested, ctx, Some(variant.as_str()), &next_keys)?;
    if !nested.object.is_empty() {
        partial.object.properties.push(StaticSzProperty {
            key,
            span: text_span(property.span),
            value: StaticSzValue::Object(nested.object),
        });
    }
    partial.dynamic_css_vars.extend(nested.dynamic_css_vars);
    partial
        .dropped_dynamic_keys
        .extend(nested.dropped_dynamic_keys);
    for ternary in nested.ternaries {
        set_partial_ternary(partial, ternary);
    }
    Some(())
}

/// Append one property-level conditional, preserving source property order —
/// the rewrite emits one template segment per entry in this order, and class
/// discovery order (which fixes production mangle IDs) follows it.
fn set_partial_ternary(partial: &mut PartialSzObject, ternary: StaticTernaryIr) {
    partial.ternaries.push(ternary);
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
        chain_arms: Vec::new(),
        bool_class_key: None,
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
        chain_arms: Vec::new(),
        bool_class_key: None,
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
                chain_arms: Vec::new(),
                bool_class_key: None,
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
            // A boolean-only key has no css-var form to guard with a companion
            // conditional. Decline the whole shape so the caller lowers the
            // conditional itself as the helper's argument: `undefined` there
            // resolves to no class, which is what this branch encodes anyway.
            if super::generated::tables::is_boolean_only_dynamic(key) {
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
            chain_arms: Vec::new(),
            bool_class_key: None,
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
                chain_arms: Vec::new(),
                bool_class_key: None,
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
                chain_arms: Vec::new(),
                bool_class_key: None,
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

/// Lower a runtime value on a boolean-only key into a conditional bare class,
/// or `None` when the key takes real values and keeps the css-var lane.
///
/// `test_span` carries the runtime value rather than a condition: the rewrite
/// passes it to `__szBoolClass`, which returns the class for `true`, nothing
/// for the absent shapes, and warns for anything else.
fn bool_class_ternary_from_property(
    key: &str,
    expression_span: TextSpan,
    variant_keys: &[String],
) -> Option<StaticTernaryIr> {
    if !super::generated::tables::is_boolean_only_dynamic(key) {
        return None;
    }
    Some(StaticTernaryIr {
        test_span: expression_span,
        consequent_classes: conditional_property_classes(
            key,
            StaticSzValue::Boolean(true),
            variant_keys,
        ),
        alternate_classes: Vec::new(),
        chain_arms: Vec::new(),
        bool_class_key: Some(key.to_string()),
    })
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

pub fn dynamic_css_var_category(key: &str) -> DynamicCssVarCategory {
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
        let key = existing.key.clone();
        match (&mut existing.value, incoming.value) {
            (StaticSzValue::Object(existing_object), StaticSzValue::Object(incoming_object)) => {
                drop_displaced_sub_keys(&key, existing_object, &incoming_object);
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

/// Sub-keys of one property that write the SAME CSS custom property, so only
/// one group can be live at a time. Mirrors the TypeScript
/// `EXCLUSIVE_SUB_KEY_GROUPS`: inside `maskLinear` the angle fields and the
/// side fields both write `--tw-mask-linear`.
const EXCLUSIVE_SUB_KEY_GROUPS: [(&str, [&[&str]; 2]); 1] = [(
    "maskLinear",
    [&["angle", "from", "to"], &["t", "r", "b", "l", "x", "y"]],
)];

/// Clear the group the incoming object displaced, so "last write wins" holds
/// for the CSS property rather than for each field independently.
fn drop_displaced_sub_keys(key: &str, existing: &mut StaticSzObject, incoming: &StaticSzObject) {
    let Some((_, groups)) = EXCLUSIVE_SUB_KEY_GROUPS
        .iter()
        .find(|(name, _)| *name == key)
    else {
        return;
    };
    let claimed = groups.iter().find(|group| {
        incoming
            .properties
            .iter()
            .any(|property| group.contains(&property.key.as_str()))
    });
    let Some(claimed) = claimed else {
        return;
    };
    for group in groups {
        if std::ptr::eq(*group, *claimed) {
            continue;
        }
        existing
            .properties
            .retain(|property| !group.contains(&property.key.as_str()));
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
/// Whether an expression is a falsy literal, and therefore the EMPTY style.
///
/// Every falsy JS value reaches `_sz` as no classes at all, so an sz position
/// holding one carries the same information as `{}`. Callers must unwrap
/// parentheses and TS assertions first.
fn is_falsy_style_literal(expression: &Expression<'_>) -> bool {
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
        if is_falsy_style_literal(unwrapped) {
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
        //
        // A local declaration is asked first and its answer is FINAL, even when
        // that answer is "not static". Falling through to the registry after a
        // local binding was found would let an import of the same name answer
        // for a value the code does not read — the local-wins rule the
        // attribute path already keeps, applied on the route that reaches these
        // names through a property value instead.
        Expression::Identifier(identifier) => {
            if let Some(initializer) = ctx.scope.resolve_initializer_before(
                &identifier.name,
                identifier.span.start,
                ctx.program,
            ) {
                return static_value_from_expression(initializer, ctx);
            }
            // The bundler already narrowed the registry to this file's local
            // binding names, so an import resolves with one lookup and the
            // member arm below reads through it exactly as it reads a local map.
            imported_sz_object(ctx.imported_sz_objects, &identifier.name)
                .map(|object| StaticSzValue::Object(object.clone()))
        }
        // A value read off a constant map, e.g. `{ z: LAYER.appChrome }`.
        Expression::StaticMemberExpression(member) => static_value_from_member(member, ctx),
        _ => None,
    }
}

/// Read one named property off a map that resolves at build time.
///
/// Its own function because two callers need the same read: a property VALUE
/// like `{ z: LAYER.modal }`, and a whole attribute like `sz={S.cardSz}`. One
/// implementation is what keeps the two from disagreeing about which reads are
/// answerable.
///
/// Only a named property. `LAYER[key]` picks its key at run time, and no
/// build-time read of the map can be right.
fn static_value_from_member(
    member: &oxc_ast::ast::StaticMemberExpression<'_>,
    ctx: ResolveContext<'_>,
) -> Option<StaticSzValue> {
    // Resolving the object half reuses the identifier arm, so a map reaches
    // this point exactly when the bare identifier would have; all that is
    // added is the read. The namespace table is asked only after that ordinary
    // resolution has declined, so a local or named-imported map is always what
    // answers when one exists.
    let object = static_value_from_expression(&member.object, ctx)
        .or_else(|| imported_namespace_object(&member.object, ctx))?;
    match object {
        // Last match, not first: duplicate keys are kept in source order on
        // purpose, and the later one is what JavaScript reads. A property the
        // map does not carry resolves to nothing rather than to a guess, which
        // leaves the caller on the runtime path.
        StaticSzValue::Object(object) => object
            .properties
            .into_iter()
            .rev()
            .find(|property| property.key == member.property.name.as_str())
            .map(|property| property.value),
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
    use super::{
        escape_json_string, parse_source_shell, parse_source_shell_with_budget,
        parse_source_shell_with_budget_and_statics, parse_source_shell_with_registries,
        source_type_for_path, string_value_span, DroppedKeyReason, MAX_CATALOG_BRANCH_EXTRAS,
        MAX_CATALOG_DEPTH,
    };
    use crate::transform::{lower::lower_source_ir_classes, TransformFile, UnsupportedRecoveryIr};
    use oxc_span::Span;

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
    fn parser_shell_covers_szr_proof_shape_matrix() {
        let safe = r"import { szr } from '@csszyx/runtime';
export const a = szr(('p-4'), `m-${n}`, false, null, undefined);
export const b = szr(on && 'x', 'a' || 'b', cond ? 'c' : 'd', ['e', false]);";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/Safe.tsx".into(),
            source: safe.into(),
        });
        assert!(parsed.ir.szr_import_rewrite.is_some());

        for argument in [
            "cfg",
            "mk()",
            "true",
            "4",
            "cfg || 'x'",
            "cond ? 'x' : cfg",
            "['x', ...rest]",
            "('x' as string)",
        ] {
            let source = format!(
                "import {{ szr }} from '@csszyx/runtime'; export const x = szr({argument});"
            );
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/Unsafe.tsx".into(),
                source,
            });
            assert!(parsed.ir.szr_import_rewrite.is_none(), "{argument}");
        }
    }

    #[test]
    fn parser_shell_covers_szv_candidate_guard_matrix_and_type_queries() {
        let source = r"import { szr, szv } from '@csszyx/runtime';
const { destructured } = obj;
const dynamic = szv({ base: { p: 1 } });
let missing;
const scalar = 1;
const member = api.szv({ base: { p: 1 } });
const empty = szv();
const spreadArg = szv(...args);
const dynamicConfig = szv(config);
const computed = szv({ [key]: { p: 1 } });
const invalidBase = szv({ base: 'p-1' });
const overlap = szv({ base: { p: 1 }, variants: { pad: { sm: { p: 2 } } } });
const card = szv({ variants: { pad: { sm: { p: 2 } } } });
type CardSelection = Parameters<typeof card>[0];
type CardSelectionAgain = Parameters<typeof card>[0];
type ExternalSelection = typeof import('./types');
export const cls = szr(card({ pad: 'sm' }));";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/Factories.tsx".into(),
            source: source.into(),
        });
        assert_eq!(parsed.ir.szv_replacements.len(), 1);
        assert!(parsed.ir.szr_import_rewrite.is_some());
    }

    #[test]
    fn parser_shell_covers_import_candidate_guard_matrix() {
        for source in [
            "import type { szr } from '@csszyx/runtime';",
            "import { szr } from 'other';",
            "import '@csszyx/runtime';",
            "import def, { szr } from '@csszyx/runtime';",
            "import * as rt from '@csszyx/runtime';",
            "import { szv } from '@csszyx/runtime';",
        ] {
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/Imports.tsx".into(),
                source: source.into(),
            });
            assert!(parsed.ir.szr_import_rewrite.is_none(), "{source}");
        }

        let budgeted = parse_source_shell_with_budget(
            &TransformFile {
                filename: "/repo/src/Budget.tsx".into(),
                source: "import { szr } from '@csszyx/runtime';".into(),
            },
            1,
        );
        assert!(budgeted.ast_budget_exceeded);

        let import_after_budget = parse_source_shell_with_budget(
            &TransformFile {
                filename: "/repo/src/LateImport.tsx".into(),
                source: "const before = { nested: true }; import { szr } from '@csszyx/runtime';"
                    .into(),
            },
            1,
        );
        assert!(import_after_budget.ast_budget_exceeded);
        assert!(import_after_budget.ir.szr_import_rewrite.is_none());
    }

    #[test]
    fn parser_shell_stops_collecting_calls_after_ast_budget() {
        let source = "const before = { nested: true }; szr({ p: 4 });";
        let parsed = parse_source_shell_with_budget(
            &TransformFile {
                filename: "/repo/src/LateCall.tsx".into(),
                source: source.into(),
            },
            8,
        );

        assert!(parsed.ast_budget_exceeded);
        assert!(parsed.ir.catalog_sz_objects.is_empty());
    }

    #[test]
    fn parser_shell_covers_cross_module_import_guards() {
        use crate::transform::{StaticSzObject, StaticSzProperty, StaticSzValue, TextSpan};

        let config = StaticSzObject {
            properties: vec![StaticSzProperty {
                key: "variants".into(),
                value: StaticSzValue::Object(StaticSzObject {
                    properties: vec![StaticSzProperty {
                        key: "pad".into(),
                        value: StaticSzValue::Object(StaticSzObject {
                            properties: vec![StaticSzProperty {
                                key: "sm".into(),
                                value: StaticSzValue::Object(StaticSzObject {
                                    properties: vec![StaticSzProperty {
                                        key: "p".into(),
                                        value: StaticSzValue::Number(2.0),
                                        span: TextSpan { start: 0, end: 0 },
                                    }],
                                }),
                                span: TextSpan { start: 0, end: 0 },
                            }],
                        }),
                        span: TextSpan { start: 0, end: 0 },
                    }],
                }),
                span: TextSpan { start: 0, end: 0 },
            }],
        };
        let invalid = StaticSzObject {
            properties: vec![StaticSzProperty {
                key: "base".into(),
                value: StaticSzValue::String("invalid".into()),
                span: TextSpan { start: 0, end: 0 },
            }],
        };
        let overlap = StaticSzObject {
            properties: vec![
                StaticSzProperty {
                    key: "base".into(),
                    value: StaticSzValue::Object(StaticSzObject {
                        properties: vec![StaticSzProperty {
                            key: "p".into(),
                            value: StaticSzValue::Number(1.0),
                            span: TextSpan { start: 0, end: 0 },
                        }],
                    }),
                    span: TextSpan { start: 0, end: 0 },
                },
                config.properties[0].clone(),
            ],
        };
        let statics = vec![(
            "./styles".into(),
            vec![
                ("card".into(), config),
                ("invalid".into(), invalid),
                ("overlap".into(), overlap),
            ],
        )];
        let source = r"import type { card as typed } from './styles';
import './styles';
import { type card as typedSpecifier } from './styles';
import def, { card as ignoredDefault } from './styles';
import { missing, invalid, overlap, card as szv, card as localCard } from './styles';
import { card as duplicate } from './styles';
export const cls = szr(localCard({ pad: 'sm' }));";
        let parsed = parse_source_shell_with_budget_and_statics(
            &TransformFile {
                filename: "/repo/src/Cross.tsx".into(),
                source: source.into(),
            },
            usize::MAX,
            &statics,
        );
        assert_eq!(parsed.ir.szv_replacements.len(), 1);
    }

    /// `{ p: 4 }` as the exporter would have written it, in the decoded form
    /// the bundler's registry arrives in.
    fn cross_module_card() -> super::StaticSzObject {
        super::StaticSzObject {
            properties: vec![super::StaticSzProperty {
                key: "p".into(),
                value: super::StaticSzValue::Number(4.0),
                span: super::TextSpan { start: 0, end: 0 },
            }],
        }
    }

    fn parse_with_sz_objects(
        source: &str,
        registry: &super::super::szv_precompile::CrossModuleSzObjects,
    ) -> super::ParsedSourceShell {
        parse_source_shell_with_registries(
            &TransformFile {
                filename: "/repo/src/Card.tsx".into(),
                source: source.into(),
            },
            usize::MAX,
            super::CrossModuleRegistries {
                szv_factories: &Vec::new(),
                sz_objects: registry,
            },
        )
    }

    #[test]
    fn parser_lowers_an_imported_sz_object_like_a_local_literal() {
        let registry = vec![(
            "./styles".into(),
            vec![("cardSz".into(), cross_module_card())],
        )];

        for source in [
            "import { cardSz } from './styles';\nexport const A = () => <div sz={cardSz} />;",
            // The registry is keyed by EXPORT name while the code writes the
            // local one, so an alias must still find the entry.
            "import { cardSz as card } from './styles';\nexport const A = () => <div sz={card} />;",
        ] {
            let parsed = parse_with_sz_objects(source, &registry);
            let attribute = &parsed.ir.sz_attributes[0];
            assert!(!attribute.runtime_fallback, "{source}");
            assert_eq!(attribute.object.properties[0].key, "p");
            assert_eq!(
                attribute.object.properties[0].value,
                super::StaticSzValue::Number(4.0)
            );
        }
    }

    #[test]
    fn parser_prefers_a_local_declaration_over_the_imported_name() {
        let registry = vec![(
            "./styles".into(),
            vec![("cardSz".into(), cross_module_card())],
        )];
        let source = "import { cardSz } from './styles';\nexport const A = () => { const cardSz = { m: 2 }; return <div sz={cardSz} />; };";

        let parsed = parse_with_sz_objects(source, &registry);
        let attribute = &parsed.ir.sz_attributes[0];
        assert!(!attribute.runtime_fallback);
        assert_eq!(attribute.object.properties[0].key, "m");
    }

    /// A token map as a provider exports it, in the registry's decoded form.
    fn cross_module_layer() -> super::StaticSzObject {
        super::StaticSzObject {
            properties: vec![super::StaticSzProperty {
                key: "modal".into(),
                value: super::StaticSzValue::Number(60.0),
                span: super::TextSpan { start: 0, end: 0 },
            }],
        }
    }

    /// A colour-with-opacity sub-object, the shape an `sz` VALUE can be.
    fn cross_module_brand() -> super::StaticSzObject {
        super::StaticSzObject {
            properties: vec![
                super::StaticSzProperty {
                    key: "color".into(),
                    value: super::StaticSzValue::String("blue-500".into()),
                    span: super::TextSpan { start: 0, end: 0 },
                },
                super::StaticSzProperty {
                    key: "op".into(),
                    value: super::StaticSzValue::Number(20.0),
                    span: super::TextSpan { start: 0, end: 0 },
                },
            ],
        }
    }

    /// The registry a bundler hands a file importing both token modules.
    fn token_registry() -> super::super::szv_precompile::CrossModuleSzObjects {
        vec![(
            "./tokens".into(),
            vec![
                ("LAYER".into(), cross_module_layer()),
                ("BRAND".into(), cross_module_brand()),
            ],
        )]
    }

    /// The one static property an attribute lowered, with no CSS variable left.
    ///
    /// An unresolved value does NOT reach the runtime-fallback path: it becomes
    /// a dynamic CSS variable, which is a valid compile that ships a custom
    /// property instead of a class. Asserting only `!runtime_fallback` would
    /// therefore pass on today's behaviour and prove nothing.
    fn single_static_property(attribute: &super::SzAttributeIr) -> (String, super::StaticSzValue) {
        assert!(
            attribute.dynamic_css_vars.is_empty(),
            "value stayed dynamic: {:?}",
            attribute.dynamic_css_vars,
        );
        assert_eq!(attribute.object.properties.len(), 1);
        let property = &attribute.object.properties[0];
        (property.key.clone(), property.value.clone())
    }

    #[test]
    fn parser_reads_a_property_off_an_imported_map() {
        let source = "import { LAYER } from './tokens';\nexport const A = () => <div sz={{ z: LAYER.modal }} />;";

        let parsed = parse_with_sz_objects(source, &token_registry());
        assert_eq!(
            single_static_property(&parsed.ir.sz_attributes[0]),
            ("z".to_string(), super::StaticSzValue::Number(60.0)),
        );
    }

    #[test]
    fn parser_lowers_an_imported_object_used_as_a_property_value() {
        let source =
            "import { BRAND } from './tokens';\nexport const A = () => <div sz={{ bg: BRAND }} />;";

        let parsed = parse_with_sz_objects(source, &token_registry());
        assert_eq!(
            single_static_property(&parsed.ir.sz_attributes[0]),
            (
                "bg".to_string(),
                super::StaticSzValue::Object(cross_module_brand()),
            ),
        );
    }

    #[test]
    fn parser_prefers_a_local_map_over_an_imported_one() {
        // The attribute path already pins local-wins for `sz={NAME}`. The value
        // path reaches the same names by a different route, so it needs its own
        // pin: an import that started answering ahead of a local declaration
        // would compile the wrong number with nothing to show for it.
        let source = "import { LAYER } from './tokens';\nexport const A = () => { const LAYER = { modal: 10 }; return <div sz={{ z: LAYER.modal }} />; };";

        let parsed = parse_with_sz_objects(source, &token_registry());
        assert_eq!(
            single_static_property(&parsed.ir.sz_attributes[0]),
            ("z".to_string(), super::StaticSzValue::Number(10.0)),
        );
    }

    #[test]
    fn parser_refuses_map_reads_it_cannot_answer() {
        let cases = [
            // A key the map does not carry. Answering with anything here would
            // be a guess; the runtime read yields undefined and the author gets
            // today's fallback diagnostic instead of a wrong class.
            "export const A = () => <div sz={{ z: LAYER.missing }} />;",
            // A computed key picks its property at run time, so no build-time
            // read of the map can be right.
            "export const A = ({ k }) => <div sz={{ z: LAYER[k] }} />;",
            // The map is imported from a module the registry does not carry.
            "export const A = () => <div sz={{ z: OTHER.modal }} />;",
        ];

        for body in cases {
            let source =
                format!("import {{ LAYER }} from './tokens';\nimport {{ OTHER }} from './elsewhere';\n{body}");
            let parsed = parse_with_sz_objects(&source, &token_registry());
            let attribute = &parsed.ir.sz_attributes[0];
            // Refusing means the value keeps the custom property it compiles to
            // today. The static object must stay empty: a key appearing there
            // would be a build-time guess at a value only the runtime knows.
            assert_eq!(attribute.dynamic_css_vars.len(), 1, "{body}");
            assert!(attribute.object.properties.is_empty(), "{body}");
        }
    }

    #[test]
    fn parser_reads_a_property_off_an_imported_namespace() {
        let source = "import * as T from './tokens';\nexport const A = () => <div sz={{ z: T.LAYER.modal }} />;";

        let parsed = parse_with_sz_objects(source, &token_registry());
        assert_eq!(
            single_static_property(&parsed.ir.sz_attributes[0]),
            ("z".to_string(), super::StaticSzValue::Number(60.0)),
        );
    }

    #[test]
    fn parser_lowers_a_namespace_member_as_the_whole_attribute() {
        let registry = vec![(
            "./styles".into(),
            vec![("cardSz".into(), cross_module_card())],
        )];
        let source =
            "import * as S from './styles';\nexport const A = () => <div sz={S.cardSz} />;";

        let parsed = parse_with_sz_objects(source, &registry);
        let attribute = &parsed.ir.sz_attributes[0];
        assert!(!attribute.runtime_fallback);
        assert_eq!(attribute.object.properties[0].key, "p");
    }

    #[test]
    fn parser_refuses_the_namespace_object_itself() {
        // `sz={T}` asks for the module's export map as a style. Lowering it
        // would turn export NAMES into utility keys and emit classes for a
        // shape the author never wrote; the runtime path is the honest answer.
        let source = "import * as T from './tokens';\nexport const A = () => <div sz={T} />;";

        let parsed = parse_with_sz_objects(source, &token_registry());
        assert!(parsed.ir.sz_attributes[0].runtime_fallback);
    }

    #[test]
    fn parser_prefers_a_local_binding_over_a_namespace() {
        let source = "import * as T from './tokens';\nexport const A = () => { const T = { LAYER: { modal: 10 } }; return <div sz={{ z: T.LAYER.modal }} />; };";

        let parsed = parse_with_sz_objects(source, &token_registry());
        assert_eq!(
            single_static_property(&parsed.ir.sz_attributes[0]),
            ("z".to_string(), super::StaticSzValue::Number(10.0)),
        );
    }

    #[test]
    fn parser_refuses_a_namespace_name_a_local_binding_shadows() {
        // The local `T` resolves to nothing static, so the ordinary resolution
        // declines — and the namespace must NOT answer behind it. What the code
        // reads is the local binding, whatever it happens to hold, and the
        // module of the same name is not it.
        let source = "import * as T from './tokens';\nexport const A = ({ runtime }) => { const T = runtime; return <div sz={{ z: T.LAYER.modal }} />; };";

        let parsed = parse_with_sz_objects(source, &token_registry());
        let attribute = &parsed.ir.sz_attributes[0];
        assert_eq!(attribute.dynamic_css_vars.len(), 1);
        assert!(attribute.object.properties.is_empty());
    }

    #[test]
    fn parser_refuses_a_scalar_read_as_a_whole_attribute() {
        // `sz={T.LAYER.modal}` resolves, but to the number 60. An attribute has
        // to be an object; accepting anything else would put whatever the value
        // stringifies to into a class list.
        let source =
            "import * as T from './tokens';\nexport const A = () => <div sz={T.LAYER.modal} />;";

        let parsed = parse_with_sz_objects(source, &token_registry());
        assert!(parsed.ir.sz_attributes[0].runtime_fallback);
    }

    #[test]
    fn parser_refuses_namespace_reads_it_cannot_answer() {
        let cases = [
            // An export the module does not have.
            "export const A = () => <div sz={{ z: T.MISSING.modal }} />;",
            // A key the map does not carry.
            "export const A = () => <div sz={{ z: T.LAYER.missing }} />;",
            // A computed read, at either level.
            "export const A = ({ k }) => <div sz={{ z: T[k].modal }} />;",
            "export const A = ({ k }) => <div sz={{ z: T.LAYER[k] }} />;",
        ];

        for body in cases {
            let source = format!("import * as T from './tokens';\n{body}");
            let parsed = parse_with_sz_objects(&source, &token_registry());
            let attribute = &parsed.ir.sz_attributes[0];
            assert_eq!(attribute.dynamic_css_vars.len(), 1, "{body}");
            assert!(attribute.object.properties.is_empty(), "{body}");
        }
    }

    #[test]
    fn parser_refuses_a_type_only_namespace_import() {
        let source =
            "import type * as T from './tokens';\nexport const A = () => <div sz={{ z: T.LAYER.modal }} />;";

        let parsed = parse_with_sz_objects(source, &token_registry());
        let attribute = &parsed.ir.sz_attributes[0];
        assert_eq!(attribute.dynamic_css_vars.len(), 1);
        assert!(attribute.object.properties.is_empty());
    }

    #[test]
    fn parser_lowers_a_default_imported_sz_object() {
        // The provider wrote `export default { p: 4 }`, which the registry
        // files under the `default` slot. The local name is the importer's to
        // choose, so resolution has to go by the slot, never by that name.
        let registry = vec![(
            "./styles".into(),
            vec![("default".into(), cross_module_card())],
        )];

        for source in [
            "import cardSz from './styles';\nexport const A = () => <div sz={cardSz} />;",
            "import anythingAtAll from './styles';\nexport const A = () => <div sz={anythingAtAll} />;",
        ] {
            let parsed = parse_with_sz_objects(source, &registry);
            let attribute = &parsed.ir.sz_attributes[0];
            assert!(!attribute.runtime_fallback, "{source}");
            assert_eq!(attribute.object.properties[0].key, "p", "{source}");
        }
    }

    #[test]
    fn parser_keeps_the_default_and_named_slots_apart() {
        // One module exporting both must answer each importer with its own
        // half. Collapsing the two would let `import x from` pick up a named
        // export whenever the module happened to have one.
        let registry = vec![(
            "./styles".into(),
            vec![
                ("default".into(), cross_module_card()),
                ("hoverSz".into(), cross_module_layer()),
            ],
        )];
        let source = "import base, { hoverSz } from './styles';\nexport const A = () => <div sz={base} className={String(hoverSz)} />;";

        let parsed = parse_with_sz_objects(source, &registry);
        let attribute = &parsed.ir.sz_attributes[0];
        assert!(!attribute.runtime_fallback);
        assert_eq!(attribute.object.properties[0].key, "p");
    }

    #[test]
    fn parser_refuses_imports_it_cannot_resolve() {
        let registry = vec![(
            "./styles".into(),
            vec![("cardSz".into(), cross_module_card())],
        )];
        let cases = [
            "import type { cardSz } from './styles';",
            "import { type cardSz } from './styles';",
            // A default import of a module whose registry entry is a NAMED
            // export. The default slot is a separate entry, and answering from
            // a named one would resolve a value the importer never asked for.
            "import cardSz from './styles';",
            "import type cardSz from './styles';",
            // A side-effect import binds no name at all. It still names a
            // module the registry carries, so the collector has to walk past
            // it rather than read specifiers that are not there.
            "import './styles';",
            "import './styles';\nimport { unrelated } from './other';",
            // An export the registry does not carry, and a specifier it does
            // not carry: both must leave today's runtime path untouched.
            "import { cardSz } from './elsewhere';",
            "import { otherSz as cardSz } from './styles';",
        ];

        for import in cases {
            let source = format!("{import}\nexport const A = () => <div sz={{cardSz}} />;");
            let parsed = parse_with_sz_objects(&source, &registry);
            assert!(parsed.ir.sz_attributes[0].runtime_fallback, "{import}");
        }

        // An absent registry must mean exactly what an empty one means.
        let direct =
            "import { cardSz } from './styles';\nexport const A = () => <div sz={cardSz} />;";
        assert!(parse_with_sz_objects(direct, &Vec::new()).ir.sz_attributes[0].runtime_fallback);
    }

    #[test]
    fn imported_sz_object_answers_by_local_binding_name() {
        let imports = vec![("card".to_string(), cross_module_card())];

        assert_eq!(
            super::imported_sz_object(&imports, "card"),
            Some(&cross_module_card())
        );
        // The EXPORT name is not a binding this file has, so it must miss.
        assert!(super::imported_sz_object(&imports, "cardSz").is_none());
    }

    #[test]
    fn parser_shell_classifies_extended_fallback_expression_names() {
        let cases = [
            ("a + b", "BinaryExpression"),
            ("!a", "UnaryExpression"),
            ("a++", "UpdateExpression"),
            ("a = b", "AssignmentExpression"),
            ("(a, b)", "SequenceExpression"),
            ("tag`x`", "TaggedTemplateExpression"),
            ("() => a", "ArrowFunctionExpression"),
            ("function () {}", "FunctionExpression"),
            ("class {}", "ClassExpression"),
            ("this", "ThisExpression"),
            ("a?.b", "ChainExpression"),
            ("import.meta", "MetaProperty"),
            ("a as string", "TSAsExpression"),
            ("a satisfies string", "TSSatisfiesExpression"),
            ("a!", "TSNonNullExpression"),
            ("true", "BooleanLiteral"),
            ("42", "NumericLiteral"),
            ("1n", "BigIntLiteral"),
            ("/x/", "RegExpLiteral"),
            ("<span />", "JSXElement"),
            ("<>x</>", "JSXFragment"),
            ("null", "NullLiteral"),
            ("import('x')", "Expression"),
        ];
        for (expression, expected) in cases {
            let source = format!("const A = () => <div sz={{{expression}}} />;");
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/FallbackKinds.tsx".into(),
                source,
            });
            let details = parsed
                .ir
                .sz_attributes
                .iter()
                .filter_map(|attribute| attribute.runtime_fallback_diagnostic.as_ref())
                .map(|diagnostic| diagnostic.detail.as_str())
                .chain(
                    parsed
                        .ir
                        .site_fallbacks
                        .iter()
                        .map(|fallback| fallback.detail.as_str()),
                )
                .collect::<Vec<_>>();
            assert!(details.contains(&expected), "{expression}: {details:?}");
        }
    }

    #[test]
    fn parser_shell_mask_linear_group_merge_drops_the_displaced_group() {
        let source = "const A = () => <div sz={[{ maskLinear: { angle: 45 } }, { maskLinear: { b: { from: '0%' } } }]} />;";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/MaskMerge.tsx".into(),
            source: source.into(),
        });
        let lowered = lower_source_ir_classes(&parsed.ir);
        assert_eq!(lowered.classes, ["mask-b-from-0%"]);

        let mut existing = super::StaticSzObject {
            properties: vec![super::StaticSzProperty {
                key: "angle".into(),
                value: super::StaticSzValue::Number(45.0),
                span: super::TextSpan { start: 0, end: 0 },
            }],
        };
        super::drop_displaced_sub_keys(
            "maskLinear",
            &mut existing,
            &super::StaticSzObject {
                properties: vec![super::StaticSzProperty {
                    key: "unknown".into(),
                    value: super::StaticSzValue::Boolean(true),
                    span: super::TextSpan { start: 0, end: 0 },
                }],
            },
        );
        assert_eq!(existing.properties.len(), 1);
    }

    #[test]
    fn parser_shell_covers_szv_selection_and_reference_guard_matrix() {
        let cases = [
            "card()",
            "card({ pad: true })",
            "card({ pad: 2 })",
            "card({ pad: -2 })",
            "card({ pad: -9007199254740992 })",
            "card({ pad: +2 })",
            "card({ pad: -value })",
            "card({ ...selection })",
            "card({ [key]: value })",
            "card({})",
            "card({ pad: value, tone: other })",
            "card({ 'pad': value })",
            "card({ 1: value })",
            "card({ __proto__: value })",
            "card(...args)",
            "card(value, sideEffect())",
            "api.card()",
            "api[key + 1]()",
        ];
        for call in cases {
            let source = format!(
                "import {{ szr, szv }} from '@csszyx/runtime'; const card = szv({{ variants: {{ pad: {{ sm: {{ p: 2 }} }} }} }}); export const cls = szr({call});"
            );
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/Selections.tsx".into(),
                source,
            });
            assert!(!parsed.panicked, "{call}");
        }

        for suffix in [
            "export const leak = card({ pad: 'sm' });",
            "export const occupied = __szvT_card;",
        ] {
            let source = format!(
                "import {{ szr, szv }} from '@csszyx/runtime'; const card = szv({{ variants: {{ pad: {{ sm: {{ p: 2 }} }} }} }}); export const cls = szr(card({{ pad: 'sm' }})); {suffix}"
            );
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/References.tsx".into(),
                source,
            });
            assert!(parsed.ir.szv_replacements.is_empty(), "{suffix}");
        }
    }

    #[test]
    fn parser_shell_covers_dynamic_array_provability_matrix() {
        for expression in [
            "(`x-${n}`)",
            "`a-${n}` || `b-${n}`",
            "['a', false, null]",
            "['a', , 'b']",
            "['a', ...rest]",
            "cond ? `a-${n}` : `b-${n}`",
        ] {
            let source = format!("const A = () => <div sz={{[{{ p: 4 }}, {expression}]}} />;");
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/Arrays.tsx".into(),
                source,
            });
            assert!(!parsed.panicked, "{expression}");
        }
    }

    #[test]
    fn parser_shell_covers_spread_argument_and_double_quote_rewrite_guards() {
        for source in [
            "import { szr } from '@csszyx/runtime'; export const x = szr(...parts);",
            "import { szr } from '@csszyx/runtime'; export const x = szr(szv());",
            "import { szr } from '@csszyx/runtime'; export const x = szr('x'); export const doc = 'szr';",
        ] {
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/Guards.tsx".into(),
                source: source.into(),
            });
            assert!(parsed.ir.szr_import_rewrite.is_none());
        }
        let source = "import { szr } from \"@csszyx/runtime\"; export const x = szr('x');";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/Double.tsx".into(),
            source: source.into(),
        });
        assert!(parsed.ir.szr_import_rewrite.is_some());
    }

    #[test]
    fn parser_shell_classifies_yield_and_typescript_only_fallbacks() {
        let yielded = parse_source_shell(&TransformFile {
            filename: "/repo/src/Yield.tsx".into(),
            source: "function* A(){ return <div sz={yield value} />; }".into(),
        });
        assert_eq!(
            yielded.ir.sz_attributes[0]
                .runtime_fallback_diagnostic
                .as_ref()
                .map(|diagnostic| diagnostic.detail.as_str()),
            Some("YieldExpression")
        );

        for (expression, expected) in [
            ("<string>value", "TSTypeAssertion"),
            ("fn<string>", "TSInstantiationExpression"),
        ] {
            let source = format!("import {{ szr }} from '@csszyx/runtime'; szr({expression});");
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/Types.ts".into(),
                source,
            });
            assert_eq!(parsed.ir.site_fallbacks[0].detail, expected);
        }

        let type_queries = parse_source_shell(&TransformFile {
            filename: "/repo/src/Queries.ts".into(),
            source: "type Local = typeof value; type External = typeof import('./types');".into(),
        });
        assert!(!type_queries.panicked);
    }

    #[test]
    fn parser_shell_covers_strict_literal_scalar_guards() {
        for config in [
            "{ base: { hidden: true } }",
            "{ base: { p: +2 } }",
            "{ base: { p: -value } }",
        ] {
            let source = format!(
                "import {{ szr, szv }} from '@csszyx/runtime'; const card = szv({config}); export const cls = szr(card());"
            );
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/StrictLiterals.tsx".into(),
                source,
            });
            assert!(!parsed.panicked, "{config}");
        }
    }

    #[test]
    fn parser_shell_accepts_jsx_in_plain_javascript_files() {
        let file = TransformFile {
            filename: "/repo/src/App.js".to_string(),
            source: "export const App = () => <div sz={{ p: 4 }} />;".to_string(),
        };

        let parsed = parse_source_shell(&file);

        assert!(parsed.diagnostics.is_empty());
        assert_eq!(parsed.ir.sz_attributes.len(), 1);
        assert_eq!(lower_source_ir_classes(&parsed.ir).classes, ["p-4"]);
    }

    #[test]
    fn parser_shell_lowers_a_dynamic_boolean_only_key_to_a_bool_class_conditional() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const A = ({ on }) => <div sz={{ borderB: on }} />;".to_string(),
        };

        let parsed = parse_source_shell(&file);
        let attribute = &parsed.ir.sz_attributes[0];

        assert!(
            attribute.dynamic_css_vars.is_empty(),
            "a boolean-only key must never take the css-var lane"
        );
        let ternary = &attribute.ternaries[0];
        assert_eq!(ternary.bool_class_key.as_deref(), Some("borderB"));
        assert_eq!(ternary.consequent_classes, ["border-b"]);
        assert!(ternary.alternate_classes.is_empty());
        // The bare class must reach the safelist, or Tailwind emits no rule for
        // it and the toggle styles nothing.
        assert_eq!(lower_source_ir_classes(&parsed.ir).classes, ["border-b"]);
    }

    /// Parse one component and hand back its single sz attribute's ternaries.
    fn ternaries_for(sz_value: &str) -> Vec<super::super::StaticTernaryIr> {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: format!("export const A = ({{ on, a, b }}) => <div sz={{{sz_value}}} />;"),
        };
        parse_source_shell(&file).ir.sz_attributes[0]
            .ternaries
            .clone()
    }

    #[test]
    fn parser_shell_folds_a_falsy_ternary_branch_to_no_classes() {
        for branch in ["undefined", "null", "false"] {
            let ternaries = ternaries_for(&format!("on ? {{ color: 'muted' }} : {branch}"));

            assert_eq!(ternaries.len(), 1, "{branch}");
            assert_eq!(ternaries[0].consequent_classes, ["text-muted"], "{branch}");
            assert!(ternaries[0].alternate_classes.is_empty(), "{branch}");
        }
    }

    #[test]
    fn parser_shell_folds_a_falsy_ternary_branch_on_either_side() {
        let ternaries = ternaries_for("on ? undefined : { color: 'muted' }");

        assert_eq!(ternaries.len(), 1);
        assert!(ternaries[0].consequent_classes.is_empty());
        assert_eq!(ternaries[0].alternate_classes, ["text-muted"]);
    }

    #[test]
    fn parser_shell_folds_a_guarded_style_into_a_ternary() {
        let ternaries = ternaries_for("on && { color: 'muted' }");

        assert_eq!(ternaries.len(), 1);
        assert_eq!(ternaries[0].consequent_classes, ["text-muted"]);
        assert!(ternaries[0].alternate_classes.is_empty());
    }

    #[test]
    fn parser_shell_folds_a_guard_reached_through_a_wrapper() {
        // A guard rarely arrives bare at the attribute: a formatter parenthesizes
        // it across a line break, and a shared style is held by a const. Both
        // reach the expression reader rather than the JSX one, so folding only
        // the bare form would make the parentheses decide whether it compiles.
        for sz_value in [
            "(on && { color: 'muted' })",
            "(on && { color: 'muted' }) as const",
        ] {
            let ternaries = ternaries_for(sz_value);

            assert_eq!(ternaries.len(), 1, "{sz_value}");
            assert_eq!(
                ternaries[0].consequent_classes,
                ["text-muted"],
                "{sz_value}"
            );
        }
    }

    #[test]
    fn parser_shell_carries_a_whole_guard_chain_into_the_test_span() {
        let source =
            "export const A = ({ on, a, b }) => <div sz={a && b && { color: 'muted' }} />;";
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        };
        let parsed = parse_source_shell(&file);
        let span = parsed.ir.sz_attributes[0].ternaries[0].test_span;

        // Taking only the rightmost operand would drop `a` and style the
        // element on the wrong condition.
        assert_eq!(&source[span.start as usize..span.end as usize], "a && b");
    }

    #[test]
    fn parser_shell_refuses_to_fold_an_or_guard() {
        // `||` yields its LEFT operand when the test passes, and that value can
        // itself be a style — folding would silently drop it.
        assert!(ternaries_for("on || { color: 'muted' }").is_empty());
    }

    #[test]
    fn parser_shell_drops_a_runtime_value_with_no_tailwind_var_form() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const A = ({ v }) => <div sz={{ p: 4, textAlign: v }} />;".to_string(),
        };

        let parsed = parse_source_shell(&file);
        let attribute = &parsed.ir.sz_attributes[0];

        assert!(
            attribute.dynamic_css_vars.is_empty(),
            "a key with no var form must never reach the css-var lane"
        );
        assert_eq!(attribute.dropped_dynamic_keys.len(), 1);
        assert_eq!(attribute.dropped_dynamic_keys[0].key, "textAlign");
        assert_eq!(
            attribute.dropped_dynamic_keys[0].reason,
            DroppedKeyReason::NoVarForm
        );
        // The static sibling was never in question and must survive the drop.
        assert_eq!(lower_source_ir_classes(&parsed.ir).classes, ["p-4"]);
    }

    #[test]
    fn parser_shell_keeps_value_typed_keys_on_the_css_var_lane() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const A = ({ v }) => <div sz={{ z: v, w: v, bg: v, p: v }} />;"
                .to_string(),
        };

        let parsed = parse_source_shell(&file);
        let attribute = &parsed.ir.sz_attributes[0];

        assert!(attribute.ternaries.is_empty());
        assert_eq!(attribute.dynamic_css_vars.len(), 4);
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
            source:
                "export const App = () => <div className={getClass()} sz={{ p: 4, truncate: true }} />;"
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
        assert_eq!(lowered.classes, ["p-4", "truncate"]);
    }

    #[test]
    fn parser_shell_ignores_bare_class_and_tracks_literal_style_attributes() {
        let source =
            "const A=()=> <><span class style/><p className='kept' style='--brand: red'/></>;";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });

        assert!(parsed.diagnostics.is_empty());
        assert_eq!(parsed.ir.class_attributes.len(), 1);
        assert_eq!(parsed.ir.class_attributes[0].value, "kept");
        assert_eq!(parsed.ir.style_attributes.len(), 2);
        assert!(parsed
            .ir
            .style_attributes
            .iter()
            .all(|attribute| attribute.expression_span.is_none()));
    }

    #[test]
    fn parser_shell_ignores_recovered_empty_jsx_attribute_expressions() {
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const App = () => <div className={/* empty */} style={/* empty */} sz={/* empty */} />;".to_string(),
        });

        assert!(!parsed.panicked);
        assert!(!parsed.diagnostics.is_empty());
        assert!(parsed.ir.class_attributes.is_empty());
        assert!(parsed.ir.style_attributes.is_empty());
        assert!(parsed.ir.sz_attributes.is_empty());
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
    fn parser_shell_extracts_catalog_call_wrapper_matrix() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: r"
                const BASE = { h: 5 } as const;
                const a = dynamic(({ p: 1 }));
                const b = dynamic(({ m: 2 } as const));
                const c = dynamic(({ gap: 3 } satisfies object));
                const d = dynamic(({ w: 4 })!);
                const e = dynamic(BASE!);
                const f = dynamic(BASE);
                const g = dynamic({ minH: 6 } satisfies object);
                const ignoredMember = tools.dynamic({ p: 99 });
                const ignoredEmpty = dynamic();
                const ignoredCall = dynamic(makeStyles());
                const ignoredCallee = other({ p: 100 });
            "
            .to_string(),
        };

        let parsed = parse_source_shell(&file);
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty());
        assert_eq!(
            lowered.classes,
            ["p-1", "m-2", "gap-3", "w-4", "h-5", "h-5", "min-h-6"]
        );
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
    fn szv_catalog_caps_branch_expansion_and_nested_objects() {
        use std::fmt::Write as _;

        let mut source = String::from(
            "import { szv } from '@csszyx/runtime'; declare const c: boolean; const styles = szv({ base: {",
        );
        for i in 0..=(MAX_CATALOG_BRANCH_EXTRAS + 4) {
            let _ = write!(source, "p{i}: c ? {i} : {},", i + 1);
        }
        source.push_str("} });");

        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/branch-cap.tsx".to_string(),
            source,
        });
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty());
        assert_eq!(lowered.classes.len(), MAX_CATALOG_BRANCH_EXTRAS * 2 + 5);

        let mut nested = "{ p: 4 }".to_string();
        for _ in 0..=(MAX_CATALOG_DEPTH + 1) {
            nested = format!("{{ hover: {nested} }}");
        }
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/depth-cap.tsx".to_string(),
            source: format!(
                "import {{ szv }} from '@csszyx/runtime'; const DEEP = {nested}; const styles = szv({{ base: DEEP }});"
            ),
        });
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty());
        assert!(lowered.classes.is_empty());

        let mut extras = Vec::new();
        let mut exhausted = super::CatalogExtrasBudget {
            extras: 0,
            explores: 0,
            object_memo: std::collections::HashMap::new(),
            value_memo: std::collections::HashMap::new(),
        };
        super::push_catalog_extra(&mut extras, super::StaticSzObject::empty(), &mut exhausted);
        assert!(extras.is_empty());
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
    fn szv_catalog_resolves_conditional_object_candidates_with_memo_and_cycle_guards() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "import { szv } from '@csszyx/runtime'; declare const dense: boolean; const COMPACT = { p: 2 }; const RELAXED = { m: 4 }; const CHOICE = dense ? COMPACT : RELAXED; const LOOP = LOOP; const DIMENSION = { direct: CHOICE, memoized: CHOICE, spread: { ...CHOICE, bg: 'red-500' }, cyclic: LOOP }; const s = szv({ variants: { layout: DIMENSION } });".to_string(),
        };

        let parsed = parse_source_shell(&file);
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty());
        assert!(lowered.classes.contains(&"p-2".to_string()));
        assert!(lowered.classes.contains(&"m-4".to_string()));
        assert!(lowered.classes.contains(&"bg-red-500".to_string()));
        assert_eq!(
            lowered
                .classes
                .iter()
                .filter(|class| class.as_str() == "p-2")
                .count(),
            1
        );
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
    fn szv_catalog_skips_malformed_members_without_losing_static_siblings() {
        let source = r"
            const LOOP = LOOP;
            const NUMBER = 1;
            const ignoredLiteral = szv(1);
            const ignoredNumberBinding = szv(NUMBER);
            const ignoredRuntimeConfig = szv(runtimeConfig);
            const ignoredDynamic = dynamic(runtimeValue);
            const styles = szv({
                ...runtimeConfig,
                base: {
                    p: dense ? 1 : 2,
                    hidden: true,
                    [dynamicKey]: 9,
                    1n: { p: 77 },
                    helper() {},
                    m: runtimeValue,
                    ...runtimeBase,
                },
                variants: {
                    ...runtimeDimensions,
                    [dynamicKey]: { on: { p: 99 } },
                    invalid: runtimeDimension,
                    cyclic: LOOP,
                    called: makeDimension(),
                    tone: {
                        ...runtimeVariants,
                        [dynamicKey]: { p: 88 },
                        ok: { bg: 'red-500' },
                        called: makeStyle(),
                    },
                },
            });
        ";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/catalog.tsx".to_string(),
            source: source.to_string(),
        });
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty());
        for class_name in ["p-1", "p-2", "bg-red-500"] {
            assert!(
                lowered.classes.contains(&class_name.to_string()),
                "missing {class_name}: {:?}",
                lowered.classes
            );
        }
        for ignored in ["p-99", "p-88", "p-77"] {
            assert!(
                !lowered.classes.contains(&ignored.to_string()),
                "computed catalog key leaked {ignored}: {:?}",
                lowered.classes
            );
        }
    }

    #[test]
    fn parser_budget_stops_nested_jsx_without_corrupting_partial_ir() {
        let file = TransformFile {
            filename: "/repo/src/Budget.tsx".to_string(),
            source: "export const App = () => <><main sz={{ p: 1 }}><section><span sz={{ m: 2 }} /></section></main><aside sz={{ w: 3 }} /></>;".to_string(),
        };

        let mut saw_partial_ir = false;
        for budget in 0..64 {
            let parsed = parse_source_shell_with_budget(&file, budget);

            assert!(!parsed.panicked);
            assert!(parsed.diagnostics.is_empty());
            if parsed.ast_budget_exceeded && !parsed.ir.jsx_opening_elements.is_empty() {
                saw_partial_ir = true;
            }
            for element in &parsed.ir.jsx_opening_elements {
                if let Some(parent) = element.parent_element_index {
                    assert!(parent < parsed.ir.jsx_opening_elements.len());
                }
                assert!(element
                    .sz_attribute_indices
                    .iter()
                    .all(|index| *index < parsed.ir.sz_attributes.len()));
            }
        }

        assert!(saw_partial_ir);
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
    fn parser_shell_classifies_mixed_array_parts_through_typescript_wrappers() {
        let source = "const STATIC={rounded:'md'}; const App=({active,styles,width})=><div sz={(['base  flex',active&&'m-2',active?{p:2}:'p-4',active&&styles,{w:width},STATIC] as const)}/>;";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });
        let parts = &parsed.ir.sz_attributes[0].array_parts;

        assert_eq!(parts.len(), 6);
        assert_eq!(parts[0].classes, ["base", "flex"]);
        assert_eq!(parts[1].classes, ["m-2"]);
        assert!(parts[1].condition_span.is_some());
        let ternary = parts[2].ternary.as_ref().expect("static ternary");
        assert_eq!(ternary.consequent_classes, ["p-2"]);
        assert_eq!(ternary.alternate_classes, ["p-4"]);
        assert!(parts[3].dynamic_span.is_some());
        assert!(!parts[3].dynamic_object_literal);
        assert!(parts[4].dynamic_span.is_some());
        assert!(parts[4].dynamic_object_literal);
        assert_eq!(parts[5].classes, ["rounded-md"]);
    }

    #[test]
    fn parser_shell_classifies_array_control_flow_and_falsy_entries() {
        let source = r"
            const STATIC = { m: 2 } as const;
            const App = ({ cond, other, styles, gap }) => <div sz={[
                , false, null, undefined, 0, '',
                'block hover:p-2',
                cond && '', cond && 'focus:m-2',
                cond && ({ p: 4 } as const),
                cond && (other ? { p: 6 } : { p: 8 }),
                cond ? 'text-sm' : 'text-lg',
                cond ? { bg: 'red-500' } : { bg: 'blue-500' },
                { m: 1, p: cond ? 2 : 4 },
                { gap },
                STATIC,
                styles,
            ]} />;
        ";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });
        let attribute = &parsed.ir.sz_attributes[0];
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty());
        assert!(!attribute.runtime_fallback);
        // `undefined` remains a runtime slot and an empty string remains an
        // empty static slot so authored array positions retain szcn ordering.
        assert_eq!(
            attribute.array_parts.len(),
            12,
            "{:#?}",
            attribute.array_parts
        );
        for class in [
            "block",
            "hover:p-2",
            "focus:m-2",
            "p-4",
            "p-6",
            "p-8",
            "text-sm",
            "text-lg",
            "bg-red-500",
            "bg-blue-500",
            "m-1",
            "p-2",
            "m-2",
        ] {
            assert!(
                lowered.classes.iter().any(|found| found == class),
                "{class}"
            );
        }
        assert!(attribute
            .array_parts
            .iter()
            .any(|part| part.dynamic_object_literal));
        assert!(attribute
            .array_parts
            .iter()
            .any(|part| part.dynamic_span.is_some() && !part.candidates.is_empty()));
    }

    #[test]
    fn parser_shell_safelists_static_array_candidates_before_runtime_spread() {
        for source in [
            "const BASE = { p: 4 }; const App = ({ active, items }) => <div sz={([BASE, { w: 3 }, active && ((((BASE as const) satisfies object)!)), active && { m: 2 }, ...items] satisfies unknown[])} />;",
            "const App = ({ active, items }) => <div sz={[active && UNKNOWN, active && makeStyles(), { p: 4 }, { w: 3 }, { m: 2 }, ...items]} />;",
            "const App = ({ items }) => <div sz={[{ p: 4 }, { w: 3 }, { m: 2 }, ...items]} />;",
            "const STYLE = [...items, { p: 4 }, { w: 3 }, { m: 2 }]; const App = () => <div sz={STYLE} />;",
            "const App = ({ active, items }) => <div sz={active ? [...items, { p: 4 }] : [...items, { w: 3 }, { m: 2 }]} />;",
            "const App = ({ active, items }) => <div sz={active && [...items, { p: 4 }, { w: 3 }, { m: 2 }]} />;",
            "const App = ({ items }) => <div sz={(([...items, { p: 4 }, { w: 3 }, { m: 2 }]!)!)} />;",
        ] {
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source: source.to_string(),
            });
            let attribute = &parsed.ir.sz_attributes[0];

            assert!(attribute.runtime_fallback, "{source}");
            assert!(attribute.array_parts.is_empty(), "{source}");
            assert!(
                attribute.candidate_classes.contains(&"p-4".to_string()),
                "{source}: {:?}",
                attribute.candidate_classes
            );
            assert!(
                attribute.candidate_classes.contains(&"w-3".to_string()),
                "{source}: {:?}",
                attribute.candidate_classes
            );
            assert!(
                attribute.candidate_classes.contains(&"m-2".to_string()),
                "{source}: {:?}",
                attribute.candidate_classes
            );
        }
    }

    #[test]
    fn parser_shell_preserves_wrapped_runtime_values_and_spread_diagnostics() {
        for expression in [
            "styles as unknown",
            "styles satisfies unknown",
            "(styles as unknown)",
            "(styles satisfies unknown)",
            "styles!",
            "((styles))",
        ] {
            let source = format!("const App=({{styles}})=><div sz={{{expression}}}/>;");
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source,
            });
            let attribute = &parsed.ir.sz_attributes[0];

            assert!(attribute.runtime_fallback, "{expression}");
            assert!(!attribute.runtime_fallback_spread, "{expression}");
        }

        for expression in [
            "{ ...props } as const",
            "{ ...props } satisfies Record<string, unknown>",
            "({ ...props } as const)",
            "({ ...props } satisfies Record<string, unknown>)",
            "({ ...props })!",
            "(({ ...props }))",
        ] {
            let source = format!("const App=({{props}})=><div sz={{{expression}}}/>;");
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source,
            });
            let attribute = &parsed.ir.sz_attributes[0];

            assert!(attribute.runtime_fallback, "{expression}");
            assert!(attribute.runtime_fallback_spread, "{expression}");
        }
    }

    #[test]
    fn parser_shell_resolves_partial_objects_through_ts_wrappers() {
        for (expression, expected_class) in [
            ("{ minW: value } as const", "min-w-(--_sz-min-w)"),
            ("{ maxW: value } satisfies object", "max-w-(--_sz-max-w)"),
            ("({ p: value } as const)", "p-(--_sz-p)"),
            ("({ m: value } satisfies object)", "m-(--_sz-m)"),
            ("({ w: value })!", "w-(--_sz-w)"),
            ("(({ h: value }))", "h-(--_sz-h)"),
        ] {
            let source = format!("const App=({{value}})=><div sz={{{expression}}}/>;");
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source,
            });
            let attribute = &parsed.ir.sz_attributes[0];
            let lowered = lower_source_ir_classes(&parsed.ir);

            assert!(parsed.diagnostics.is_empty(), "{expression}");
            assert!(!attribute.runtime_fallback, "{expression}");
            assert_eq!(attribute.dynamic_css_vars.len(), 1, "{expression}");
            assert_eq!(lowered.classes, [expected_class], "{expression}");
        }

        let source = "const EMPTY={} as const; const App=()=> <div sz={EMPTY}/>;";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });
        let attribute = &parsed.ir.sz_attributes[0];
        assert!(attribute.object.is_empty());
        assert!(attribute.rewrites_empty_class);
        assert!(!attribute.runtime_fallback);
    }

    #[test]
    fn parser_shell_preserves_static_siblings_in_nested_partial_variants() {
        let source = "const App=({value})=> <div sz={{ p: null, hover: { m: 2, w: value } }}/>;";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });
        let attribute = &parsed.ir.sz_attributes[0];
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty());
        assert!(!attribute.runtime_fallback);
        assert_eq!(attribute.object.properties.len(), 1);
        assert_eq!(attribute.dynamic_css_vars.len(), 1);
        assert_eq!(attribute.dynamic_css_vars[0].key, "w");
        assert_eq!(
            attribute.dynamic_css_vars[0].variant_prefix.as_deref(),
            Some("hover")
        );
        assert_eq!(lowered.classes, ["hover:m-2", "hover:w-(--_sz-hover-w)"]);

        for source in [
            "const App=({a,b})=> <div sz={{ ...(a ? { p: 2 } : { p: 4 }), ...(b ? { m: 1 } : { m: 3 }) }}/>;",
            "const App=()=> <div sz={{ hover: { p: () => 2 } }}/>;",
        ] {
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/Fallback.tsx".to_string(),
                source: source.to_string(),
            });
            assert!(parsed.ir.sz_attributes[0].runtime_fallback, "{source}");
        }
    }

    #[test]
    fn parser_shell_keeps_dropped_dynamic_keys_out_of_css_variables() {
        let source = "const App=({pad,size})=> <div sz={{ hover: { padding: pad }, fontSize: size, bg: 'red-500' }}/>;";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });
        let attribute = &parsed.ir.sz_attributes[0];

        assert!(!attribute.runtime_fallback);
        assert!(attribute.dynamic_css_vars.is_empty());
        assert_eq!(lower_source_ir_classes(&parsed.ir).classes, ["bg-red-500"]);
        assert!(attribute
            .dropped_dynamic_keys
            .iter()
            .any(|property| property.key == "fontSize"));
    }

    #[test]
    fn parser_shell_records_composite_jsx_element_names() {
        let source = "const App=()=> <><UI.Card szRecover='csr'/><UI.Layout.Panel szRecover='csr'/><this.View szRecover='csr'/><this szRecover='csr' data:marker='x'/><svg:path szRecover='csr'/></>;";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });
        let names = parsed
            .ir
            .jsx_opening_elements
            .iter()
            .map(|element| element.element_name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            names,
            [
                "<>",
                "UI.Card",
                "UI.Layout.Panel",
                "this.View",
                "this",
                "svg:path"
            ]
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

        let dev_only = parse_source_shell(&TransformFile {
            filename: "/repo/src/Dev.tsx".to_string(),
            source: "const Dev = () => <Panel szRecover='dev-only' />;".to_string(),
        });
        assert_eq!(
            dev_only.ir.recovery_attributes[0].mode,
            super::RecoveryMode::DevOnly
        );

        let invalid = parse_source_shell(&TransformFile {
            filename: "/repo/src/Invalid.tsx".to_string(),
            source: "const Invalid = () => <Panel szRecover='sometimes' />;".to_string(),
        });
        assert!(invalid.ir.recovery_attributes.is_empty());
        // The mode NAME is carried through so the diagnostic can quote the typo
        // back, the way the Babel and oxc lanes do.
        assert_eq!(
            invalid.ir.unsupported_recovery_attributes,
            vec![UnsupportedRecoveryIr::UnknownMode("sometimes".to_string())]
        );
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
        // A dynamic value is a different failure from a misspelled mode, and the
        // two must stay distinguishable this far down.
        assert_eq!(
            parsed.ir.unsupported_recovery_attributes,
            vec![UnsupportedRecoveryIr::NonLiteral]
        );
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
    fn parser_shell_deep_merges_nested_static_array_objects() {
        let source = "const App=()=> <div sz={[{ hover: { p: 2, m: 1 }, focus: { w: 2 } }, { hover: { p: 4, bg: 'red-500' }, focus: { h: 3 } }]} />;";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });
        let attribute = &parsed.ir.sz_attributes[0];
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty(), "{source}");
        assert!(!attribute.runtime_fallback);
        assert_eq!(
            lowered.classes,
            [
                "hover:p-4",
                "hover:m-1",
                "hover:bg-red-500",
                "focus:w-2",
                "focus:h-3",
            ]
        );
    }

    #[test]
    fn parser_shell_preserves_static_wrappers_inside_objects_and_arrays() {
        let source = "const SIZE=2; const CLASS='p-2'; const App=()=> <div sz={[CLASS, { ...({ p: 1 } satisfies object), ...({ m: 2 }!), w: SIZE!, h: undefined! }]} />;";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });
        let attribute = &parsed.ir.sz_attributes[0];
        let lowered = lower_source_ir_classes(&parsed.ir);

        assert!(parsed.diagnostics.is_empty(), "{source}");
        assert!(!attribute.runtime_fallback);
        assert_eq!(lowered.classes, ["p-1", "m-2", "w-2"]);
    }

    #[test]
    fn parser_shell_keeps_unsupported_unary_values_runtime_bound() {
        let source = "const App=({ value })=> <div sz={{ p: -value, m: ~2 }} />;";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });
        let attribute = &parsed.ir.sz_attributes[0];

        assert!(parsed.diagnostics.is_empty(), "{source}");
        assert!(!attribute.runtime_fallback);
        assert_eq!(attribute.dynamic_css_vars.len(), 2);
        assert_eq!(attribute.dynamic_css_vars[0].key, "p");
        assert_eq!(attribute.dynamic_css_vars[1].key, "m");
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
    fn keyed_candidates_survive_a_runtime_fallback_punt() {
        // An unresolvable spread punts the object to the runtime, and the
        // safelist falls back to best-effort candidates. The nested color
        // object must contribute its REAL runtime classes (bg-black/30,
        // bg-black/100) at its parent key — the old keyless walk emitted junk
        // (text-black, op-30) and missed the real ones entirely.
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const App = ({ rest, a }) => <div sz={{ ...rest, bg: { color: 'black', op: a ? 30 : 100 }, hover: { m: 2 } }} />;".to_string(),
        };

        let parsed = parse_source_shell(&file);
        let attribute = &parsed.ir.sz_attributes[0];
        assert!(attribute.runtime_fallback);
        assert!(
            attribute
                .candidate_classes
                .iter()
                .any(|class| class == "bg-black/30"),
            "combined color-opacity branch missing from candidates: {:?}",
            attribute.candidate_classes
        );
        assert!(attribute
            .candidate_classes
            .contains(&"bg-black/100".to_string()));
        assert!(attribute
            .candidate_classes
            .contains(&"hover:m-2".to_string()));
        assert!(
            !attribute
                .candidate_classes
                .iter()
                .any(|class| class == "text-black" || class == "op-30" || class == "op-100"),
            "keyless junk classes leaked into candidates: {:?}",
            attribute.candidate_classes
        );
    }

    #[test]
    fn nested_keyed_candidates_match_each_static_runtime_branch() {
        let fallback = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const App = ({ rest, active }) => <div sz={{ ...rest, bg: { palette: { tone: active ? 'red-500' : 'blue-500' } } }} />;".to_string(),
        });
        let candidates = &fallback.ir.sz_attributes[0].candidate_classes;

        assert!(fallback.ir.sz_attributes[0].runtime_fallback);
        for color in ["red-500", "blue-500"] {
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/Static.tsx".to_string(),
                source: format!(
                    "const App = () => <div sz={{{{ bg: {{ palette: {{ tone: '{color}' }} }} }}}} />;"
                ),
            });
            let expected = lower_source_ir_classes(&parsed.ir).classes;

            assert!(!expected.is_empty(), "{color}");
            assert!(
                expected.iter().all(|class| candidates.contains(class)),
                "missing {color} branch: expected {expected:?}, candidates {candidates:?}"
            );
        }
        assert!(!candidates.iter().any(|class| class == "text-red-500"));
        assert!(!candidates.iter().any(|class| class == "text-blue-500"));
    }

    #[test]
    fn candidate_walk_preserves_variants_conditionals_and_static_spreads() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const STATIC = { m: 2 } as const; const App = ({ rest, cond, runtime }) => <div sz={{ ...rest, ...STATIC, ...(cond ? { p: 6 } : { p: 8 }), hover: { p: cond ? 2 : 4, bg: { color: cond ? 'red-500' : 'blue-500', op: 30 }, borderColor: runtime }, w: cond ? 10 : runtime, h: cond ? runtime : 'full' }} />;".to_string(),
        };

        let parsed = parse_source_shell(&file);
        let attribute = &parsed.ir.sz_attributes[0];

        assert!(parsed.diagnostics.is_empty());
        assert!(attribute.runtime_fallback);
        for class in [
            "m-2",
            "p-6",
            "p-8",
            "hover:p-2",
            "hover:p-4",
            "hover:bg-red-500/30",
            "hover:bg-blue-500/30",
            "w-10",
            "h-full",
        ] {
            assert!(
                attribute
                    .candidate_classes
                    .iter()
                    .any(|found| found == class),
                "missing {class}: {:?}",
                attribute.candidate_classes
            );
        }
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
            (
                "export const App = () => <div sz={['raw', { p: 2 }] as const} />;",
                vec!["raw", "p-2"],
            ),
            (
                "export const App = () => <div sz={['raw', { m: 3 }] satisfies unknown[]} />;",
                vec!["raw", "m-3"],
            ),
            (
                "export const App = () => <div sz={['raw', { gap: 4 }]!} />;",
                vec!["raw", "gap-4"],
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
            .ternaries
            .first()
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
    fn parser_shell_enforces_szs_literal_shape_matrix() {
        for source in [
            "const X=()=> <Card szs />;",
            "const X=()=> <Card szs='p-2' />;",
            "const X=({slots})=> <Card szs={slots} />;",
            "const X=({slots})=> <Card szs={{...slots}} />;",
            "const X=({slots})=> <Card szs={{ header: { ...slots } }} />;",
            "const X=({slot})=> <Card szs={{ [slot]: { p: 2 } }} />;",
            "const X=()=> <Card szs={{ 'header': { p: 2 } }} />;",
            "const X=({value})=> <Card szs={{ header: { p: value } }} />;",
            "const X=()=> <Card szs={{ header: { p: +2 } }} />;",
            "const X=({value})=> <Card szs={{ header: { p: -value } }} />;",
            "const X=({key})=> <Card szs={{ header: { [key]: 2 } }} />;",
            "const X=()=> <Card szs={{ header: { 'p': 2 } }} />;",
            "const X=({header})=> <Card szs={{header}} />;",
        ] {
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source: source.to_string(),
            });
            assert!(parsed.ir.szs_attributes.is_empty(), "{source}");
            assert_eq!(parsed.ir.szs_diagnostics.len(), 1, "{source}");
            assert!(
                parsed.ir.szs_diagnostics[0].contains("Attribute left unchanged"),
                "{source}"
            );
        }

        let source = r#"const X=()=> <Card szs={{ header: { m: -2, opacity: true, content: "a\\b", hover: { p: 1 }, css: { zIndex: 2 } } }} />;"#;
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });
        let entry = &parsed.ir.szs_attributes[0].entries[0];

        assert!(parsed.ir.szs_diagnostics.is_empty());
        assert!(entry.class_name.contains("-m-2"));
        assert!(entry.class_name.contains("hover:p-1"));
        assert!(entry.class_name.contains("[z-index:2]"));
        assert!(entry.emit_text.contains("\\\\"));
        assert_eq!(
            escape_json_string("quote=\" line\nreturn\rtab\t slash\\"),
            "quote=\\\" line\\nreturn\\rtab\\t slash\\\\"
        );
        assert_eq!(
            string_value_span(Span::new(0, 3), "raw"),
            super::TextSpan { start: 0, end: 3 }
        );
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
            .ternaries
            .first()
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
            .ternaries
            .first()
            .expect("nested conditional should record a ternary");
        assert_eq!(ternary.consequent_classes, ["has-[:checked]:bg-red-500"]);
        assert_eq!(ternary.alternate_classes, ["has-[:checked]:bg-blue-500"]);
    }

    #[test]
    fn parser_shell_classifies_nullable_property_branches() {
        let source = "const X=({ c, value }) => <div sz={{ p: c ? null : 4, m: c ? 2 : false, w: c ? undefined : value, h: c ? null : undefined }} />;";
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        });
        let attribute = &parsed.ir.sz_attributes[0];

        assert!(parsed.diagnostics.is_empty(), "{source}");
        assert!(!attribute.runtime_fallback);
        assert_eq!(attribute.ternaries.len(), 4);
        assert_eq!(
            attribute.ternaries[0].consequent_classes,
            Vec::<String>::new()
        );
        assert_eq!(attribute.ternaries[0].alternate_classes, ["p-4"]);
        assert_eq!(attribute.ternaries[1].consequent_classes, ["m-2"]);
        assert_eq!(
            attribute.ternaries[1].alternate_classes,
            Vec::<String>::new()
        );
        assert_eq!(
            attribute.ternaries[2].consequent_classes,
            Vec::<String>::new()
        );
        assert_eq!(attribute.ternaries[2].alternate_classes, ["w-(--_sz-w)"]);
        assert_eq!(
            attribute.ternaries[3].consequent_classes,
            Vec::<String>::new()
        );
        assert_eq!(
            attribute.ternaries[3].alternate_classes,
            Vec::<String>::new()
        );
        assert_eq!(attribute.dynamic_css_vars.len(), 1);
        assert!(attribute.dynamic_css_vars[0].skip_class);
    }

    #[test]
    fn parser_shell_defers_nullable_container_values_to_runtime() {
        for present in ["[]", "() => 1", "function () {}"] {
            let source =
                format!("const X=({{ c }}) => <div sz={{{{ p: c ? null : {present} }}}} />;");
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source: source.clone(),
            });
            let attribute = &parsed.ir.sz_attributes[0];

            assert!(parsed.diagnostics.is_empty(), "{source}");
            assert!(!attribute.runtime_fallback, "{source}");
            assert!(attribute.ternaries.is_empty(), "{source}");
            assert_eq!(attribute.dynamic_css_vars.len(), 1, "{source}");
        }
    }

    #[test]
    fn parser_shell_rejects_non_color_opacity_object_shapes() {
        for property in [
            "bg: { ...rest }",
            "bg: { [key]: value }",
            "bg: { color: 123, op: value }",
            "bg: { color: c ? 1 : 'red-500' }",
            "bg: { color: c ? 'red-500' : 1 }",
            "bg: { color: c ? 'red-500' : 'blue-500', op: c ? 20 : 40 }",
        ] {
            let source =
                format!("const X=({{ c, key, rest, value }}) => <div sz={{{{ {property} }}}} />;");
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source,
            });
            let attribute = &parsed.ir.sz_attributes[0];

            assert!(attribute.runtime_fallback, "{property}");
            assert!(attribute.dynamic_css_vars.is_empty(), "{property}");
            assert!(attribute.ternaries.is_empty(), "{property}");
        }
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
            .ternaries
            .first()
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
    fn parser_shell_keeps_call_runtime_fallback_candidates_empty() {
        for source in [
            "const App = () => <div sz={makeStyles()} />;",
            "const RUNTIME = makeStyles(); const App = () => <div sz={RUNTIME} />;",
        ] {
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source: source.to_string(),
            });
            let attribute = &parsed.ir.sz_attributes[0];

            assert!(parsed.diagnostics.is_empty(), "{source}");
            assert!(attribute.runtime_fallback, "{source}");
            assert!(attribute.candidate_classes.is_empty(), "{source}");
        }
    }

    #[test]
    fn parser_shell_classifies_only_spreads_that_can_absorb_generated_style() {
        for spread in [
            "{...{}}",
            "{...{id: 'x'}}",
            "{...{style: {}}}",
            "{...{style: { flex }}}",
            "{...{style: base}}",
            "{...(active ? {style: {flex}} : {})}",
        ] {
            let source = format!(
                "const X = ({{ width, active, flex, base }}) => <div sz={{{{ w: width }}}} {spread} />;"
            );
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source,
            });
            let element = &parsed.ir.jsx_opening_elements[0];

            assert!(element.has_spread_attribute, "{spread}");
            assert!(element.safe_style_spread.is_some(), "{spread}");
        }

        for attributes in [
            "{...props}",
            "{...(active ? props : {})}",
            "{...(active ? {} : props)}",
            "{...{...props}}",
            "{...{[key]: value}}",
            "{...{style: base, style: override}}",
            "{...{}} {...props}",
            "{...{}} style={base}",
        ] {
            let source = format!(
                "const X = ({{ width, active, props, key, value, base, override }}) => <div sz={{{{ w: width }}}} {attributes} />;"
            );
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source,
            });
            let element = &parsed.ir.jsx_opening_elements[0];

            assert!(element.has_spread_attribute, "{attributes}");
            assert!(element.safe_style_spread.is_none(), "{attributes}");
        }
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

    /// Safelist candidates must survive the wrappers TypeScript authors write.
    ///
    /// These sz values all fall back to the runtime, which is correct and
    /// keeps the page rendering. What must ALSO happen is that the classes
    /// visible inside them reach the safelist, because Tailwind is configured
    /// with `source(none)` and generates a rule only for a class some build
    /// step named. Miss one and the element gets the right class attribute
    /// with no rule behind it: nothing renders, nothing warns, and the value
    /// still "works" in every unit test that only looks at the markup.
    ///
    /// Every row is a wrapper or spread shape that reaches the collector
    /// through its own arm, so one row per arm is what keeps them all alive.
    #[test]
    fn safelist_candidates_survive_typescript_wrappers_and_spreads() {
        for (what, source, expected) in [
            (
                "as const around the whole value",
                "const A = ({ base }) => <div sz={{ ...base, p: 4 } as const} />;",
                vec!["p-4"],
            ),
            (
                "satisfies around the whole value",
                "const A = ({ base }) => <div sz={{ ...base, p: 4 } satisfies Sz} />;",
                vec!["p-4"],
            ),
            (
                "a non-null assertion around the whole value",
                "const A = ({ base }) => <div sz={{ ...base, p: 4 }!} />;",
                vec!["p-4"],
            ),
            (
                "parentheses around the whole value",
                "const A = ({ base }) => <div sz={({ ...base, p: 4 })} />;",
                vec!["p-4"],
            ),
            (
                "a wrapper on the spread argument itself",
                "const BASE = { m: 2 } as const;\nconst A = ({ rest }) => <div sz={{ ...(BASE as const), p: 4, ...rest }} />;",
                vec!["m-2", "p-4"],
            ),
            (
                "a guarded object inside an array with a spread",
                "const BASE = { m: 2 } as const;\nconst A = ({ rest, cond }) => <div sz={[BASE, cond && { p: 4 }, ...rest]} />;",
                vec!["m-2", "p-4"],
            ),
            (
                "a named object inside an array with a spread",
                "const BASE = { m: 2 };\nconst A = ({ rest }) => <div sz={[BASE, ...rest]} />;",
                vec!["m-2"],
            ),
            (
                "a parametric variant nested under a spread",
                "const A = ({ x }) => <div sz={{ ...x, 'data-[open]': { p: 4 } }} />;",
                vec!["data-[open]:p-4"],
            ),
            (
                "a nested value object under a property key",
                "const A = ({ x }) => <div sz={{ ...x, bg: { color: 'black' } }} />;",
                vec!["bg-black"],
            ),
        ] {
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source: source.to_string(),
            });
            let lowered = lower_source_ir_classes(&parsed.ir);

            for class in expected {
                assert!(
                    lowered.classes.iter().any(|found| found == class),
                    "{what}: expected {class} in the safelist, got {:?}\n{source}",
                    lowered.classes
                );
            }
        }
    }

    /// A spread of a named object stays STATIC through its wrappers.
    ///
    /// This shape is the ordinary way a component library shares a base style,
    /// and losing a wrapper here costs more than the safelist: the value stops
    /// resolving at build time, so the whole attribute falls back to a runtime
    /// call that a zero-runtime build was never meant to make. The assertion
    /// is on the resolved half — no fallback, both halves of the merged object
    /// present — because a candidate-only check would still pass while the
    /// static resolution quietly disappeared.
    #[test]
    fn a_spread_of_a_named_object_resolves_through_its_wrappers() {
        for (what, source) in [
            (
                "as const",
                "const BASE = { m: 2 };\nconst A = () => <div sz={{ ...(BASE as const), p: 4 }} />;",
            ),
            (
                "satisfies",
                "const BASE = { m: 2 };\nconst A = () => <div sz={{ ...(BASE satisfies Sz), p: 4 }} />;",
            ),
            (
                "a non-null assertion",
                "const BASE = { m: 2 };\nconst A = () => <div sz={{ ...BASE!, p: 4 }} />;",
            ),
            (
                "parentheses",
                "const BASE = { m: 2 };\nconst A = () => <div sz={{ ...(BASE), p: 4 }} />;",
            ),
        ] {
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source: source.to_string(),
            });
            let lowered = lower_source_ir_classes(&parsed.ir);

            assert!(
                !parsed.ir.sz_attributes[0].runtime_fallback,
                "{what}: must resolve at build time"
            );
            assert_eq!(lowered.classes, ["m-2", "p-4"], "{what}");
        }
    }

    /// An array element that could be an object at runtime is NOT provable.
    ///
    /// The bundler reads this flag to pick between the full `_szPart` and a
    /// string-only slim build. Claiming an unknown element is provably a
    /// string ships the slim helper, which has no object lowering at all, so
    /// `sz={["btn", extraStyles]}` renders the string and drops every style
    /// in the object beside it. The flag only ever fails in that direction,
    /// which is why the true case is asserted alongside it.
    #[test]
    fn an_array_element_that_might_be_an_object_is_not_provable() {
        for source in [
            // A bare identifier: nothing here says it is not an object.
            "const A = ({ extra }) => <div sz={['btn', extra]} />;",
            // A member expression is just as opaque.
            "const A = ({ theme }) => <div sz={['btn', theme.extra]} />;",
            // One object branch is enough to disqualify the whole ternary.
            "const A = ({ on, extra }) => <div sz={['btn', on ? 'a' : extra]} />;",
            // A call result is unknown at build time.
            "const A = ({ make }) => <div sz={['btn', make()]} />;",
        ] {
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source: source.to_string(),
            });
            let parts = &parsed.ir.sz_attributes[0].array_parts;
            assert!(
                parts.iter().any(|part| part.dynamic_span.is_some()),
                "fixture must produce a dynamic part: {source}"
            );
            assert!(
                parts
                    .iter()
                    .filter(|part| part.dynamic_span.is_some())
                    .all(|part| !part.dynamic_provable),
                "an opaque element must not be called provable: {source}"
            );
        }

        // The other direction, so the flag cannot be pinned by refusing every
        // element: a template literal is a string by construction.
        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const A = ({ n }) => <div sz={['btn', `pad-${n}`]} />;".to_string(),
        });
        assert!(parsed.ir.sz_attributes[0]
            .array_parts
            .iter()
            .filter(|part| part.dynamic_span.is_some())
            .all(|part| part.dynamic_provable));
    }

    /// Only `&&` makes an array element a conditional style.
    ///
    /// `a && obj` applies obj when a is truthy; `a || obj` and `a ?? obj`
    /// apply it when a is FALSY. Reading the last two as guards keeps the
    /// object but inverts the condition, so the styles land on exactly the
    /// renders that were supposed to go without them — a bug that looks like
    /// application logic rather than compilation.
    #[test]
    fn only_an_and_guard_becomes_a_conditional_array_part() {
        for source in [
            "const A = ({ cond }) => <div sz={[cond ?? { p: 8 }]} />;",
            "const A = ({ cond }) => <div sz={[cond || { p: 8 }]} />;",
        ] {
            let parsed = parse_source_shell(&TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source: source.to_string(),
            });
            let parts = &parsed.ir.sz_attributes[0].array_parts;
            assert_eq!(parts.len(), 1, "{source}");
            assert!(
                parts[0].condition_span.is_none(),
                "{source} must not compile as a guarded part"
            );
            assert!(
                parts[0].dynamic_span.is_some(),
                "{source} must stay a runtime element"
            );
        }

        let parsed = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const A = ({ cond }) => <div sz={[cond && { p: 8 }]} />;".to_string(),
        });
        let parts = &parsed.ir.sz_attributes[0].array_parts;
        assert!(parts[0].condition_span.is_some(), "&& IS a guard");
        assert_eq!(parts[0].classes, ["p-8"]);
    }
}
