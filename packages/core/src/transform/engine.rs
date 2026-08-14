//! Native transform engine assembly.
//!
//! This module connects parser output, class lowering, and the public transform
//! result contract without enabling source rewrite yet.

use super::{
    css_var_planner::apply_css_variable_mangling,
    fast_path::{triage_source, FastPathTriage},
    global_var_aliases::apply_global_var_aliases,
    lower::{collect_unknown_sz_keys, lower_source_ir_classes},
    parser::{parse_source_shell_with_registries, CrossModuleRegistries, AST_BUDGET},
    recovery::{generate_inline_recovery_token, offset_to_line_column, LineIndex},
    rewrite::rewrite_static_sz_attributes,
    DynamicCssVarCategory, ParserPath, RecoveryToken, TransformFile, TransformMetadata,
    TransformOptions, TransformProducer, TransformResult, TransformTimings, UnsupportedRecoveryIr,
};
#[cfg(not(target_arch = "wasm32"))]
use std::time::Instant;

/// Clock stub for wasm32, which has no `std::time` clock source.
///
/// `Instant::now()` panics under `wasm32-unknown-unknown`; the engine only
/// uses it for the optional timings instrumentation, so a zero clock keeps
/// the transform itself intact.
#[cfg(target_arch = "wasm32")]
#[derive(Clone, Copy)]
pub(crate) struct Instant;

#[cfg(target_arch = "wasm32")]
impl Instant {
    pub(crate) fn now() -> Self {
        Self
    }

    pub(crate) fn elapsed(self) -> core::time::Duration {
        core::time::Duration::ZERO
    }
}

/// Maximum structural nesting depth of `{}`/`[]`/`()` allowed in a source file
/// before it is handed to the parser.
///
/// oxc's recursive-descent parser overflows the call stack on pathologically
/// nested input — e.g. a code generator that emits `{ hover: { hover: … } }`
/// hundreds of levels deep. A stack overflow is a FATAL process abort, not a
/// catchable panic, so it would crash the whole bundler (a build-time DoS) and
/// is invisible to the parser's `catch_unwind`. 64 is far above any legitimate
/// single-file nesting (deep JSX / data literals top out around 20-30) yet far
/// below the overflow threshold (~800), so it converts the abort into a graceful,
/// file-unchanged diagnostic. The runtime sz-object depth is bounded separately
/// (`MAX_SZ_DEPTH`); this guards the build-time source-parsing layer.
const MAX_SOURCE_NESTING_DEPTH: usize = 64;

/// Deepest `{[(` nesting in `source`, ignoring brackets inside string/template
/// literals and `//` / `/* */` comments.
///
/// A coarse pre-parse safety scan, NOT a tokenizer: it skips quoted/templated
/// spans and comments so a string or regex containing braces never trips the
/// guard, and otherwise counts structural bracket depth. Operates on bytes;
/// multi-byte UTF-8 sequences never match an ASCII bracket/quote and are simply
/// stepped over.
const fn max_source_nesting_depth(source: &str) -> usize {
    let bytes = source.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    let mut depth: usize = 0;
    let mut max_depth: usize = 0;
    while i < len {
        let c = bytes[i];
        if c == b'/' && i + 1 < len && bytes[i + 1] == b'/' {
            i += 2;
            while i < len && bytes[i] != b'\n' {
                i += 1;
            }
        } else if c == b'/' && i + 1 < len && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < len && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i += 2;
        } else if c == b'\'' || c == b'"' || c == b'`' {
            i += 1;
            while i < len {
                if bytes[i] == b'\\' {
                    i += 2;
                    continue;
                }
                if bytes[i] == c {
                    i += 1;
                    break;
                }
                i += 1;
            }
        } else if c == b'{' || c == b'[' || c == b'(' {
            depth += 1;
            if depth > max_depth {
                max_depth = depth;
            }
            i += 1;
        } else if c == b'}' || c == b']' || c == b')' {
            depth = depth.saturating_sub(1);
            i += 1;
        } else {
            i += 1;
        }
    }
    max_depth
}

/// Transform one file through fast-path triage and parser-backed static rewrite.
pub(super) fn transform_file(file: &TransformFile) -> TransformResult {
    transform_file_with_options(file, TransformOptions::default())
}

/// Transform one file through fast-path triage and parser-backed static rewrite.
pub(super) fn transform_file_with_options(
    file: &TransformFile,
    options: TransformOptions,
) -> TransformResult {
    let total_start = Instant::now();
    let triage_start = Instant::now();
    // Bail before the parser on pathologically nested source: the recursive
    // parser would overflow the stack and abort the process. Leave the file
    // unchanged and surface an actionable diagnostic instead.
    let nesting_depth = max_source_nesting_depth(&file.source);
    if nesting_depth > MAX_SOURCE_NESTING_DEPTH {
        let mut result = noop_result(file);
        result.diagnostics.push(format!(
            "[csszyx] {}: source nesting exceeded {MAX_SOURCE_NESTING_DEPTH} levels (found {nesting_depth}) — this usually means accidentally or programmatically over-nested sz/JSX. Flatten the structure. (This guard prevents a parser stack overflow.)",
            file.filename
        ));
        result.metadata.timings.triage_ns = elapsed_ns(triage_start);
        result.metadata.timings.total_ns = elapsed_ns(total_start);
        return result;
    }
    match triage_source(file) {
        FastPathTriage::Noop(_) => {
            let mut result = noop_result(file);
            result.metadata.timings.triage_ns = elapsed_ns(triage_start);
            result.metadata.timings.total_ns = elapsed_ns(total_start);
            result
        }
        FastPathTriage::StaticIr(ir) => {
            let triage_ns = elapsed_ns(triage_start);
            transform_fast_static_ir_with_options(file, &ir, triage_ns, total_start, &options)
        }
        FastPathTriage::NeedsParser(_) => {
            let triage_ns = elapsed_ns(triage_start);
            transform_static_classes_with_options(file, triage_ns, total_start, options)
        }
    }
}

fn transform_fast_static_ir_with_options(
    file: &TransformFile,
    ir: &super::SourceIr,
    triage_ns: u64,
    total_start: Instant,
    options: &TransformOptions,
) -> TransformResult {
    let global_var_aliases = (!options.global_var_aliases.is_empty())
        .then(|| apply_global_var_aliases(ir, &options.global_var_aliases));
    let lower_ir = global_var_aliases
        .as_ref()
        .map_or(ir, |aliases| &aliases.ir);
    let lower_start = Instant::now();
    let lowered = lower_source_ir_classes(lower_ir);
    let lower_ns = elapsed_ns(lower_start);
    let rewrite_start = Instant::now();
    let rewritten_code = rewrite_static_sz_attributes(&file.source, &file.filename, lower_ir).ok();
    let rewrite_ns = elapsed_ns(rewrite_start);
    let transformed = rewritten_code.is_some();

    TransformResult {
        code: rewritten_code.unwrap_or_else(|| file.source.clone()),
        map: None,
        classes: lowered.classes,
        raw_class_names: lowered.raw_class_names,
        diagnostics: {
            let mut diagnostics =
                unknown_property_diagnostics(file, lower_ir, options.root_dir.as_deref());
            diagnostics.extend(lower_ir.szs_diagnostics.iter().cloned());
            diagnostics
        },
        recovery_tokens: Vec::new(),
        css_variable_map: global_var_aliases
            .map(|aliases| aliases.variable_map)
            .unwrap_or_default(),
        metadata: TransformMetadata {
            transformed,
            uses_runtime: false,
            uses_merge: false,
            uses_szcn: false,
            uses_sz_part: false,
            uses_szv_pick: false,
            uses_szv_pick1: false,
            sz_part_args_provable: true,
            uses_color_var: false,
            uses_spacing_var: false,
            uses_unit_var: false,
            uses_bool_class: false,
            producer: TransformProducer::Rust,
            ast_budget_exceeded: false,
            timings: TransformTimings {
                triage_ns,
                lower_ns,
                rewrite_ns,
                total_ns: elapsed_ns(total_start),
                ..TransformTimings::default()
            },
        },
        parser_path: ParserPath::FastRegex,
    }
}

/// Parse and lower a file into the native transform result shape without
/// mutating source code.
fn transform_static_classes(
    file: &TransformFile,
    triage_ns: u64,
    total_start: Instant,
) -> TransformResult {
    transform_static_classes_with_options(file, triage_ns, total_start, TransformOptions::default())
}

