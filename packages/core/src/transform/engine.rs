//! Native transform engine assembly.
//!
//! This module connects parser output, class lowering, and the public transform
//! result contract without enabling source rewrite yet.

use super::{
    css_var_planner::apply_css_variable_mangling,
    fast_path::{triage_source, FastPathTriage},
    global_var_aliases::apply_global_var_aliases,
    lower::{collect_unknown_sz_keys, lower_source_ir_classes},
    parser::{parse_source_shell_with_budget, AST_BUDGET},
    recovery::{generate_inline_recovery_token, offset_to_line_column},
    rewrite::rewrite_static_sz_attributes,
    DynamicCssVarCategory, ParserPath, RecoveryToken, TransformFile, TransformMetadata,
    TransformOptions, TransformProducer, TransformResult, TransformTimings,
};
use std::time::Instant;

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
            uses_color_var: false,
            uses_spacing_var: false,
            uses_unit_var: false,
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
    let parsed = parse_source_shell_with_budget(file, options.ast_budget.unwrap_or(AST_BUDGET));
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
    diagnostics.extend(runtime_fallback_spread_diagnostics(file, &parsed.ir));
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
            uses_color_var,
            uses_spacing_var,
            uses_unit_var,
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

/// Build-log diagnostic for an `sz` prop forced to a runtime fallback by a
/// top-level object spread (`sz={{ ...x }}`). The file still transforms (the
/// `_sz` helper handles it), but the spread can't be statically resolved, so
/// it may produce no styles in production — this surfaces it instead of failing
/// silently. The `unresolvable sz spread` phrase is the marker the bundler
/// plugin matches to promote these to a build-log warning in every mode.
fn runtime_fallback_spread_diagnostics(file: &TransformFile, ir: &super::SourceIr) -> Vec<String> {
    ir.sz_attributes
        .iter()
        .filter(|attr| attr.runtime_fallback_spread)
        .map(|attr| {
            format!(
                "[csszyx] unresolvable sz spread at {}:{}: sz={{{{ ...x }}}} can't be resolved at build time and falls back to runtime (it may produce no styles in production). Use array form: sz={{[x, {{ … }}]}}.",
                file.filename, attr.value_span.start
            )
        })
        .collect()
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
    for attr in &ir.sz_attributes {
        unknown.clear();
        collect_unknown_sz_keys(&attr.object, &mut unknown);
        for (key, offset) in &unknown {
            let (line, _) = offset_to_line_column(&file.source, *offset);
            // A numeric key is almost never a typo — it means an array or a spread
            // reached `sz`. Match the JS engines' wording so a `build.parser` flip
            // does not change the diagnostic text.
            if is_numeric_key(key) {
                out.push(format!(
                    "[csszyx] sz received a numeric key \"{key}\" at {location}:{line}. This usually means an array or a spread was passed where an object of sz keys was expected. The value is ignored."
                ));
            } else {
                out.push(format!(
                    "[csszyx] Unknown property \"{key}\" in sz prop at {location}:{line}. This will be ignored. Check for typos."
                ));
            }
        }
        dead_steps.clear();
        super::lower::collect_dead_spacing_steps(&attr.object, &mut dead_steps);
        for (key, value, offset) in &dead_steps {
            let (line, _) = offset_to_line_column(&file.source, *offset);
            // Wording matches the JS engines' warnDeadSpacingStep so a
            // `build.parser` flip does not change the diagnostic text.
            out.push(format!(
                "[csszyx] \"{key}: {value}\" at {location}:{line}: {value} is not on Tailwind's spacing scale (quarter steps only), so the class generates no CSS. Use a quarter step (1.25, 1.5, 1.75) or a unit value (\"{value}rem\")."
            ));
        }
        property_objects.clear();
        super::lower::collect_property_object_values(&attr.object, &mut property_objects);
        for (key, nested, offset) in &property_objects {
            let (line, _) = offset_to_line_column(&file.source, *offset);
            // Wording matches the JS engines' warnPropertyObjectValue so a
            // `build.parser` flip does not change the diagnostic text.
            out.push(format!(
                "[csszyx] \"{key}\" is a property, not a variant, but received an object {{ {nested} }} at {location}:{line}. This compiles to \"{key}:*\" classes that match no Tailwind variant and generate no CSS. Move the nested keys up a level, or for color opacity use {{ color: '...', op: ... }}."
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

fn unsupported_recovery_diagnostics(file: &TransformFile, ir: &super::SourceIr) -> Vec<String> {
    ir.unsupported_recovery_attribute_spans
        .iter()
        .map(|span| {
            format!(
                "[csszyx] szRecover at {}:{}: only static string-literal values \"csr\" or \"dev-only\" are supported. Token emission skipped.",
                file.filename, span.start
            )
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
            uses_color_var: false,
            uses_spacing_var: false,
            uses_unit_var: false,
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
        merge_variable_maps, transform_file, transform_file_with_options, transform_static_classes,
        transform_static_classes_with_options,
    };
    use crate::transform::{
        CssVariableMapEntry, GlobalVarAliasEntry, ParserPath, TransformFile, TransformOptions,
        TransformProducer,
    };

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
        assert!(result.diagnostics.is_empty());
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
        assert!(result.diagnostics.is_empty());
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
        assert!(result.diagnostics.is_empty());
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
        assert!(result.diagnostics.is_empty());
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
        assert!(result.diagnostics.is_empty());
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
}