#[allow(clippy::too_many_lines, clippy::needless_pass_by_value)]
fn transform_static_classes_with_options(
    file: &TransformFile,
    triage_ns: u64,
    total_start: Instant,
    options: TransformOptions,
) -> TransformResult {
    let cross_module = options
        .cross_module_statics_json
        .as_deref()
        .map(super::szv_precompile::decode_cross_module_statics)
        .unwrap_or_default();
    let cross_module_sz_objects = options
        .cross_module_sz_objects_json
        .as_deref()
        .map(super::szv_precompile::decode_cross_module_statics)
        .unwrap_or_default();
    let parsed = parse_source_shell_with_registries(
        file,
        options.ast_budget.unwrap_or(AST_BUDGET),
        CrossModuleRegistries {
            szv_factories: &cross_module,
            sz_objects: &cross_module_sz_objects,
        },
    );
    let global_var_aliases = (!options.global_var_aliases.is_empty())
        .then(|| apply_global_var_aliases(&parsed.ir, &options.global_var_aliases));
    let alias_ir = global_var_aliases
        .as_ref()
        .map_or(&parsed.ir, |aliases| &aliases.ir);
    let css_var_mangling = options.mangle_vars.then(|| {
        apply_css_variable_mangling(alias_ir, &file.source, options.mangle_var_hoist_max_depth)
    });
    let lower_ir = css_var_mangling
        .as_ref()
        .map_or(alias_ir, |mangling| &mangling.ir);
    let lower_start = Instant::now();
    let lowered = lower_source_ir_classes(lower_ir);
    let lower_ns = elapsed_ns(lower_start);
    let recovery_start = Instant::now();
    let recovery_tokens = recovery_tokens(file, &parsed.ir);
    let recovery_ns = elapsed_ns(recovery_start);
    let diagnostics_start = Instant::now();
    let mut diagnostics = parsed.diagnostics;
    // Per-element warnings about unsupported sz/szRecover shapes are soft —
    // the rewrite pass already skips those elements individually, so they
    // must not block the rest of the file from transforming. The oxc-JS
    // path has the same contract: a warning on one element keeps the
    // valid ones flowing through className/recovery-token emission.
    let has_parser_errors = !diagnostics.is_empty();
    diagnostics.extend(unsupported_sz_diagnostics(file, &parsed.ir));
    // One line table per file, built lazily on the first position lookup: a
    // file that reports nothing must not pay a pass over its own source.
    let mut lines: Option<LineIndex> = None;
    diagnostics.extend(runtime_fallback_diagnostics(file, &parsed.ir, &mut lines));
    diagnostics.extend(site_fallback_diagnostics(file, &parsed.ir, &mut lines));
    diagnostics.extend(style_spread_collision_diagnostics(file, &parsed.ir));
    diagnostics.extend(deferred_array_object_diagnostics(file, &parsed.ir));
    diagnostics.extend(unsupported_recovery_diagnostics(file, &parsed.ir));
    diagnostics.extend(unknown_property_diagnostics(
        file,
        &parsed.ir,
        options.root_dir.as_deref(),
    ));
    diagnostics.extend(parsed.ir.szs_diagnostics.iter().cloned());
    if parsed.ast_budget_exceeded {
        diagnostics.push(format!(
            "[csszyx] AST budget exceeded in {}: the IR walk stopped mid-file, so the file was \
             left unchanged and contributes NO classes to the safelist. Raise `build.astBudgetLimit` \
             or split the file.",
            file.filename
        ));
    }
    if let Some(mangling) = &css_var_mangling {
        diagnostics.extend(mangling.diagnostics.iter().cloned());
    }
    let diagnostics_ns = elapsed_ns(diagnostics_start);
    let rewrite_start = Instant::now();
    let rewritten_code = if has_parser_errors || parsed.ast_budget_exceeded || parsed.panicked {
        None
    } else {
        rewrite_static_sz_attributes(&file.source, &file.filename, lower_ir).ok()
    };
    let rewrite_ns = elapsed_ns(rewrite_start);
    let transformed = rewritten_code.is_some();

    if parsed.panicked {
        diagnostics.push("oxc parser panicked before csszyx lowering completed".to_string());
    }

    // Runtime helper flags for downstream import-injection, mirroring the
    // oxc-JS pipeline so caches built against one producer stay valid for the
    // other. sz arrays compose through `szcn` (later-wins per property group),
    // with dynamic elements resolving through `_szPart`; `_szMerge` remains
    // the className+sz merge helper and `_sz` the whole-value runtime
    // fallback.
    let uses_szcn = transformed
        && parsed
            .ir
            .sz_attributes
            .iter()
            .any(|attr| !attr.array_parts.is_empty());
    let uses_sz_part = transformed
        && parsed.ir.sz_attributes.iter().any(|attr| {
            attr.array_parts
                .iter()
                .any(|part| part.dynamic_span.is_some())
        });
    // Vacuously true with no dynamic parts; false as soon as one part could
    // be an object at runtime.
    let sz_part_args_provable = parsed.ir.sz_attributes.iter().all(|attr| {
        attr.array_parts
            .iter()
            .all(|part| part.dynamic_span.is_none() || part.dynamic_provable)
    });
    let uses_merge = transformed
        && parsed.ir.jsx_opening_elements.iter().any(|element| {
            let Some(class_index) = element.class_attribute_index else {
                return false;
            };
            let class_attribute = &parsed.ir.class_attributes[class_index];
            let has_runtime_like_sz = element.sz_attribute_indices.iter().any(|index| {
                let attribute = &parsed.ir.sz_attributes[*index];
                // Arrays merge their className through szcn, not _szMerge.
                (attribute.runtime_fallback || !attribute.ternaries.is_empty())
                    && attribute.array_parts.is_empty()
            });
            let has_static_sz = element
                .sz_attribute_indices
                .iter()
                .any(|index| parsed.ir.sz_attributes[*index].array_parts.is_empty());
            has_runtime_like_sz || (class_attribute.expression_span.is_some() && has_static_sz)
        });
    let uses_runtime = transformed
        && (uses_merge
            || parsed
                .ir
                .sz_attributes
                .iter()
                .any(|attr| attr.runtime_fallback));
    let uses_color_var = transformed
        && parsed.ir.sz_attributes.iter().any(|attr| {
            attr.dynamic_css_vars
                .iter()
                .any(|prop| prop.category == DynamicCssVarCategory::Color)
        });
    let uses_spacing_var = transformed
        && parsed.ir.sz_attributes.iter().any(|attr| {
            attr.dynamic_css_vars
                .iter()
                .any(|prop| prop.category == DynamicCssVarCategory::Spacing)
        });
    let uses_unit_var = transformed
        && parsed.ir.sz_attributes.iter().any(|attr| {
            attr.dynamic_css_vars.iter().any(|prop| {
                matches!(
                    prop.category,
                    DynamicCssVarCategory::Angle | DynamicCssVarCategory::Duration
                )
            })
        });
    // Array elements carry their conditional on the part, so both homes count.
    let uses_bool_class = transformed
        && parsed.ir.sz_attributes.iter().any(|attr| {
            attr.ternaries
                .iter()
                .chain(
                    attr.array_parts
                        .iter()
                        .filter_map(|part| part.ternary.as_ref()),
                )
                .any(|ternary| ternary.bool_class_key.is_some())
        });

    // A budget-tripped walk produced a PARTIAL IR: whichever classes happen to
    // sit before the cut would flow into the safelist and the rest silently
    // vanish — under Tailwind `source(none)` that is wrong CSS with no signal
    // (and a rust-vs-oxc parity break, since the JS engines throw instead).
    // Contribute nothing and let the diagnostic above carry the loud skip.
    let (classes, raw_class_names) = if parsed.ast_budget_exceeded {
        (Vec::new(), Vec::new())
    } else {
        (lowered.classes, lowered.raw_class_names)
    };

    TransformResult {
        code: rewritten_code.unwrap_or_else(|| file.source.clone()),
        map: None,
        classes,
        raw_class_names,
        diagnostics,
        recovery_tokens,
        css_variable_map: merge_variable_maps(
            global_var_aliases.map(|aliases| aliases.variable_map),
            css_var_mangling.map(|mangling| mangling.variable_map),
        ),
        metadata: TransformMetadata {
            transformed,
            uses_runtime,
            uses_merge,
            uses_szcn,
            uses_sz_part,
            sz_part_args_provable,
            uses_szv_pick: parsed.ir.uses_szv_pick,
            uses_szv_pick1: parsed.ir.uses_szv_pick1,
            uses_color_var,
            uses_spacing_var,
            uses_unit_var,
            uses_bool_class,
            producer: TransformProducer::Rust,
            ast_budget_exceeded: parsed.ast_budget_exceeded,
            timings: TransformTimings {
                triage_ns,
                parse_ns: parsed.timings.parse_ns,
                scope_ns: parsed.timings.scope_ns,
                ir_ns: parsed.timings.ir_ns,
                lower_ns,
                recovery_ns,
                diagnostics_ns,
                rewrite_ns,
                total_ns: elapsed_ns(total_start),
            },
        },
        parser_path: ParserPath::Static,
    }
}

fn recovery_tokens(file: &TransformFile, ir: &super::SourceIr) -> Vec<RecoveryToken> {
    ir.jsx_opening_elements
        .iter()
        .filter(|element| !element.has_recovery_token_attribute)
        .filter_map(|element| {
            let recovery_index = element.recovery_attribute_index?;
            let recovery = &ir.recovery_attributes[recovery_index];
            let (line, column) = offset_to_line_column(&file.source, recovery.attribute_span.start);
            let token =
                generate_inline_recovery_token(&file.filename, line, column, &element.element_name);

            Some(RecoveryToken {
                token,
                mode: recovery.mode,
                component: element.element_name.clone(),
                path: format!("{}:{line}:{column}", file.filename),
            })
        })
        .collect()
}

fn merge_variable_maps(
    first: Option<Vec<super::CssVariableMapEntry>>,
    second: Option<Vec<super::CssVariableMapEntry>>,
) -> Vec<super::CssVariableMapEntry> {
    let mut merged = Vec::new();
    for entry in first
        .into_iter()
        .flatten()
        .chain(second.into_iter().flatten())
    {
        if merged.iter().any(|existing: &super::CssVariableMapEntry| {
            existing.original == entry.original && existing.mangled == entry.mangled
        }) {
            continue;
        }
        merged.push(entry);
    }
    merged
}

fn unsupported_sz_diagnostics(file: &TransformFile, ir: &super::SourceIr) -> Vec<String> {
    ir.unsupported_sz_attribute_spans
        .iter()
        .map(|span| {
            format!(
                "[csszyx] Rust native transform at {}:{}: unsupported dynamic sz attribute; leaving file unchanged for now.",
                file.filename, span.start
            )
        })
        .collect()
}

/// Resolve a byte offset to Babel-compatible `line:column` — 1-based line,
/// 1-based column counted in UTF-16 code units, because that is what
/// `expression.loc.start.column + 1` produces on the JS lanes and the three
/// engines must print identical positions.
fn babel_line_column(source: &str, lines: &mut Option<LineIndex>, offset: u32) -> (u32, usize) {
    let (line, byte_column) = lines
        .get_or_insert_with(|| LineIndex::new(source))
        .line_column(source, offset);
    let end = offset.min(u32::try_from(source.len()).unwrap_or(u32::MAX)) as usize;
    let start = end - byte_column as usize;
    (line, source[start..end].encode_utf16().count() + 1)
}

/// Build-log diagnostics for `szr`/`szv` calls whose argument the parser could
/// not read.
///
/// Same wording, order and `line:column` semantics as the JS lanes — the site
/// label and the advice come from the shared matrix, so a `build.parser` flip
/// cannot change the text.
fn site_fallback_diagnostics(
    file: &TransformFile,
    ir: &super::SourceIr,
    lines: &mut Option<LineIndex>,
) -> Vec<String> {
    use super::generated::sz_fallback_matrix::{
        format_sz_fallback_diagnostic, SzFallbackKind, SzFallbackSite,
    };
    use super::{RuntimeFallbackKindIr, SzFallbackSiteIr};

    ir.site_fallbacks
        .iter()
        .map(|fallback| {
            let (line, column) = babel_line_column(&file.source, lines, fallback.offset);
            let kind = match fallback.kind {
                RuntimeFallbackKindIr::Call => SzFallbackKind::Call,
                RuntimeFallbackKindIr::Identifier => SzFallbackKind::Identifier,
                RuntimeFallbackKindIr::Import => SzFallbackKind::Import,
                RuntimeFallbackKindIr::Member => SzFallbackKind::Member,
                RuntimeFallbackKindIr::Other => SzFallbackKind::Other,
                RuntimeFallbackKindIr::SzvFactory => SzFallbackKind::SzvFactory,
            };
            let site = match fallback.site {
                SzFallbackSiteIr::Szr => SzFallbackSite::Szr,
                SzFallbackSiteIr::Szv => SzFallbackSite::Szv,
            };
            format_sz_fallback_diagnostic(
                site,
                &format!("{line}:{column}"),
                kind,
                &fallback.detail,
                &fallback.path,
            )
        })
        .collect()
}

/// Build-log diagnostics for `sz` props left to the runtime `_sz(...)` helper.
///
/// Emits the shared fallback matrix entry (why, and what to do instead) and —
/// for an object literal with a top-level spread — the unresolvable-spread
/// notice, in the same per-attribute order and with the same wording and
/// `line:column` positions as the Babel and oxc lanes, so a `build.parser`
/// flip cannot change the build log. The `unresolvable sz spread` phrase is
/// the marker the bundler plugin matches to promote those to a build-log
/// warning in every mode.
fn runtime_fallback_diagnostics(
    file: &TransformFile,
    ir: &super::SourceIr,
    lines: &mut Option<LineIndex>,
) -> Vec<String> {
    use super::generated::sz_fallback_matrix::{
        sz_fallback_reason, sz_fallback_suggestion, SzFallbackKind,
    };
    use super::RuntimeFallbackKindIr;

    let mut out = Vec::new();
    for attr in &ir.sz_attributes {
        let Some(diagnostic) = &attr.runtime_fallback_diagnostic else {
            continue;
        };
        let (line, column) = babel_line_column(&file.source, lines, attr.value_span.start);
        let kind = match diagnostic.kind {
            RuntimeFallbackKindIr::Call => SzFallbackKind::Call,
            RuntimeFallbackKindIr::Identifier => SzFallbackKind::Identifier,
            RuntimeFallbackKindIr::Import => SzFallbackKind::Import,
            RuntimeFallbackKindIr::Member => SzFallbackKind::Member,
            // An sz attribute never carries factory-level knowledge; the
            // variant exists for the szr site alone.
            RuntimeFallbackKindIr::Other | RuntimeFallbackKindIr::SzvFactory => {
                SzFallbackKind::Other
            }
        };
        let reason = sz_fallback_reason(kind, &diagnostic.detail, "");
        let suggestion = sz_fallback_suggestion(kind);
        out.push(format!(
            "sz fallback at {line}:{column}: {reason}.
  Suggestion: {suggestion}"
        ));
        if attr.runtime_fallback_spread {
            out.push(format!(
                "[csszyx] unresolvable sz spread at {line}:{column}: sz={{{{ ...x }}}} cannot be resolved at build time and falls back to runtime; it may render no styles in production. Use array form: sz={{[x, {{ ... }}]}}."
            ));
        }
    }
    out
}

/// Warn when generated style custom properties share an element with a prop
/// spread that may also provide `style`. The explicit generated attribute wins
/// in JSX source order, so the spread style can otherwise disappear silently.
fn style_spread_collision_diagnostics(file: &TransformFile, ir: &super::SourceIr) -> Vec<String> {
    ir.jsx_opening_elements
        .iter()
        .filter(|element| element.has_spread_attribute)
        .filter(|element| element.safe_style_spread.is_none())
        .filter(|element| {
            !element.hoisted_dynamic_css_vars.is_empty()
                || element.sz_attribute_indices.iter().any(|index| {
                    ir.sz_attributes[*index]
                        .dynamic_css_vars
                        .iter()
                        .any(|property| !property.hoisted)
                })
        })
        .map(|_| {
            format!(
                "[csszyx] possible style override at {}: this element spreads props that may contain style, while sz emits an explicit style attribute. Move the spread style to an explicit style prop so csszyx can merge both values.",
                file.filename
            )
        })
        .collect()
}

/// Dev-mode build-log diagnostics for unrecognized sz property keys (likely
/// typos), located by file and line so they are findable in a large codebase —
/// parity with the oxc/Babel engines, which previously were the only ones to
/// warn. The bundler plugin gates these to dev (and suppresses source paths in
/// production), the same as the other soft diagnostics here.
/// Matches the JS engines' `/^\d+(?:\.\d+)?$/` — a bare integer or decimal, the
/// shape of an array index or a spread's numeric key that reached `sz`.
fn is_numeric_key(key: &str) -> bool {
    let (int, frac) = key
        .split_once('.')
        .map_or((key, None), |(i, f)| (i, Some(f)));
    !int.is_empty()
        && int.bytes().all(|b| b.is_ascii_digit())
        && frac.is_none_or(|f| !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit()))
}

fn unknown_property_diagnostics(
    file: &TransformFile,
    ir: &super::SourceIr,
    root_dir: Option<&str>,
) -> Vec<String> {
    let location = relativize_diagnostic_path(&file.filename, root_dir);
    let mut out = Vec::new();
    let mut unknown = Vec::new();
    let mut dead_steps = Vec::new();
    let mut property_objects = Vec::new();
    let mut mask_members = Vec::new();
    // Built on the first position lookup, not up front: a file whose `sz` props
    // are all clean reaches none of the branches below, and must not pay a pass
    // over its own source for a table nobody reads.
    let mut lines: Option<LineIndex> = None;
    // sz props first, then the catalog objects (szv leaves + static szr
    // arguments) through the SAME unknown/numeric emission — a typo inside a
    // catalog must be as findable by `csszyx check` as one on an element.
    let attribute_objects = ir
        .sz_attributes
        .iter()
        .map(|attr| (&attr.object, attr.removed_dynamic_keys.as_slice()));
    let catalog_objects = ir.catalog_sz_objects.iter().map(|object| (object, &[][..]));
    for (object, removed_dynamic_keys) in attribute_objects.chain(catalog_objects) {
        unknown.clear();
        collect_unknown_sz_keys(object, &mut unknown);
        unknown.extend(
            removed_dynamic_keys
                .iter()
                .map(|removed| (removed.key.clone(), removed.span.start)),
        );
        for (key, offset) in &unknown {
            let (line, _) = lines
                .get_or_insert_with(|| LineIndex::new(&file.source))
                .line_column(&file.source, *offset);
            // A numeric key is almost never a typo — it means an array or a spread
            // reached `sz`. Match the JS engines' wording so a `build.parser` flip
            // does not change the diagnostic text.
            if let Some(note) = super::generated::tables::key_migration_note(key) {
                // Wording mirrors the runtime channel's unknownSzPropertyMessage
                // so the same key reads the same everywhere.
                out.push(format!(
                    "[csszyx] \"{key}\" was removed at {location}:{line}: {note}."
                ));
            } else if let Some(suggestion) = super::generated::tables::key_suggestion(key) {
                out.push(format!(
                    "[csszyx] Use the canonical key \"{suggestion}\" instead of \"{key}\" at {location}:{line}."
                ));
            } else if is_numeric_key(key) {
                out.push(format!(
                    "[csszyx] sz received a numeric key \"{key}\" at {location}:{line}. This usually means an array or a spread was passed where an object of sz keys was expected. The value is ignored."
                ));
            } else {
                // Wording mirrors the JS lanes byte for byte. Deliberately NOT
                // "this will be ignored": the key is lowered as a literal class
                // exactly like a known one, so the old text sent people looking
                // for a missing class instead of a dead one.
                out.push(format!(
                    "[csszyx] Unknown property \"{key}\" in sz prop at {location}:{line}. The class is still emitted, so it styles nothing unless Tailwind serves that utility. Check for typos. If the class is intentional, define it with Tailwind's @utility."
                ));
            }
        }
        dead_steps.clear();
        super::lower::collect_dead_spacing_steps(object, &mut dead_steps);
        for (key, value, offset) in &dead_steps {
            let (line, _) = lines
                .get_or_insert_with(|| LineIndex::new(&file.source))
                .line_column(&file.source, *offset);
            // Wording matches the JS engines' warnDeadSpacingStep so a
            // `build.parser` flip does not change the diagnostic text.
            out.push(format!(
                "[csszyx] \"{key}: {value}\" at {location}:{line}: {value} is not on Tailwind's spacing scale (quarter steps only), so the class generates no CSS. Use a quarter step (1.25, 1.5, 1.75) or a unit value (\"{value}rem\")."
            ));
        }
        property_objects.clear();
        super::lower::collect_property_object_values(object, &mut property_objects);
        for (key, nested, offset) in &property_objects {
            let (line, _) = lines
                .get_or_insert_with(|| LineIndex::new(&file.source))
                .line_column(&file.source, *offset);
            // Wording matches the JS engines' warnPropertyObjectValue so a
            // `build.parser` flip does not change the diagnostic text.
            out.push(format!(
                "[csszyx] \"{key}\" is a property, not a variant, but received an object {{ {nested} }} at {location}:{line}. This compiles to \"{key}:*\" classes that match no Tailwind variant and generate no CSS. Move the nested keys up a level, or for color opacity use {{ color: '...', op: ... }}."
            ));
        }
        mask_members.clear();
        super::lower::collect_unknown_mask_slot_members(object, &mut mask_members);
        for (owner, member, allowed, offset) in &mask_members {
            let (line, _) = lines
                .get_or_insert_with(|| LineIndex::new(&file.source))
                .line_column(&file.source, *offset);
            // Wording matches the JS engines' warnMaskSlotMember so a
            // `build.parser` flip does not change the diagnostic text.
            out.push(format!(
                "[csszyx] {owner}: unknown field \"{member}\" at {location}:{line} — nothing is emitted for it. {owner} takes {{ {allowed} }}."
            ));
        }
    }
    out
}

/// Strip the project-root prefix from a diagnostic filename so it reads
/// `src/Foo.tsx`, not an absolute path. Mirrors the JS `formatSzWarnLocation`
/// prefix strip; falls back to the filename as given when no root is known or it
/// is not a prefix.
fn relativize_diagnostic_path(filename: &str, root_dir: Option<&str>) -> String {
    if let Some(root) = root_dir {
        let root = root.trim_end_matches(['/', '\\']);
        if let Some(rest) = filename
            .strip_prefix(root)
            .and_then(|rest| rest.strip_prefix(['/', '\\']))
        {
            return rest.to_string();
        }
    }
    filename.to_string()
}

/// Dev diagnostic for an sz ARRAY element that is an object literal carrying a
/// runtime value: the whole element degrades to `_szPart` at runtime instead
/// of compiling statically. Only object literals warn — identifiers, calls,
/// and member expressions are legitimate forwarded slots. The wording and the
/// 1-based line:column position match the oxc/Babel engines byte-for-byte.
fn deferred_array_object_diagnostics(file: &TransformFile, ir: &super::SourceIr) -> Vec<String> {
    ir.sz_attributes
        .iter()
        .flat_map(|attr| &attr.array_parts)
        .filter(|part| part.dynamic_object_literal)
        .filter_map(|part| {
            let span = part.dynamic_span?;
            let (line, column) = offset_to_line_column(&file.source, span.start);
            Some(format!(
                "sz array element at {line}:{}: this object literal contains a runtime value, so the whole element is deferred to _szPart at runtime (its classes are still safelisted best-effort).\n  Suggestion: use finite literal ternary branches when possible, or move truly runtime values to dynamic().",
                column + 1
            ))
        })
        .collect()
}

/// Renders the `szRecover` diagnostics, byte-identical to the Babel and oxc
/// lanes.
///
/// The two cases stay separate on purpose: a dynamic value and a misspelled
/// mode need different fixes, and a build that switches `build.parser` must not
/// change the text it prints.
fn unsupported_recovery_diagnostics(file: &TransformFile, ir: &super::SourceIr) -> Vec<String> {
    ir.unsupported_recovery_attributes
        .iter()
        .map(|reason| match reason {
            UnsupportedRecoveryIr::NonLiteral => format!(
                "[csszyx] szRecover at {}: only string-literal values (\"csr\" | \"dev-only\") are supported. Dynamic values disable token emission for this element.",
                file.filename
            ),
            UnsupportedRecoveryIr::UnknownMode(mode) => format!(
                "[csszyx] szRecover at {}: unknown mode \"{mode}\" — expected \"csr\" or \"dev-only\". Token emission skipped.",
                file.filename
            ),
        })
        .collect()
}

fn noop_result(file: &TransformFile) -> TransformResult {
    TransformResult {
        code: file.source.clone(),
        map: None,
        classes: Vec::new(),
        raw_class_names: Vec::new(),
        diagnostics: Vec::new(),
        recovery_tokens: Vec::new(),
        css_variable_map: Vec::new(),
        metadata: TransformMetadata {
            transformed: false,
            uses_runtime: false,
            uses_merge: false,
            uses_szcn: false,
            uses_sz_part: false,
            uses_szv_pick: false,
            uses_szv_pick1: false,
            sz_part_args_provable: true,
            uses_color_var: false,
            uses_spacing_var: false,
            uses_unit_var: false,
            uses_bool_class: false,
            producer: TransformProducer::Rust,
            ast_budget_exceeded: false,
            timings: TransformTimings::default(),
        },
        parser_path: ParserPath::FastRegex,
    }
}

fn elapsed_ns(start: Instant) -> u64 {
    u64::try_from(start.elapsed().as_nanos()).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::{
        merge_variable_maps, relativize_diagnostic_path, transform_file,
        transform_file_with_options, transform_static_classes,
        transform_static_classes_with_options,
    };
    use crate::transform::{
        CssVariableMapEntry, GlobalVarAliasEntry, ParserPath, TransformFile, TransformOptions,
        TransformProducer,
    };

    #[test]
    fn diagnostic_paths_are_relative_only_below_the_configured_root() {
        assert_eq!(
            relativize_diagnostic_path("/repo/src/App.tsx", Some("/repo/")),
            "src/App.tsx"
        );
        assert_eq!(
            relativize_diagnostic_path("/other/App.tsx", Some("/repo")),
            "/other/App.tsx"
        );
        assert_eq!(
            relativize_diagnostic_path("src/App.tsx", None),
            "src/App.tsx"
        );
    }

    #[test]
    fn transform_file_reports_the_bool_class_helper_it_emitted() {
        // The unplugin injects the runtime import from this flag; without it the
        // emitted call is an undefined identifier at runtime.
        let attribute = transform_file(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const A = ({ on }) => <div sz={{ borderB: on }} />;".to_string(),
        });
        assert!(attribute.metadata.uses_bool_class);
        assert!(attribute.code.contains("__szBoolClass"));
        assert_eq!(attribute.classes, ["border-b"]);

        let array = transform_file(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const A = ({ on }) => <div sz={[{ borderB: on }]} />;".to_string(),
        });
        assert!(array.metadata.uses_bool_class);

        let unrelated = transform_file(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const A = ({ v }) => <div sz={{ w: v }} />;".to_string(),
        });
        assert!(!unrelated.metadata.uses_bool_class);
        assert!(unrelated.metadata.uses_spacing_var);
    }

    #[test]
    fn transform_file_skips_parser_for_no_sz_sources() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div className=\"block\" />;".to_string(),
        };

        let result = transform_file(&file);

        assert_eq!(result.code, file.source);
        assert!(!result.metadata.transformed);
        assert_eq!(result.parser_path, ParserPath::FastRegex);
        assert!(result.metadata.timings.total_ns > 0);
        assert!(result.metadata.timings.triage_ns > 0);
        assert_eq!(result.metadata.timings.parse_ns, 0);
        assert!(result.classes.is_empty());
        assert!(result.raw_class_names.is_empty());
    }

    #[test]
    fn transform_file_rejects_pathological_source_nesting() {
        let nested = "{".repeat(super::MAX_SOURCE_NESTING_DEPTH + 1);
        let file = TransformFile {
            filename: "/repo/src/Generated.tsx".to_string(),
            source: format!("const generated = {nested};"),
        };

        let result = transform_file(&file);

        assert_eq!(result.code, file.source);
        assert!(!result.metadata.transformed);
        assert!(result.diagnostics.iter().any(|diagnostic| {
            diagnostic.contains("source nesting exceeded 64 levels")
                && diagnostic.contains("prevents a parser stack overflow")
        }));
    }

    #[test]
    fn transform_options_apply_aliases_and_dynamic_var_mangling() {
        let aliased = transform_file_with_options(
            &TransformFile {
                filename: "/repo/src/Alias.tsx".to_string(),
                source: "const App=()=> <div sz={{ bg: '--brand-primary' }} />;".to_string(),
            },
            TransformOptions {
                global_var_aliases: vec![GlobalVarAliasEntry {
                    original: "--brand-primary".to_string(),
                    alias: "--g0".to_string(),
                }],
                ..TransformOptions::default()
            },
        );
        assert_eq!(aliased.classes, ["bg-(--g0)"]);
        assert!(aliased.code.contains("bg-(--g0)"));
        assert_eq!(
            aliased.css_variable_map,
            [CssVariableMapEntry {
                original: "--brand-primary".to_string(),
                mangled: "--g0".to_string(),
            }]
        );

        let mangled = transform_file_with_options(
            &TransformFile {
                filename: "/repo/src/Dynamic.tsx".to_string(),
                source: "const App=({pad}) => <section><div sz={{p:pad}}/><span sz={{p:pad}}/></section>;"
                    .to_string(),
            },
            TransformOptions {
                mangle_vars: true,
                ..TransformOptions::default()
            },
        );
        assert!(mangled.code.contains("p-(--cz)"));
        assert_eq!(mangled.classes, ["p-(--cz)", "p-(--cz)"]);
        assert_eq!(
            mangled.css_variable_map,
            [CssVariableMapEntry {
                original: "--_sz-p".to_string(),
                mangled: "--cz".to_string(),
            }]
        );
    }

    #[test]
    fn variable_map_merge_preserves_order_and_removes_exact_duplicates() {
        let entry = |original: &str, mangled: &str| CssVariableMapEntry {
            original: original.to_string(),
            mangled: mangled.to_string(),
        };
        assert_eq!(
            merge_variable_maps(
                Some(vec![entry("--a", "--x"), entry("--b", "--y")]),
                Some(vec![entry("--a", "--x"), entry("--a", "--z")]),
            ),
            [
                entry("--a", "--x"),
                entry("--b", "--y"),
                entry("--a", "--z"),
            ]
        );
        assert!(merge_variable_maps(None, None).is_empty());
    }

    #[test]
    fn diagnostics_distinguish_numeric_dead_step_and_deferred_array_values() {
        let file = TransformFile {
            filename: "/repo/src/Diagnostics.tsx".to_string(),
            source: "const App=({pad}) => <><div sz={{ 1.5: 2, p: 1.4 }} /><span sz={[{ m: pad }]} /></>;"
                .to_string(),
        };
        let result = transform_static_classes_with_options(
            &file,
            0,
            std::time::Instant::now(),
            TransformOptions {
                root_dir: Some("/repo/".to_string()),
                ..TransformOptions::default()
            },
        );

        assert!(
            result.diagnostics.iter().any(|diagnostic| {
                diagnostic.contains("numeric key \"1.5\"")
                    && diagnostic.contains("src/Diagnostics.tsx:1")
            }),
            "{:?}",
            result.diagnostics
        );
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.contains("not on Tailwind's spacing scale")));
        assert!(result.diagnostics.iter().any(|diagnostic| {
            diagnostic.contains("object literal contains a runtime value")
                && diagnostic.contains("deferred to _szPart")
        }));
    }

    #[test]
    fn diagnostics_render_migration_note_and_canonical_suggestion() {
        let file = TransformFile {
            filename: "/repo/src/Diagnostics.tsx".to_string(),
            source: "const App = () => <div sz={{ maskFrom: 1, backgroundColor: \"red-500\" }} />;"
                .to_string(),
        };
        let result = transform_static_classes_with_options(
            &file,
            0,
            std::time::Instant::now(),
            TransformOptions {
                root_dir: Some("/repo/".to_string()),
                ..TransformOptions::default()
            },
        );

        assert!(
            result.diagnostics.iter().any(|diagnostic| {
                diagnostic.contains("\"maskFrom\" was removed at src/Diagnostics.tsx:1:")
            }),
            "{:?}",
            result.diagnostics
        );
        assert!(
            result.diagnostics.iter().any(|diagnostic| {
                diagnostic.contains(
                    "Use the canonical key \"bg\" instead of \"backgroundColor\" at src/Diagnostics.tsx:1",
                )
            }),
            "{:?}",
            result.diagnostics
        );
    }

    #[test]
    fn static_engine_reports_property_object_diagnostic() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div sz={{ p: { bg: 'red-500' } }} />;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert!(result.diagnostics.iter().any(|d| {
            d.contains("\"p\" is a property, not a variant")
                && d.contains("{ bg }")
                && d.contains("generate no CSS")
        }));
    }

    #[test]
    fn static_engine_reports_every_site_fallback_kind_and_site() {
        let file = TransformFile {
            filename: "/repo/src/Fallbacks.tsx".to_string(),
            source: "import { szr, szv } from 'csszyx';\nexport const a = szr(cfg);\nexport const b = szr(cfg.x);\nexport const c = szr(await cfg);\nexport const d = szv(makeConfig());"
                .to_string(),
        };
        let result = transform_static_classes(&file, 0, std::time::Instant::now());
        let diagnostics = result.diagnostics.join("\n");

        assert!(diagnostics.contains("szr fallback at 2:"), "{diagnostics}");
        assert!(diagnostics.contains("identifier `cfg`"), "{diagnostics}");
        assert!(diagnostics.contains("member expression"), "{diagnostics}");
        assert!(diagnostics.contains("AwaitExpression"), "{diagnostics}");
        assert!(diagnostics.contains("szv catalog at 5:"), "{diagnostics}");
    }

    #[test]
    fn static_engine_names_the_disqualifying_config_path_for_a_known_szv_factory() {
        // `szr(t({...}))` where `t` IS an szv declared lines above used to
        // render "function call `t()` result is unknown" and suggest
        // converting to szv() — circular advice that cost a field user the
        // hunt for WHY the factory did not precompile. When the parser SAW
        // the declaration and disqualified its config, the diagnostic says
        // so and names the position in the config that disqualified.
        let file = TransformFile {
            filename: "/repo/src/Tag.tsx".to_string(),
            source: [
                "import { szr, szv } from 'csszyx';",
                "const t = szv({ variants: { c: { blue: { color: 'blue-500', 'desktop-sm': { p: 4 } } } } });",
                "export const A = () => <div className={szr(t({ c: 'blue' }))} />;",
            ]
            .join("\n"),
        };
        let result = transform_static_classes(&file, 0, std::time::Instant::now());
        let diagnostics = result.diagnostics.join("\n");

        assert!(
            diagnostics.contains("szr fallback at 3:44: szv factory `t()` did not precompile"),
            "{diagnostics}"
        );
        assert!(
            diagnostics.contains("config disqualified at `variants.c.blue.desktop-sm`"),
            "{diagnostics}"
        );
        // The old advice was circular — the author is already writing szv().
        assert!(!diagnostics.contains("convert to szv()"), "{diagnostics}");
    }

    #[test]
    fn static_engine_names_the_enclosing_object_when_a_nested_shape_has_no_key() {
        // A spread and a bigint key carry no name to report, so the walk names
        // the object holding them. The path has to keep the nesting: reporting
        // a bare "config" for something buried three levels down sends the
        // author back to the top of a factory they already read.
        for (source_line, expected) in [
            (
                "const t = szv({ variants: { c: { blue: { ...base } } } });",
                "config disqualified at `variants.c.blue`",
            ),
            (
                "const t = szv({ variants: { c: { blue: { 1n: 4 } } } });",
                "config disqualified at `variants.c.blue`",
            ),
            (
                "const t = szv({ ...spread });",
                "config disqualified at `config`",
            ),
        ] {
            let file = TransformFile {
                filename: "/repo/src/Nested.tsx".to_string(),
                source: [
                    "import { szr, szv } from 'csszyx';",
                    source_line,
                    "export const A = () => <div className={szr(t({ c: 'blue' }))} />;",
                ]
                .join("\n"),
            };
            let result = transform_static_classes(&file, 0, std::time::Instant::now());
            let diagnostics = result.diagnostics.join("\n");
            assert!(
                diagnostics.contains(expected),
                "expected {expected} for {source_line}, got: {diagnostics}"
            );
        }
    }

    #[test]
    fn static_engine_keeps_the_generic_call_wording_for_a_qualified_factory() {
        // A factory whose CONFIG is fine can still keep its runtime path for
        // usage reasons (here: an extra reference fails the accounting).
        // Claiming "config disqualified" there would send the author to a
        // config with nothing wrong in it, so those keep the generic wording.
        let file = TransformFile {
            filename: "/repo/src/Ok.tsx".to_string(),
            source: [
                "import { szr, szv } from 'csszyx';",
                "const t = szv({ variants: { c: { blue: { bg: 'blue-500' } } } });",
                "console.log(t);",
                "export const A = () => <div className={szr(t({ c: 'blue' }))} />;",
            ]
            .join("\n"),
        };
        let result = transform_static_classes(&file, 0, std::time::Instant::now());
        let diagnostics = result.diagnostics.join("\n");

        assert!(
            diagnostics.contains("function call `t()` result is unknown at build time"),
            "{diagnostics}"
        );
        assert!(!diagnostics.contains("did not precompile"), "{diagnostics}");
    }

    #[test]
    fn static_engine_names_an_imported_binding_apart_from_a_forwarded_prop() {
        // These two read alike in the AST and mean opposite things. An import
        // is a module-level value this build tried to read and could not, so
        // nothing collected its classes; a forwarded prop belongs to the
        // caller, whose literal is collected where the caller writes it. The
        // wording has to separate them, because the bundler routes production
        // reporting on exactly that difference.
        let file = TransformFile {
            filename: "/repo/src/Imports.tsx".to_string(),
            source: [
                "import { cardSz } from './styles';",
                "import fallbackSz from './fallback';",
                "import * as S from './all';",
                "export const A = () => <div sz={cardSz} />;",
                "export const B = () => <div sz={fallbackSz} />;",
                "export const C = () => <div sz={S.cardSz} />;",
                "export const D = ({ sz }) => <div sz={sz} />;",
                // Parentheses, a computed member, and an szr argument: the
                // same question asked through three more shapes, because each
                // reaches the classifier by its own arm.
                "export const E = () => <div sz={(cardSz)} />;",
                "export const F = () => <div sz={S['cardSz']} />;",
                "export const G = szr(cardSz);",
            ]
            .join("\n"),
        };
        let result = transform_static_classes(&file, 0, std::time::Instant::now());
        let diagnostics = result.diagnostics.join("\n");

        for name in ["cardSz", "fallbackSz", "S"] {
            assert!(
                diagnostics.contains(&format!("imported binding `{name}`")),
                "{diagnostics}"
            );
        }
        assert!(diagnostics.contains("import it by name"), "{diagnostics}");
        // The forwarded prop keeps the plain wording, and must not be reported
        // as an import just because it is also an unresolved identifier.
        assert!(diagnostics.contains("identifier `sz`"), "{diagnostics}");
        assert!(
            !diagnostics.contains("imported binding `sz`"),
            "{diagnostics}"
        );
        // The szr site renders through its own mapping, so an import reaching
        // it has to be named there too.
        assert!(diagnostics.contains("szr fallback at "), "{diagnostics}");
    }

    #[test]
    fn static_engine_reports_unknown_mask_members() {
        let file = TransformFile {
            filename: "/repo/src/Mask.tsx".to_string(),
            source: "export const A = () => <div sz={{ maskLinear: { form: '20%' } }} />;"
                .to_string(),
        };
        let result = transform_static_classes(&file, 0, std::time::Instant::now());
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.contains("maskLinear: unknown field \"form\"")));
    }

    #[test]
    fn static_engine_reports_only_unsafe_style_spread_collisions() {
        for source in [
            "const A=({width,props})=><div sz={{w:width}} {...props}/>;",
            "const A=({width,cond,rest})=><div sz={{w:width}} {...(cond?{...rest}:{})}/>;",
            "const A=({width,key,value})=><div sz={{w:width}} {...{[key]:value}}/>;",
            "const A=({width,a,b})=><div sz={{w:width}} {...a} {...b}/>;",
        ] {
            let result = transform_static_classes(
                &TransformFile {
                    filename: "/repo/src/App.tsx".to_string(),
                    source: source.to_string(),
                },
                0,
                std::time::Instant::now(),
            );

            assert!(
                result
                    .diagnostics
                    .iter()
                    .any(|diagnostic| diagnostic.contains("possible style override")),
                "{source}"
            );
        }

        for source in [
            "const A=({width})=><div sz={{w:width}} {...{}}/>;",
            "const A=({width,base})=><div sz={{w:width}} {...{style:base}}/>;",
            "const A=({width,cond})=><div sz={{w:width}} {...(cond?{}:{})}/>;",
            // Wholly static sz beside an opaque spread. This is the single
            // most common shape in a component library, and it emits no style
            // attribute at all, so there is nothing for the spread to
            // override. Warning here would train authors to ignore the
            // message on the elements where it does mean something. The other
            // negative cases above are rejected earlier by the safe-spread
            // check, so this one is what pins the emits-no-style condition.
            "const A=({props})=><div sz={{p:4}} {...props}/>;",
        ] {
            let result = transform_static_classes(
                &TransformFile {
                    filename: "/repo/src/App.tsx".to_string(),
                    source: source.to_string(),
                },
                0,
                std::time::Instant::now(),
            );

            assert!(
                result
                    .diagnostics
                    .iter()
                    .all(|diagnostic| !diagnostic.contains("possible style override")),
                "{source}"
            );
        }
    }

    #[test]
    fn static_engine_rewrites_single_static_sz_attribute() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div sz={{ start: 4, hover: { bg: 'red-500' } }} />;"
                .to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(
            result.code,
            "export const App = () => <div className=\"inset-s-4 hover:bg-red-500\" />;"
        );
        assert!(result.metadata.transformed);
        assert_eq!(result.metadata.producer, TransformProducer::Rust);
        assert_eq!(result.parser_path, ParserPath::Static);
        assert_eq!(result.classes, ["inset-s-4", "hover:bg-red-500"]);
        assert!(result.metadata.timings.total_ns > 0);
        assert!(result.metadata.timings.parse_ns > 0);
        assert!(result.metadata.timings.scope_ns > 0);
        assert!(result.metadata.timings.ir_ns > 0);
        assert!(result.metadata.timings.lower_ns > 0);
        assert!(result.metadata.timings.rewrite_ns > 0);
        assert!(result.raw_class_names.is_empty());
        assert!(result.diagnostics.is_empty());
        assert!(result.recovery_tokens.is_empty());
    }

    #[test]
    fn transform_file_uses_ast_free_path_for_flat_static_sz_attribute() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div id=\"x\" sz={{ p: 4, bg: 'red-500', fontStyle: 'italic' }} />;"
                .to_string(),
        };

        let result = transform_file(&file);

        assert_eq!(
            result.code,
            "export const App = () => <div id=\"x\" className=\"p-4 bg-red-500 italic\" />;"
        );
        assert!(result.metadata.transformed);
        assert_eq!(result.parser_path, ParserPath::FastRegex);
        assert_eq!(result.classes, ["p-4", "bg-red-500", "italic"]);
        assert_eq!(result.metadata.timings.parse_ns, 0);
        assert_eq!(result.metadata.timings.scope_ns, 0);
        assert_eq!(result.metadata.timings.ir_ns, 0);
        assert!(result.metadata.timings.lower_ns > 0);
        assert!(result.metadata.timings.rewrite_ns > 0);
    }

    #[test]
    fn component_szs_rewrite_survives_a_static_sz_sibling() {
        // Field-reported: a component `szs` slot map next to a sibling element
        // carrying a static `sz` object routed the file to the AST-free lane,
        // which cannot perform the `szs` -> `szsc` rewrite — the raw `szs`
        // prop survived into the output and the slot override was silently
        // dropped. All three shapes must compile the rewrite; the sibling
        // shape must take the parser path to get it.
        let shapes = [
            "const C = () => <Popup szs={{ body: { p: 0 } }}><Box>x</Box></Popup>;",
            "const C = () => <Popup szs={{ body: { p: 0 } }}><Box sz={{ p: 4 }}>x</Box></Popup>;",
            "const C = () => <Popup sz={{ p: 4 }} szs={{ body: { p: 0 } }}><Box>x</Box></Popup>;",
        ];

        for source in shapes {
            let result = transform_file(&TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source: source.to_string(),
            });

            assert_eq!(
                result.parser_path,
                ParserPath::Static,
                "expected the parser path for: {source}"
            );
            assert!(
                result.code.contains("szsc={{ body:"),
                "expected a compiled szsc slot prop for: {source}\ngot: {}",
                result.code
            );
            assert!(
                !result.code.contains("szs={{ body"),
                "expected the raw szs prop to be rewritten for: {source}\ngot: {}",
                result.code
            );
        }
    }

    #[test]
    fn static_engine_collects_existing_classes_without_rewriting_source() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div className=\"block\" sz={{ p: 4 }} />;"
                .to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(
            result.code,
            "export const App = () => <div className=\"block p-4\" />;"
        );
        assert!(result.metadata.transformed);
        assert_eq!(result.classes, ["p-4"]);
        assert_eq!(result.raw_class_names, ["block"]);
    }

    #[test]
    fn static_engine_keeps_parse_diagnostics_in_result_contract() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div sz={{ p: }} />;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert!(!result.diagnostics.is_empty());
        assert!(result.classes.is_empty());
        assert!(!result.metadata.transformed);
    }

    #[test]
    fn static_engine_emits_runtime_helper_for_dynamic_sz_identifier() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = ({ styles }) => <div sz={styles} />;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(
            result.code,
            "export const App = ({ styles }) => <div className={_sz(styles)} />;"
        );
        assert!(result.metadata.transformed);
        assert!(result.metadata.uses_runtime);
        assert!(result.classes.is_empty());
        assert_eq!(
            result.diagnostics,
            vec![String::from(
                "sz fallback at 1:45: identifier `styles` could not be resolved to a static value.\n  Suggestion: Make sure it's a module-level or function-body const with a literal object value. For variant-based styling → szv(). For true runtime values → dynamic()."
            )]
        );
    }

    #[test]
    fn static_engine_rewrites_static_and_runtime_fallback_elements_together() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source:
                "export const App = ({ styles }) => <><div sz={{ p: 4 }} /><span sz={styles} /></>;"
                    .to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(
            result.code,
            "export const App = ({ styles }) => <><div className=\"p-4\" /><span className={_sz(styles)} /></>;"
        );
        assert!(result.metadata.transformed);
        assert!(result.metadata.uses_runtime);
        assert_eq!(result.classes, ["p-4"]);
        assert_eq!(
            result.diagnostics,
            vec![String::from(
                "sz fallback at 1:69: identifier `styles` could not be resolved to a static value.\n  Suggestion: Make sure it's a module-level or function-body const with a literal object value. For variant-based styling → szv(). For true runtime values → dynamic()."
            )]
        );
    }

    #[test]
    fn static_engine_reports_ast_budget_without_rewrite() {
        let source = format!(
            "export const App = () => <>{}</>;",
            "<span />".repeat(crate::transform::parser::AST_BUDGET + 1)
        );
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source,
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(result.code, file.source);
        assert!(!result.metadata.transformed);
        assert!(result.metadata.ast_budget_exceeded);
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.contains("AST budget exceeded")));
    }

    #[test]
    fn budget_exceeded_file_contributes_no_partial_classes() {
        // szv catalog at the TOP so a partial walk WOULD have collected it —
        // the result must still be empty: partial safelists are silent wrong
        // CSS under `source(none)` and a parity break vs the throwing JS lanes.
        let source = format!(
            "import {{ szv }} from 'csszyx';\n\
             const controlSz = szv({{ variants: {{ layout: {{ a: {{ mx: 0, my: 4 }} }} }} }});\n\
             export const App = () => <>{}</>;",
            "<span className=\"cell\" />".repeat(crate::transform::parser::AST_BUDGET)
        );
        let file = TransformFile {
            filename: "/repo/src/Big.tsx".to_string(),
            source,
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert!(result.metadata.ast_budget_exceeded);
        assert!(result.classes.is_empty(), "partial classes must be dropped");
        assert!(
            result.raw_class_names.is_empty(),
            "partial raw class names must be dropped"
        );
    }

    #[test]
    fn ast_budget_option_reaches_the_parser() {
        let source = format!(
            "import {{ szv }} from 'csszyx';\n\
             export const App = () => <>{}</>;\n\
             const controlSz = szv({{ variants: {{ layout: {{ a: {{ mx: 0, my: 4 }} }} }} }});",
            "<span />".repeat(crate::transform::parser::AST_BUDGET)
        );
        let file = TransformFile {
            filename: "/repo/src/Big.tsx".to_string(),
            source,
        };

        // Default budget: too big → no classes.
        let default_result = transform_static_classes(&file, 0, std::time::Instant::now());
        assert!(default_result.metadata.ast_budget_exceeded);
        assert!(default_result.classes.is_empty());

        // Raised budget (build.astBudgetLimit): full extraction, mx-0 included.
        let raised = transform_static_classes_with_options(
            &file,
            0,
            std::time::Instant::now(),
            TransformOptions {
                ast_budget: Some(crate::transform::parser::AST_BUDGET * 20),
                ..TransformOptions::default()
            },
        );
        assert!(!raised.metadata.ast_budget_exceeded);
        assert!(raised.classes.iter().any(|class| class == "mx-0"));
    }

    #[test]
    fn static_engine_emits_runtime_helper_for_conditional_spread() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const BASE = { p: 4 } as const;\nconst X = ({ big }) => <div sz={{ ...BASE, ...(big ? { p: 8 } : {}) }} />;"
                .to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(
            result.code,
            "const BASE = { p: 4 } as const;\nconst X = ({ big }) => <div className={_sz({ ...BASE, ...(big ? { p: 8 } : {}) })} />;"
        );
        assert!(result.metadata.transformed);
        assert!(result.metadata.uses_runtime);
        assert_eq!(result.classes, ["p-4", "p-8"]);
        // A top-level spread forces the runtime fallback, so it now surfaces the
        // build-log spread diagnostic (the dev-assert fires for the same shape).
        assert!(
            result
                .diagnostics
                .iter()
                .any(|d| d.contains("unresolvable sz spread")),
            "{:?}",
            result.diagnostics
        );
    }

    #[test]
    fn static_engine_reads_a_value_off_a_local_constant_map() {
        // A design-token map read by member access. The bare identifier form of
        // the same constant already folds, so the value being reachable is not
        // in question — only the indexing step was.
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const LAYER = { appChrome: 10 } as const;\nconst X = () => <div sz={{ z: LAYER.appChrome }} />;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(
            result.code,
            "const LAYER = { appChrome: 10 } as const;\nconst X = () => <div className=\"z-10\" />;"
        );
        assert_eq!(result.classes, vec![String::from("z-10")]);
        assert!(!result.metadata.uses_runtime);
    }

    #[test]
    fn static_engine_reads_through_a_nested_constant_map() {
        // The read resolves its object half through the same walk, so a map of
        // maps costs no extra machinery. Pinned because token files are
        // routinely grouped one level deeper than they are consumed.
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const T = { c: { brand: 'blue-500' } } as const;\nconst X = () => <div sz={{ bg: T.c.brand }} />;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(result.classes, vec![String::from("bg-blue-500")]);
    }

    #[test]
    fn static_engine_will_not_read_a_member_off_a_scalar_constant() {
        // The name resolves, but to a string rather than a map, so there is no
        // property to read. `length` is a real value at run time and inventing
        // one here would be a different answer than the program's.
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const S = 'abc';\nconst X = () => <div sz={{ z: S.length }} />;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert!(result.code.contains("style={{\"--_sz-z\": S.length}}"));
        assert!(result.classes.iter().all(|class| class != "z-3"));
    }

    #[test]
    fn static_engine_will_not_read_a_map_declared_after_its_use() {
        // Reading it would answer with a value the reference cannot see. The
        // bare-identifier walk already refuses this, and the read inherits the
        // refusal by resolving its object half through that same walk.
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const X = () => <div sz={{ z: LATER.appChrome }} />;\nconst LATER = { appChrome: 10 } as const;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert!(!result.classes.iter().any(|class| class == "z-10"));
    }

    #[test]
    fn static_engine_keeps_a_computed_member_on_the_runtime_path() {
        // The property is chosen at run time, so no build-time read of the map
        // can be right. This has to stay on the custom-property path.
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const LAYER = { appChrome: 10 } as const;\nconst X = ({ k }) => <div sz={{ z: LAYER[k] }} />;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert!(result.code.contains("style={{\"--_sz-z\": LAYER[k]}}"));
        assert!(!result.classes.iter().any(|class| class == "z-10"));
    }

    #[test]
    fn static_engine_keeps_a_missing_member_on_the_runtime_path() {
        // Nothing to read: emitting a class from a key the map does not carry
        // would invent a value. The runtime path is the honest answer.
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const LAYER = { appChrome: 10 } as const;\nconst X = () => <div sz={{ z: LAYER.missing }} />;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert!(result.code.contains("style={{\"--_sz-z\": LAYER.missing}}"));
        assert!(!result.classes.iter().any(|class| class == "z-10"));
    }

    #[test]
    fn static_engine_emits_runtime_helper_for_dynamic_identifier() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const X = ({ styles }) => <div sz={styles} />;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(
            result.code,
            "const X = ({ styles }) => <div className={_sz(styles)} />;"
        );
        assert!(result.metadata.transformed);
        assert!(result.metadata.uses_runtime);
        assert!(result.classes.is_empty());
        // Byte-identical to the Babel lane's diagnostic for this source — the
        // fallback matrix is a three-engine parity surface (ADR 0011).
        assert_eq!(
            result.diagnostics,
            vec![String::from(
                "sz fallback at 1:36: identifier `styles` could not be resolved to a static value.\n  Suggestion: Make sure it's a module-level or function-body const with a literal object value. For variant-based styling → szv(). For true runtime values → dynamic()."
            )]
        );
    }

    #[test]
    fn static_engine_emits_merge_helper_for_runtime_fallback_with_static_classname() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const X = ({ styles }) => <div className=\"existing\" sz={styles} />;"
                .to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(
            result.code,
            "const X = ({ styles }) => <div className={_szMerge(\"existing\", _sz(styles))} />;"
        );
        assert!(result.metadata.transformed);
        assert!(result.metadata.uses_runtime);
        assert!(result.metadata.uses_merge);
        assert!(result.classes.is_empty());
        assert_eq!(result.raw_class_names, ["existing"]);
        assert_eq!(
            result.diagnostics,
            vec![String::from(
                "sz fallback at 1:57: identifier `styles` could not be resolved to a static value.\n  Suggestion: Make sure it's a module-level or function-body const with a literal object value. For variant-based styling → szv(). For true runtime values → dynamic()."
            )]
        );
    }

    #[test]
    fn static_engine_emits_merge_helper_for_runtime_fallback_with_dynamic_classname() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const X = ({ styles }) => <div className={getClass()} sz={styles} />;"
                .to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(
            result.code,
            "const X = ({ styles }) => <div className={_szMerge(getClass(), _sz(styles))} />;"
        );
        assert!(result.metadata.transformed);
        assert!(result.metadata.uses_runtime);
        assert!(result.metadata.uses_merge);
        assert!(result.classes.is_empty());
        assert!(result.raw_class_names.is_empty());
        assert_eq!(
            result.diagnostics,
            vec![String::from(
                "sz fallback at 1:59: identifier `styles` could not be resolved to a static value.\n  Suggestion: Make sure it's a module-level or function-body const with a literal object value. For variant-based styling → szv(). For true runtime values → dynamic()."
            )]
        );
    }

    #[test]
    fn static_engine_emits_merge_helper_for_static_sz_with_dynamic_classname() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const X = () => <div className={getClass()} sz={{ p: 4 }} />;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(
            result.code,
            "const X = () => <div className={_szMerge(getClass(), \"p-4\")} />;"
        );
        assert!(result.metadata.transformed);
        assert!(result.metadata.uses_runtime);
        assert!(result.metadata.uses_merge);
        assert_eq!(result.classes, ["p-4"]);
        assert!(result.raw_class_names.is_empty());
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn static_engine_emits_recovery_token() {
        let file = TransformFile {
            filename: "src/App.tsx".to_string(),
            source: "export const App = () => <div szRecover=\"csr\">x</div>;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert!(result.metadata.transformed);
        assert!(result.code.contains("data-sz-recovery-token="));
        assert_eq!(result.recovery_tokens.len(), 1);
        assert_eq!(
            result.recovery_tokens[0].mode,
            crate::transform::RecoveryMode::Csr
        );
        assert_eq!(result.recovery_tokens[0].component, "div");
        assert_eq!(result.recovery_tokens[0].path, "src/App.tsx:1:30");
        assert_eq!(result.recovery_tokens[0].token.len(), 12);
        assert!(result.diagnostics.is_empty());
    }

    #[test]
    fn static_engine_reports_unsupported_recovery_without_token() {
        let file = TransformFile {
            filename: "src/App.tsx".to_string(),
            source: "export const App = ({ mode }) => <div szRecover={mode}>x</div>;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(result.code, file.source);
        assert!(!result.metadata.transformed);
        assert!(result.recovery_tokens.is_empty());
        assert!(result
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.contains("szRecover")));
    }

    #[test]
    fn static_engine_names_the_unknown_recovery_mode_it_rejected() {
        // A misspelled mode and a dynamic value both disable token emission, and
        // they need different fixes — one is a typo, the other is a shape the
        // engine cannot read. A shared message would send the author looking for
        // the wrong problem, so the mode they actually wrote is quoted back.
        let file = TransformFile {
            filename: "src/App.tsx".to_string(),
            source: "export const App = () => <div szRecover=\"csrr\">x</div>;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert!(result.recovery_tokens.is_empty());
        let diagnostics = result.diagnostics.join("\n");
        assert!(diagnostics.contains("csrr"), "{diagnostics}");
        assert!(diagnostics.contains("unknown mode"), "{diagnostics}");
    }

    #[test]
    fn static_engine_skips_already_tagged_recovery() {
        let file = TransformFile {
            filename: "src/App.tsx".to_string(),
            source:
                "export const App = () => <div szRecover=\"csr\" data-sz-recovery-token=\"abc\">x</div>;"
                    .to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(result.code, file.source);
        assert!(!result.metadata.transformed);
        assert!(result.recovery_tokens.is_empty());
        assert!(result.diagnostics.is_empty());
    }

    /// Global custom-property aliases must reach the PARSER lane too.
    ///
    /// The rename is applied in two places, once per lane, and only the fast
    /// path was pinned. A file that bails to the parser — anything with a
    /// className expression, a ternary, or a dynamic value — would emit the
    /// original property name in its class while the emitted variable map
    /// still describes the alias, so the stylesheet and the markup would name
    /// two different custom properties and the colour would never apply.
    #[test]
    fn global_var_aliases_apply_on_the_parser_lane() {
        let file = TransformFile {
            filename: "/repo/src/Alias.tsx".to_string(),
            source: "const App = ({ cls, on }) => <div className={cls} sz={on ? { bg: '--brand-primary' } : { bg: '--brand-primary' }} />;"
                .to_string(),
        };
        let result = transform_file_with_options(
            &file,
            TransformOptions {
                global_var_aliases: vec![GlobalVarAliasEntry {
                    original: "--brand-primary".to_string(),
                    alias: "--g0".to_string(),
                }],
                ..TransformOptions::default()
            },
        );

        assert_eq!(
            result.parser_path,
            ParserPath::Static,
            "must bail fast path"
        );
        assert!(
            result.classes.iter().all(|class| class == "bg-(--g0)"),
            "{:?}",
            result.classes
        );
        assert!(!result.code.contains("--brand-primary"), "{}", result.code);
        assert_eq!(
            result.css_variable_map,
            [CssVariableMapEntry {
                original: "--brand-primary".to_string(),
                mangled: "--g0".to_string(),
            }]
        );
    }

    /// Every `uses_*` flag on a file that needs NO runtime helper.
    ///
    /// The bundler injects a runtime import per flag without re-scanning the
    /// emitted code, so a flag that reads true on a file needing nothing pulls
    /// `@csszyx/runtime` into a module that was zero-runtime — the promise the
    /// RSC/bundle story rests on. Every flag is asserted false here, in one
    /// place, so no single condition can degrade to a constant true without
    /// this failing. The fixture goes down the PARSER lane on purpose: a
    /// `className=` string bails the fast path, which hardcodes the flags to
    /// false and would prove nothing.
    #[test]
    fn a_purely_static_parser_lane_file_claims_no_runtime_helper() {
        let file = TransformFile {
            filename: "/repo/src/Static.tsx".to_string(),
            source:
                "export const App = () => <div className=\"card\" sz={{ p: 4, bg: 'red-500' }} />;"
                    .to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());
        let metadata = &result.metadata;

        assert!(metadata.transformed, "fixture must reach the rewrite");
        assert_eq!(result.parser_path, ParserPath::Static);
        assert!(result.classes.iter().any(|class| class == "p-4"));

        assert!(!metadata.uses_runtime, "no _sz fallback in this file");
        assert!(!metadata.uses_merge, "className is a literal, not merged");
        assert!(!metadata.uses_szcn, "no sz array to compose");
        assert!(!metadata.uses_sz_part, "no dynamic array element");
        assert!(!metadata.uses_szv_pick, "no szv catalog");
        assert!(!metadata.uses_szv_pick1, "no szv catalog");
        assert!(!metadata.uses_color_var, "colour value is a literal token");
        assert!(!metadata.uses_spacing_var, "spacing value is a literal");
        assert!(!metadata.uses_unit_var, "no angle or duration value");
        assert!(!metadata.uses_bool_class, "no conditional boolean key");
        assert!(
            metadata.sz_part_args_provable,
            "vacuously true with no dynamic parts"
        );
    }

    /// The same all-false claim on a file the parser could not read.
    ///
    /// A rejected file rewrites nothing, so importing a helper into it is both
    /// useless and a zero-runtime break — and it is the case where a flag
    /// computed from a partial IR is most likely to read true by accident.
    #[test]
    fn a_rejected_file_claims_no_runtime_helper() {
        let file = TransformFile {
            filename: "/repo/src/Broken.tsx".to_string(),
            source:
                "export const App = ({ on, cls }) => <div className={cls} sz={[{ p: on ? 4 : 8 }]} /"
                    .to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());
        let metadata = &result.metadata;

        assert!(!metadata.transformed, "a rejected file rewrites nothing");
        for (name, flag) in [
            ("uses_runtime", metadata.uses_runtime),
            ("uses_merge", metadata.uses_merge),
            ("uses_szcn", metadata.uses_szcn),
            ("uses_sz_part", metadata.uses_sz_part),
            ("uses_color_var", metadata.uses_color_var),
            ("uses_spacing_var", metadata.uses_spacing_var),
            ("uses_unit_var", metadata.uses_unit_var),
            ("uses_bool_class", metadata.uses_bool_class),
        ] {
            assert!(!flag, "{name} must stay false on an untransformed file");
        }
    }

    /// True direction for the two composition helpers.
    ///
    /// These are the false-negative half of the same contract: the rewrite has
    /// already spliced `_szcn(...)` / `_szMerge(...)` into the emitted code, so
    /// a flag that reads false leaves the call without its import and the page
    /// dies with a ReferenceError on first render.
    #[test]
    fn an_sz_array_and_a_merged_class_name_claim_their_helpers() {
        let array = transform_file(&TransformFile {
            filename: "/repo/src/Array.tsx".to_string(),
            source: "export const A = ({ extra }) => <div sz={[{ p: 4 }, extra]} />;".to_string(),
        });
        assert!(array.metadata.transformed);
        assert!(array.code.contains("_szcn("), "{}", array.code);
        assert!(array.metadata.uses_szcn, "emitted _szcn needs its import");
        assert!(!array.metadata.uses_merge, "no className on the element");

        let merged = transform_file(&TransformFile {
            filename: "/repo/src/Merge.tsx".to_string(),
            source:
                "export const A = ({ on, base }) => <div className={base} sz={on ? { p: 4 } : { p: 8 }} />;"
                    .to_string(),
        });
        assert!(merged.metadata.transformed);
        assert!(merged.code.contains("_szMerge("), "{}", merged.code);
        assert!(merged.metadata.uses_merge, "emitted _szMerge needs import");
        assert!(!merged.metadata.uses_szcn, "no sz array on the element");
    }

    /// True direction for the dynamic custom-property categories.
    ///
    /// Each category maps to a different runtime helper, so it is not enough
    /// that "some" var flag is set: the colour fixture emits `__szColorVar`
    /// only, and the spacing/unit flags must stay false or the module pays for
    /// imports it never calls. The other two fixtures assert the mirror image.
    #[test]
    fn a_dynamic_value_claims_only_its_own_var_helper() {
        let color = transform_file(&TransformFile {
            filename: "/repo/src/Color.tsx".to_string(),
            source: "export const A = ({ tone }) => <div sz={{ color: tone }} />;".to_string(),
        });
        assert!(color.code.contains("__szColorVar("), "{}", color.code);
        assert!(color.metadata.uses_color_var, "emitted helper needs import");
        assert!(!color.metadata.uses_spacing_var);
        assert!(!color.metadata.uses_unit_var);

        let spacing = transform_file(&TransformFile {
            filename: "/repo/src/Spacing.tsx".to_string(),
            source: "export const A = ({ pad }) => <div sz={{ p: pad }} />;".to_string(),
        });
        assert!(spacing.code.contains("__szSpacingVar("), "{}", spacing.code);
        assert!(spacing.metadata.uses_spacing_var);
        assert!(!spacing.metadata.uses_color_var);
        assert!(!spacing.metadata.uses_unit_var);

        let unit = transform_file(&TransformFile {
            filename: "/repo/src/Unit.tsx".to_string(),
            source: "export const A = ({ deg }) => <div sz={{ rotate: deg }} />;".to_string(),
        });
        assert!(unit.metadata.uses_unit_var);
        assert!(!unit.metadata.uses_color_var);
        assert!(!unit.metadata.uses_spacing_var);
    }

    /// A file the parser rejected must keep its ORIGINAL source.
    ///
    /// The safelist is dropped for such a file, so any className the rewrite
    /// managed to splice in would reach the HTML with no matching rule
    /// generated — invisible breakage under Tailwind `source(none)`. The
    /// fixture carries real `sz` so the assertion has something to catch; with
    /// a source that has no `sz` the rewrite is a no-op either way and the
    /// check proves nothing.
    #[test]
    fn a_parse_error_leaves_real_sz_source_untouched() {
        let file = TransformFile {
            filename: "/repo/src/Broken.tsx".to_string(),
            source: "export const App = () => <div sz={{ p: 4 }} />;\nconst broken = ;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert_eq!(
            result.code, file.source,
            "a rejected file must not be rewritten"
        );
        assert!(!result.metadata.transformed);
        assert!(!result.code.contains("className"));
        assert!(
            result
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.contains("[csszyx] parse error in")),
            "{:?}",
            result.diagnostics
        );
    }

    /// Same contract for the AST budget: partial walk, no rewrite.
    #[test]
    fn a_budget_exceeded_file_leaves_real_sz_source_untouched() {
        let source = format!(
            "export const App = () => <><div sz={{{{ p: 4 }}}} />{}</>;",
            "<span />".repeat(crate::transform::parser::AST_BUDGET + 1)
        );
        let file = TransformFile {
            filename: "/repo/src/Big.tsx".to_string(),
            source,
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert!(result.metadata.ast_budget_exceeded);
        assert_eq!(
            result.code, file.source,
            "a budget-tripped file must not be rewritten"
        );
        assert!(!result.metadata.transformed);
        assert!(!result.code.contains("className"));
        assert!(result.classes.is_empty(), "partial safelists are dropped");
    }

    /// Ordinary JSX must survive the stack-overflow guard.
    ///
    /// The guard counts bracket nesting, and every real file opens and closes
    /// hundreds of brackets at shallow depth. A depth counter that only ever
    /// climbs would put every one of them over the limit, so the whole project
    /// would silently skip transformation while the existing guard test — one
    /// long run of `{` that never closes — kept passing.
    #[test]
    fn ordinary_shallow_jsx_stays_under_the_nesting_guard() {
        let rows = (0..120)
            .map(|index| format!("  <li key={{{index}}} sz={{{{ p: 2 }}}}>{{label({index})}}</li>"))
            .collect::<Vec<_>>()
            .join("\n");
        let file = TransformFile {
            filename: "/repo/src/List.tsx".to_string(),
            source: format!("export const List = () => (\n<ul>\n{rows}\n</ul>\n);"),
        };

        assert!(
            super::max_source_nesting_depth(&file.source) <= super::MAX_SOURCE_NESTING_DEPTH,
            "shallow JSX measured as deeply nested"
        );

        let result = transform_file(&file);

        assert!(result.metadata.transformed, "a normal file must transform");
        assert!(result.classes.iter().any(|class| class == "p-2"));
        assert!(
            !result
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.contains("source nesting exceeded")),
            "{:?}",
            result.diagnostics
        );
    }

    /// An `sz` attribute the engine cannot read must say so.
    ///
    /// The whole collector is one function; if it returns nothing, a bare `sz`
    /// or an element-valued `sz` is skipped with no class, no rewrite, and no
    /// word to the author about why their styles vanished.
    #[test]
    fn an_unreadable_sz_attribute_is_reported() {
        let file = TransformFile {
            filename: "/repo/src/Unsupported.tsx".to_string(),
            source: "export const App = () => <div sz />;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());

        assert!(
            result
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.contains("unsupported dynamic sz attribute")),
            "{:?}",
            result.diagnostics
        );
    }

    /// A variant object that HAPPENS to set a colour keeps its own checks.
    ///
    /// The descent skips a nested object holding a `color` member, because
    /// that is the documented colour-opacity spelling on a property key. A
    /// variant like `hover` is not a property key, and `hover: { color: ... }`
    /// is one of the most common shapes there is — so a guard that stops at
    /// the colour alone takes the whole variant body out of every check, and
    /// the typo and the dead spacing step sitting beside it go unmentioned.
    #[test]
    fn a_variant_object_setting_a_colour_still_gets_its_own_diagnostics() {
        let file = TransformFile {
            filename: "/repo/src/Hover.tsx".to_string(),
            source: "export const App = () => <div sz={{ hover: { color: 'white', paddng: 4, p: 1.4 } }} />;"
                .to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());
        let diagnostics = result.diagnostics.join("\n");

        assert!(
            diagnostics.contains("\"paddng\""),
            "the typo must still be reported: {diagnostics}"
        );
        assert!(
            diagnostics.contains("not on Tailwind's spacing scale"),
            "the dead step must still be reported: {diagnostics}"
        );

        // The colour-opacity form on a real PROPERTY key is the shape the
        // guard exists for, and must stay quiet.
        let opacity = transform_static_classes(
            &TransformFile {
                filename: "/repo/src/Opacity.tsx".to_string(),
                source:
                    "export const App = () => <div sz={{ bg: { color: 'red-500', op: 50 } }} />;"
                        .to_string(),
            },
            0,
            std::time::Instant::now(),
        );
        assert!(opacity.diagnostics.is_empty(), "{:?}", opacity.diagnostics);
    }

    /// A project-defined variant is not a mistyped property.
    ///
    /// The "this is a property, not a variant" warning is aimed at
    /// `p: { bg: ... }`, where the nested object really does generate nothing.
    /// A custom breakpoint declared through `@theme` looks the same to the
    /// checker but is entirely correct, and telling its author their working
    /// styles generate no CSS sends them to rewrite code that was already
    /// right.
    #[test]
    fn a_custom_theme_variant_is_not_reported_as_a_property() {
        let custom = transform_static_classes(
            &TransformFile {
                filename: "/repo/src/Theme.tsx".to_string(),
                source: "export const App = () => <div sz={{ tablet: { p: 4 } }} />;".to_string(),
            },
            0,
            std::time::Instant::now(),
        );
        assert!(
            !custom
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.contains("is a property, not a variant")),
            "{:?}",
            custom.diagnostics
        );
        assert!(custom.classes.iter().any(|class| class == "tablet:p-4"));

        // The real case the warning is for still warns.
        let property = transform_static_classes(
            &TransformFile {
                filename: "/repo/src/Property.tsx".to_string(),
                source: "export const App = () => <div sz={{ bg: { foo: 1 } }} />;".to_string(),
            },
            0,
            std::time::Instant::now(),
        );
        assert!(
            property
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.contains("is a property, not a variant")),
            "{:?}",
            property.diagnostics
        );
    }

    /// The "unknown property" branch must not borrow the numeric-key wording.
    ///
    /// The two diagnostics send the author in opposite directions: one says a
    /// key was ignored for being numeric, the other offers the spelling they
    /// probably meant. A misspelled name routed to the numeric branch reads as
    /// advice about a problem the code does not have.
    #[test]
    fn a_misspelled_key_is_reported_as_unknown_not_numeric() {
        let file = TransformFile {
            filename: "/repo/src/Typo.tsx".to_string(),
            source: "export const App = () => <div sz={{ colr: 'red-500' }} />;".to_string(),
        };

        let result = transform_static_classes(&file, 0, std::time::Instant::now());
        let diagnostics = result.diagnostics.join("\n");

        assert!(
            diagnostics.contains("Unknown property \"colr\""),
            "{diagnostics}"
        );
        assert!(!diagnostics.contains("numeric key"), "{diagnostics}");
    }
}
