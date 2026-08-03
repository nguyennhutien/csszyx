//! Native source rewrite helpers.
//!
//! This slice rewrites static `sz` attributes and merges static string
//! `class`/`className` attributes when parser IR proves they belong to the same
//! JSX opening element.

use string_wizard::{MagicString, UpdateOptions};

use super::{
    css_var_planner::apply_css_variable_mangling,
    lower::{lower_static_sz_object, lower_sz_attribute_classes},
    recovery::{generate_inline_recovery_token, offset_to_line_column},
    DynamicCssVarCategory, DynamicCssVarIr, SourceIr,
};

/// Reason a static IR cannot be rewritten by the current narrow slice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StaticRewriteUnsupported {
    /// No static `sz` attribute was found.
    NoStaticSzAttribute,
    /// No JSX opening element group can be rewritten safely.
    NoStaticOpeningElement,
    /// Static `sz` lowered to no classes.
    EmptyClassList,
}

/// Native rewrite options.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct RewriteOptions {
    /// Whether to rewrite dynamic CSS custom properties to scoped short names.
    pub mangle_vars: bool,
}

/// Rewrite static `sz` attributes into `className="..."`.
pub fn rewrite_static_sz_attributes(
    source: &str,
    filename: &str,
    ir: &SourceIr,
) -> Result<String, StaticRewriteUnsupported> {
    rewrite_static_sz_attributes_with_options(source, filename, ir, RewriteOptions::default())
}

/// Rewrite static `sz` attributes into `className="..."` with native options.
pub fn rewrite_static_sz_attributes_with_options(
    source: &str,
    filename: &str,
    ir: &SourceIr,
    options: RewriteOptions,
) -> Result<String, StaticRewriteUnsupported> {
    let planned_ir = options
        .mangle_vars
        .then(|| apply_css_variable_mangling(ir, source, None));
    let ir = planned_ir.as_ref().map_or(ir, |mangling| &mangling.ir);
    let mut magic = MagicString::new(source);
    let mut rewrote = false;

    for element in &ir.jsx_opening_elements {
        if let Some(recovery_index) = element.recovery_attribute_index {
            if !element.has_recovery_token_attribute {
                if let Some(last_attribute_end) = element.last_attribute_end {
                    let recovery = &ir.recovery_attributes[recovery_index];
                    let (line, column) =
                        offset_to_line_column(source, recovery.attribute_span.start);
                    let token = generate_inline_recovery_token(
                        filename,
                        line,
                        column,
                        &element.element_name,
                    );
                    magic.append_right(
                        last_attribute_end as usize,
                        format!(" data-sz-recovery-token=\"{token}\""),
                    );
                    rewrote = true;
                }
            }
        }

        if !element.sz_attribute_indices.is_empty() {
            let has_array_parts = element
                .sz_attribute_indices
                .iter()
                .any(|index| !ir.sz_attributes[*index].array_parts.is_empty());

            if has_array_parts {
                rewrite_array_sz_attribute(source, ir, element, &mut magic)?;
                rewrote = true;
                continue;
            }

            let has_ternary = element
                .sz_attribute_indices
                .iter()
                .any(|index| !ir.sz_attributes[*index].ternaries.is_empty());

            if has_ternary {
                apply_dynamic_style_props(source, ir, element, &mut magic);
                rewrite_ternary_sz_attribute(source, ir, element, &mut magic)?;
                rewrote = true;
                continue;
            }

            let has_runtime_fallback = element
                .sz_attribute_indices
                .iter()
                .any(|index| ir.sz_attributes[*index].runtime_fallback);

            if has_runtime_fallback {
                rewrite_runtime_fallback_sz_attribute(source, ir, element, &mut magic)?;
                rewrote = true;
                continue;
            }

            rewrite_static_sz_element(source, ir, element, &mut magic)?;
            rewrote = true;
        }

        if element.sz_attribute_indices.is_empty() && !element.hoisted_dynamic_css_vars.is_empty() {
            apply_dynamic_style_props(source, ir, element, &mut magic);
            rewrote = true;
        }
    }

    // szs slot-map attributes: replace the whole authoring attribute with the
    // compiled per-slot class strings on `szsc` — the read-side prop typed as
    // strings — so the component forwards `szsc?.<slot>` into a child
    // className with no cast. Renamed even when every slot was already a
    // class string (the component reads only `szsc`); idempotent because a
    // `szsc` attribute is never collected as an szs attribute.
    for szs in &ir.szs_attributes {
        let body = szs
            .entries
            .iter()
            .map(|entry| format!("{}: {}", entry.key, entry.emit_text))
            .collect::<Vec<_>>()
            .join(", ");
        let replacement = if body.is_empty() {
            "szsc={{}}".to_string()
        } else {
            format!("szsc={{{{ {body} }}}}")
        };
        magic.update_with(
            szs.attribute_span.start as usize,
            szs.attribute_span.end as usize,
            replacement,
            UpdateOptions {
                overwrite: true,
                ..UpdateOptions::default()
            },
        );
        rewrote = true;
    }

    rewrote |= apply_szv_precompile(&mut magic, ir);
    rewrote |= apply_szr_import_rewrite(&mut magic, ir);

    if !rewrote {
        return if ir.sz_attributes.is_empty() {
            Err(StaticRewriteUnsupported::NoStaticSzAttribute)
        } else {
            Err(StaticRewriteUnsupported::NoStaticOpeningElement)
        };
    }

    Ok(magic.to_string())
}

/// Apply the szv precompile splices: call-site replacements plus the table
/// constants appended after their factory declarations.
fn apply_szv_precompile(magic: &mut MagicString<'_>, ir: &SourceIr) -> bool {
    let mut rewrote = false;
    for replacement in &ir.szv_replacements {
        magic.update_with(
            replacement.span.start as usize,
            replacement.span.end as usize,
            replacement.replacement.clone(),
            UpdateOptions {
                overwrite: true,
                ..UpdateOptions::default()
            },
        );
        rewrote = true;
    }
    for insertion in &ir.szv_table_insertions {
        magic.append_right(insertion.offset as usize, insertion.text.clone());
        rewrote = true;
    }
    rewrote
}

/// Retarget a proven-safe szr import at the slim core entry.
///
/// The parser finalized the whole-file proof; this only splices the pre-quoted
/// replacement over the source literal's span.
fn apply_szr_import_rewrite(magic: &mut MagicString<'_>, ir: &SourceIr) -> bool {
    let Some(szr_rewrite) = &ir.szr_import_rewrite else {
        return false;
    };
    magic.update_with(
        szr_rewrite.span.start as usize,
        szr_rewrite.span.end as usize,
        szr_rewrite.replacement.clone(),
        UpdateOptions {
            overwrite: true,
            ..UpdateOptions::default()
        },
    );
    true
}

fn rewrite_array_sz_attribute(
    source: &str,
    ir: &SourceIr,
    element: &super::JsxOpeningElementIr,
    magic: &mut MagicString<'_>,
) -> Result<(), StaticRewriteUnsupported> {
    if element.sz_attribute_indices.len() != 1 {
        return Err(StaticRewriteUnsupported::EmptyClassList);
    }
    let attribute = &ir.sz_attributes[element.sz_attribute_indices[0]];

    let mut arguments = Vec::with_capacity(attribute.array_parts.len());
    for part in &attribute.array_parts {
        // Dynamic elements resolve at runtime through `_szPart` (string
        // passthrough / sz-object compile); static and conditional parts are
        // pre-compiled. `szcn` then applies later-wins per property group.
        if let Some(span) = part.dynamic_span {
            let expression = &source[span.start as usize..span.end as usize];
            arguments.push(format!("_szPart({expression})"));
            continue;
        }
        if !part.classes.is_empty() || part.ternary.is_none() {
            let classes = js_string_literal(&part.classes.join(" "));
            arguments.push(part.condition_span.map_or_else(
                || classes.clone(),
                |span| {
                    let condition = &source[span.start as usize..span.end as usize];
                    format!("{condition} && {classes}")
                },
            ));
        }
        if let Some(ternary) = &part.ternary {
            let test = &source[ternary.test_span.start as usize..ternary.test_span.end as usize];
            let consequent = js_string_literal(&ternary.consequent_classes.join(" "));
            let alternate = js_string_literal(&ternary.alternate_classes.join(" "));
            arguments.push(format!("{test} ? {consequent} : {alternate}"));
        }
    }
    // `_szcn` = the unmemoized szcn twin: compiled arrays carry per-render
    // runtime parts, which would thrash (and evict) the authored-szcn memo.
    let rest = arguments.join(", ");

    if let Some(class_index) = element.class_attribute_index {
        // Authored className is the first argument so later sz array entries
        // retain the same override order as szcn. Every array part contributes
        // at least one argument, and this lane runs only for a non-empty part
        // list, so `rest` always has content.
        wrap_class_attribute(
            magic,
            &ir.class_attributes[class_index],
            "className={_szcn(",
            &format!(", {rest})}}"),
        );
        magic.remove(
            whitespace_start(source, attribute.attribute_span.start as usize),
            attribute.attribute_span.end as usize,
        );
    } else {
        replace_range(
            magic,
            attribute.attribute_span.start as usize,
            attribute.attribute_span.end as usize,
            format!("className={{_szcn({rest})}}"),
        );
    }
    Ok(())
}

fn rewrite_static_sz_element(
    source: &str,
    ir: &SourceIr,
    element: &super::JsxOpeningElementIr,
    magic: &mut MagicString<'_>,
) -> Result<(), StaticRewriteUnsupported> {
    let mut classes = Vec::new();
    let mut rewrites_empty_class = false;
    for index in &element.sz_attribute_indices {
        let attribute = &ir.sz_attributes[*index];
        classes.extend(lower_sz_attribute_classes(attribute));
        rewrites_empty_class |= attribute.rewrites_empty_class;
    }
    if classes.is_empty() && !rewrites_empty_class {
        return Err(StaticRewriteUnsupported::EmptyClassList);
    }

    if let Some(class_index) = element.class_attribute_index {
        rewrite_static_sz_with_existing_class(source, ir, element, magic, class_index, &classes);
        apply_dynamic_style_props(source, ir, element, magic);
        return Ok(());
    }

    // The caller dispatches here only for elements carrying at least one sz
    // attribute; array, ternary, and runtime fallbacks take earlier lanes.
    let first_attribute = &ir.sz_attributes[element.sz_attribute_indices[0]];
    overwrite_attribute(magic, first_attribute.attribute_span, &classes.join(" "));
    for index in element.sz_attribute_indices.iter().skip(1) {
        let attribute = &ir.sz_attributes[*index];
        magic.remove(
            whitespace_start(source, attribute.attribute_span.start as usize),
            attribute.attribute_span.end as usize,
        );
    }
    apply_dynamic_style_props(source, ir, element, magic);
    Ok(())
}

fn rewrite_static_sz_with_existing_class(
    source: &str,
    ir: &SourceIr,
    element: &super::JsxOpeningElementIr,
    magic: &mut MagicString<'_>,
    class_index: usize,
    classes: &[String],
) {
    let class_attribute = &ir.class_attributes[class_index];
    if class_attribute.expression_span.is_some() {
        let next = js_string_literal(&classes.join(" "));
        wrap_class_attribute(
            magic,
            class_attribute,
            "className={_szMerge(",
            &format!(", {next})}}"),
        );
    } else {
        let existing_classes = class_attribute
            .value
            .split_whitespace()
            .filter(|class_name| !class_name.is_empty());
        let merged = existing_classes
            .chain(classes.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" ");
        overwrite_attribute(magic, class_attribute.attribute_span, &merged);
    }

    for index in &element.sz_attribute_indices {
        let attribute = &ir.sz_attributes[*index];
        magic.remove(
            whitespace_start(source, attribute.attribute_span.start as usize),
            attribute.attribute_span.end as usize,
        );
    }
}

/// Emit `className={cond ? "…" : "…"}` or merge it with an existing class.
///
/// Multiple `sz` attributes are still unsupported for ternary because the
/// runtime expression shape would need ordered merging across separate source
/// spans.
#[allow(clippy::too_many_lines)]
fn rewrite_ternary_sz_attribute(
    source: &str,
    ir: &SourceIr,
    element: &super::JsxOpeningElementIr,
    magic: &mut MagicString<'_>,
) -> Result<(), StaticRewriteUnsupported> {
    if element.sz_attribute_indices.len() != 1 {
        return Err(StaticRewriteUnsupported::EmptyClassList);
    }
    let only_attribute = &ir.sz_attributes[element.sz_attribute_indices[0]];
    let ternaries = &only_attribute.ternaries;
    debug_assert!(!ternaries.is_empty(), "caller verified ternary presence");

    // Static classes accompanying the conditionals (e.g. from a `...CONST`
    // spread or sibling static props): only the conditionals stay runtime.
    // Lower just the static object so the ternaries' own branch classes are
    // not duplicated. Runtime css-var siblings (`w: width`) append their
    // `w-(--_sz-w)` class here — their style props are emitted by
    // apply_dynamic_style_props — in the same statics-then-vars order Babel
    // emits.
    let mut static_classes = lower_static_sz_object(&only_attribute.object);
    static_classes.extend(
        only_attribute
            .dynamic_css_vars
            .iter()
            .filter(|prop| !prop.skip_class)
            .map(super::lower::dynamic_css_var_class),
    );

    // One `test ? "…" : "…"` expression per conditional. Branches stay ""
    // in every interpolated position — `${undefined}` would render the text
    // "undefined". Only the bare single-ternary value position below uses
    // `undefined` for an empty branch (renders no class attribute).
    let ternary_source = |ternary: &super::StaticTernaryIr| {
        let test = &source[ternary.test_span.start as usize..ternary.test_span.end as usize];
        format!(
            "{test} ? \"{}\" : \"{}\"",
            ternary.consequent_classes.join(" "),
            ternary.alternate_classes.join(" ")
        )
    };

    // Template literal appending one `${…}` segment per conditional after the
    // static/var classes — byte-for-byte the Babel engine's emission: first
    // quasi is `"statics "` (trailing space) or empty, separator is a single
    // space.
    let template_literal = || {
        let mut out = String::from("`");
        if !static_classes.is_empty() {
            out.push_str(&static_classes.join(" "));
            out.push(' ');
        }
        for (index, ternary) in ternaries.iter().enumerate() {
            if index > 0 {
                out.push(' ');
            }
            out.push_str("${");
            out.push_str(&ternary_source(ternary));
            out.push('}');
        }
        out.push('`');
        out
    };

    if let Some(class_index) = element.class_attribute_index {
        let class_attribute = &ir.class_attributes[class_index];
        // A companion-less single ternary merges bare; anything with static/var
        // classes merges the SAME template literal the Babel engine emits —
        // the old 3-arg form (existing, "statics", ternary) was functionally
        // equal but byte-different, breaking cross-producer transform-cache
        // reuse for this shape.
        let merged = match (ternaries.as_slice(), static_classes.is_empty()) {
            ([only_ternary], true) => ternary_source(only_ternary),
            _ => template_literal(),
        };
        wrap_class_attribute(
            magic,
            class_attribute,
            "className={_szMerge(",
            &format!(", {merged})}}"),
        );
        magic.remove(
            whitespace_start(source, only_attribute.attribute_span.start as usize),
            only_attribute.attribute_span.end as usize,
        );
    } else {
        let replacement =
            if let ([only_ternary], true) = (ternaries.as_slice(), static_classes.is_empty()) {
                // Bare value position: an empty branch becomes `undefined` so it
                // renders no class attribute.
                let branch = |classes: &[String]| {
                    let joined = classes.join(" ");
                    if joined.is_empty() {
                        "undefined".to_string()
                    } else {
                        format!("\"{joined}\"")
                    }
                };
                let test = &source
                    [only_ternary.test_span.start as usize..only_ternary.test_span.end as usize];
                format!(
                    "className={{{test} ? {} : {}}}",
                    branch(&only_ternary.consequent_classes),
                    branch(&only_ternary.alternate_classes)
                )
            } else {
                format!("className={{{}}}", template_literal())
            };
        magic.update_with(
            only_attribute.attribute_span.start as usize,
            only_attribute.attribute_span.end as usize,
            replacement,
            UpdateOptions {
                overwrite: true,
                ..UpdateOptions::default()
            },
        );
    }
    Ok(())
}

/// Emit a runtime fallback for a single `sz` attribute.
///
/// When there is no companion `className`/`class`, emit
/// `className={_sz(<original-source>)}`. When a companion exists, emit
/// `className={_szMerge(existing, _sz(<original-source>))}` and remove `sz`.
fn rewrite_runtime_fallback_sz_attribute(
    source: &str,
    ir: &SourceIr,
    element: &super::JsxOpeningElementIr,
    magic: &mut MagicString<'_>,
) -> Result<(), StaticRewriteUnsupported> {
    if element.sz_attribute_indices.len() != 1 {
        return Err(StaticRewriteUnsupported::EmptyClassList);
    }
    let only_attribute = &ir.sz_attributes[element.sz_attribute_indices[0]];
    debug_assert!(only_attribute.runtime_fallback);
    let expression_source =
        &source[only_attribute.value_span.start as usize..only_attribute.value_span.end as usize];

    if let Some(class_index) = element.class_attribute_index {
        let class_attribute = &ir.class_attributes[class_index];
        wrap_class_attribute(
            magic,
            class_attribute,
            "className={_szMerge(",
            &format!(", _sz({expression_source}))}}"),
        );
        magic.remove(
            whitespace_start(source, only_attribute.attribute_span.start as usize),
            only_attribute.attribute_span.end as usize,
        );
    } else {
        magic.update_with(
            only_attribute.attribute_span.start as usize,
            only_attribute.attribute_span.end as usize,
            format!("className={{_sz({expression_source})}}"),
            UpdateOptions {
                overwrite: true,
                ..UpdateOptions::default()
            },
        );
    }
    Ok(())
}

fn js_string_literal(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

/// Wrap an authored `className` attribute in a merge call, leaving the authored
/// expression's own bytes untouched.
///
/// The szv precompile splices its table picks over factory calls that can sit
/// inside that expression — `className={szr(f({ v }))}` — and the rewrite
/// buffer refuses to split a range another edit already replaced, which aborted
/// the whole process. Replacing only the text on either side of the expression
/// keeps the inner range editable, so the merge and the precompile compose.
fn wrap_class_attribute(
    magic: &mut MagicString<'_>,
    class_attribute: &super::ClassAttributeIr,
    prefix: &str,
    suffix: &str,
) {
    let span = class_attribute.attribute_span;
    let Some(expression_span) = class_attribute.expression_span else {
        let existing = js_string_literal(&class_attribute.value);
        replace_range(
            magic,
            span.start as usize,
            span.end as usize,
            format!("{prefix}{existing}{suffix}"),
        );
        return;
    };
    replace_range(
        magic,
        span.start as usize,
        expression_span.start as usize,
        prefix.to_string(),
    );
    replace_range(
        magic,
        expression_span.end as usize,
        span.end as usize,
        suffix.to_string(),
    );
}

fn replace_range(magic: &mut MagicString<'_>, start: usize, end: usize, replacement: String) {
    magic.update_with(
        start,
        end,
        replacement,
        UpdateOptions {
            overwrite: true,
            ..UpdateOptions::default()
        },
    );
}

fn apply_dynamic_style_props(
    source: &str,
    ir: &SourceIr,
    element: &super::JsxOpeningElementIr,
    magic: &mut MagicString<'_>,
) {
    let dynamic_props = element
        .sz_attribute_indices
        .iter()
        .flat_map(|index| ir.sz_attributes[*index].dynamic_css_vars.iter())
        .filter(|prop| !prop.hoisted)
        .chain(element.hoisted_dynamic_css_vars.iter())
        .collect::<Vec<_>>();
    if dynamic_props.is_empty() {
        return;
    }

    let props = dynamic_props
        .iter()
        .map(|prop| style_prop_source(source, prop))
        .collect::<Vec<_>>()
        .join(", ");

    if let Some(spread) = &element.safe_style_spread {
        if let Some(replacement) = safe_style_spread_source(source, spread, &props) {
            magic.update_with(
                spread.attribute_span.start as usize,
                spread.attribute_span.end as usize,
                replacement,
                UpdateOptions {
                    overwrite: true,
                    ..UpdateOptions::default()
                },
            );
            return;
        }
    }

    if let Some(style_index) = element.style_attribute_index {
        let style_attr = &ir.style_attributes[style_index];
        if let Some(expression_span) = style_attr.expression_span {
            let expression = &source[expression_span.start as usize..expression_span.end as usize];
            magic.update_with(
                style_attr.attribute_span.start as usize,
                style_attr.attribute_span.end as usize,
                format!("style={{{{...{expression}, {props}}}}}"),
                UpdateOptions {
                    overwrite: true,
                    ..UpdateOptions::default()
                },
            );
        }
        return;
    }

    let insert_at = element.last_attribute_end.map_or_else(
        || opening_attribute_insert_offset(source, element.opening_span.end as usize),
        |offset| offset as usize,
    );
    magic.append_right(insert_at, format!(" style={{{{{props}}}}}"));
}

fn safe_style_spread_source(
    source: &str,
    spread: &super::SafeStyleSpreadIr,
    props: &str,
) -> Option<String> {
    let expression = match &spread.expression {
        super::SafeStyleSpreadExpressionIr::Object(object) => {
            safe_style_spread_object_source(source, object, props)?
        }
        super::SafeStyleSpreadExpressionIr::Conditional {
            test_span,
            consequent,
            alternate,
        } => {
            let test = &source[test_span.start as usize..test_span.end as usize];
            let consequent = safe_style_spread_object_source(source, consequent, props)?;
            let alternate = safe_style_spread_object_source(source, alternate, props)?;
            format!("({test} ? {consequent} : {alternate})")
        }
    };
    Some(format!("{{...{expression}}}"))
}

fn safe_style_spread_object_source(
    source: &str,
    object: &super::SafeStyleSpreadObjectIr,
    props: &str,
) -> Option<String> {
    let object_source = &source[object.object_span.start as usize..object.object_span.end as usize];
    let Some(style_value) = &object.style_value else {
        return append_object_property(
            object_source,
            object.has_properties,
            &format!("style: {{{props}}}"),
        );
    };
    let (span, replacement) = match style_value {
        super::SafeStyleSpreadValueIr::Object {
            span,
            has_properties,
        } => {
            let style_source = &source[span.start as usize..span.end as usize];
            (
                *span,
                append_object_property(style_source, *has_properties, props)?,
            )
        }
        super::SafeStyleSpreadValueIr::Expression(span) => {
            let value = &source[span.start as usize..span.end as usize];
            (*span, format!("{{...({value}), {props}}}"))
        }
    };
    let relative_start = (span.start - object.object_span.start) as usize;
    let relative_end = (span.end - object.object_span.start) as usize;
    Some(format!(
        "{}{}{}",
        &object_source[..relative_start],
        replacement,
        &object_source[relative_end..]
    ))
}

fn append_object_property(source: &str, has_properties: bool, property: &str) -> Option<String> {
    let body = source.strip_suffix('}')?;
    let separator = if !has_properties {
        ""
    } else if body.trim_end().ends_with(',') {
        " "
    } else {
        ", "
    };
    Some(format!("{body}{separator}{property}}}"))
}

fn style_prop_source(source: &str, prop: &DynamicCssVarIr) -> String {
    format!(
        "{}: {}",
        js_string_literal(&prop.var_name),
        dynamic_style_value_source(source, prop)
    )
}

fn dynamic_style_value_source(source: &str, prop: &DynamicCssVarIr) -> String {
    let expression =
        &source[prop.expression_span.start as usize..prop.expression_span.end as usize];
    match prop.category {
        DynamicCssVarCategory::Spacing => {
            format!(
                "__szSpacingVar({expression}, {})",
                js_string_literal(&prop.key)
            )
        }
        DynamicCssVarCategory::Color => format!("__szColorVar({expression})"),
        DynamicCssVarCategory::Angle => {
            format!(
                "__szUnitVar({expression}, \"deg\", {})",
                js_string_literal(&prop.key)
            )
        }
        DynamicCssVarCategory::Duration => {
            format!(
                "__szUnitVar({expression}, \"ms\", {})",
                js_string_literal(&prop.key)
            )
        }
        DynamicCssVarCategory::Passthrough => expression.to_string(),
    }
}

fn overwrite_attribute(magic: &mut MagicString<'_>, span: super::TextSpan, class_name: &str) {
    // An sz that lowers to zero classes (with no className to merge into) emits
    // `className={undefined}` so the DOM has no `class` attribute, instead of the
    // noisy `class=""`.
    let replacement = if class_name.is_empty() {
        "className={undefined}".to_string()
    } else if class_name.contains('"') {
        format!("className={{{}}}", js_string_literal(class_name))
    } else {
        format!("className=\"{class_name}\"")
    };
    magic.update_with(
        span.start as usize,
        span.end as usize,
        replacement,
        UpdateOptions {
            overwrite: true,
            ..UpdateOptions::default()
        },
    );
}

fn whitespace_start(source: &str, attr_start: usize) -> usize {
    let mut index = attr_start;
    while index > 0 && source.as_bytes()[index - 1].is_ascii_whitespace() {
        index -= 1;
    }
    index
}

fn opening_attribute_insert_offset(source: &str, opening_end: usize) -> usize {
    let mut index = opening_end.saturating_sub(1);
    while index > 0 && source.as_bytes()[index].is_ascii_whitespace() {
        index -= 1;
    }
    if source.as_bytes().get(index) == Some(&b'>') {
        index = index.saturating_sub(1);
    }
    while index > 0 && source.as_bytes()[index].is_ascii_whitespace() {
        index -= 1;
    }
    if source.as_bytes().get(index) == Some(&b'/') {
        index
    } else {
        index.saturating_add(1)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        opening_attribute_insert_offset, rewrite_static_sz_attributes,
        rewrite_static_sz_attributes_with_options, whitespace_start, RewriteOptions,
        StaticRewriteUnsupported,
    };
    use crate::transform::{parser::parse_source_shell, TransformFile};

    fn parse(source: &str) -> crate::transform::SourceIr {
        parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        })
        .ir
    }

    fn rewrite(source: &str) -> Result<String, StaticRewriteUnsupported> {
        rewrite_static_sz_attributes(source, "/repo/src/App.tsx", &parse(source))
    }

    #[test]
    fn attribute_offset_helpers_handle_spaced_and_non_self_closing_tags() {
        assert_eq!(whitespace_start("<div   sz", 7), 4);
        assert_eq!(opening_attribute_insert_offset("<div   >", 8), 4);
        assert_eq!(opening_attribute_insert_offset("<div   />", 9), 7);
        assert_eq!(opening_attribute_insert_offset("<div", 4), 4);
        assert_eq!(opening_attribute_insert_offset("<div   ", 7), 4);
    }

    #[test]
    fn rewrites_single_static_sz_attribute() {
        let source =
            "export const App = () => <div sz={{ start: 4, hover: { bg: 'red-500' } }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"inset-s-4 hover:bg-red-500\" />;"
        );
    }

    #[test]
    // The fixtures are JSX sources whose `{p:2}` object literals read as
    // formatting placeholders to the lint; they are never format strings.
    #[allow(clippy::literal_string_with_formatting_args)]
    fn rewrites_typescript_wrapped_static_ternaries() {
        let cases = [
            "const A=({on})=><div sz={(on?{p:2}:{p:4}) as const}/>;",
            "const A=({on})=><div sz={(on?{p:2}:{p:4}) satisfies object}/>;",
            "const A=({on})=><div sz={(on?{p:2}:{p:4})!}/>;",
            "const STYLE=(on?{p:2}:{p:4}) as const; const A=()=> <div sz={STYLE}/>;",
            "const STYLE=((on?{p:2}:{p:4}) as const)!; const A=()=> <div sz={STYLE}/>;",
        ];

        for source in cases {
            let rewritten = rewrite(source).expect("wrapped ternary should be rewritten");

            assert!(
                rewritten.contains("className={on ? \"p-2\" : \"p-4\"}"),
                "{source}: {rewritten}"
            );
            assert!(!rewritten.contains(" sz="), "{source}: {rewritten}");
        }
    }

    #[test]
    fn merges_existing_static_class_attribute() {
        let source = "export const App = () => <div className=\"block\" sz={{ p: 4 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"block p-4\" />;"
        );
    }

    #[test]
    fn merges_existing_dynamic_class_attribute() {
        let source = "export const App = () => <div className={getClass()} sz={{ p: 4 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className={_szMerge(getClass(), \"p-4\")} />;"
        );
    }

    #[test]
    fn rewrites_multiple_grouped_static_sz_attributes() {
        let source = "export const App = () => <div sz={{ p: 4 }} sz={{ m: 2 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"p-4 m-2\" />;"
        );
    }

    #[test]
    fn rewrites_multiple_opening_elements_independently() {
        let source =
            "export const App = () => <><div sz={{ p: 4 }} /><span className=\"x\" sz={{ m: 2 }} /></>;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <><div className=\"p-4\" /><span className=\"x m-2\" /></>;"
        );
    }

    #[test]
    fn rewrites_static_string_sz_attribute() {
        let source = "export const App = () => <div sz=\"p-4 bg-blue-500\" />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"p-4 bg-blue-500\" />;"
        );
    }

    #[test]
    fn escapes_quotes_in_static_string_sz_attribute() {
        let source = "export const App = () => <div sz='content-[\"x\"]' />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className={\"content-[\\\"x\\\"]\"} />;"
        );
    }

    #[test]
    fn reports_static_ir_without_an_opening_element_group() {
        let source = "export const App = () => <div sz={{ p: 4 }} />;";
        let mut ir = parse(source);
        ir.jsx_opening_elements.clear();

        assert_eq!(
            rewrite_static_sz_attributes(source, "/repo/src/App.tsx", &ir),
            Err(StaticRewriteUnsupported::NoStaticOpeningElement)
        );
    }

    #[test]
    fn rewrites_empty_static_object_sz_attribute() {
        let source = "export const App = () => <div sz={{}} />;";
        let rewritten = rewrite(source).expect("rewritten");

        // An sz that lowers to zero classes emits `className={undefined}` so the
        // DOM has no `class` attribute, instead of the noisy `class=""`.
        assert_eq!(
            rewritten,
            "export const App = () => <div className={undefined} />;"
        );
    }

    #[test]
    fn rewrites_static_array_sz_attribute() {
        let source =
            "export const App = () => <div sz={[{ display: 'flex' }, false, null, { p: 4 }]} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"flex p-4\" />;"
        );
    }

    #[test]
    fn merges_existing_class_with_conditional_array_parts() {
        let source = "const base = { p: 4 }; const App = ({ active }) => <div className=\"block\" sz={[base, active && { m: 2 }]} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const base = { p: 4 }; const App = ({ active }) => <div className={_szcn(\"block\", \"p-4\", active && \"m-2\")} />;"
        );
    }

    #[test]
    fn rejects_multiple_array_sz_attributes_on_one_element() {
        let source = "const App = ({ active }) => <div sz={[active && { p: 2 }]} sz={[active && { m: 2 }]} />;";

        assert_eq!(
            rewrite(source),
            Err(StaticRewriteUnsupported::EmptyClassList)
        );
    }

    #[test]
    fn rewrites_empty_slot_map_to_compiled_prop() {
        let source = "const App = () => <Card szs={{}} />;";

        assert_eq!(
            rewrite(source).expect("rewritten"),
            "const App = () => <Card szsc={{}} />;"
        );
    }

    #[test]
    fn skips_null_and_undefined_static_object_values() {
        let source = "export const App = () => <div sz={{ p: 4, gap: null, m: undefined }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"p-4\" />;"
        );
    }

    #[test]
    fn rewrites_static_object_literal_spreads() {
        let source = "export const App = () => <div sz={{ ...{ p: 4 }, m: 2 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"p-4 m-2\" />;"
        );
    }

    #[test]
    fn rewrites_dynamic_spacing_value_to_css_var_style() {
        let source = "const App = () => <div sz={{ p: padVal }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const App = () => <div className=\"p-(--_sz-p)\" style={{\"--_sz-p\": __szSpacingVar(padVal, \"p\")}} />;"
        );
    }

    #[test]
    fn omits_nullable_dynamic_utility() {
        let source = "const App = ({ flex }) => <div sz={{ flex: typeof flex === 'number' ? flex : undefined }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const App = ({ flex }) => <div className={typeof flex === 'number' ? \"flex-(--_sz-flex)\" : undefined} style={{\"--_sz-flex\": typeof flex === 'number' ? flex : undefined}} />;"
        );
    }

    #[test]
    fn rewrites_two_property_ternaries_as_template_segments() {
        // Byte-parity with the Babel engine: one `${…}` segment per
        // conditional in source property order, single-space separators.
        let source = "const A = ({ a, b }) => <div sz={{ p: a ? 2 : 4, m: b ? 1 : 3 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const A = ({ a, b }) => <div className={`${a ? \"p-2\" : \"p-4\"} ${b ? \"m-1\" : \"m-3\"}`} />;"
        );
    }

    #[test]
    fn rewrites_two_nullable_ternaries_beside_statics_and_a_runtime_var() {
        // The shape the single-ternary IR used to punt whole to the runtime
        // (losing the w-(--_sz-w) safelist entry). Statics and var classes
        // lead, then one template segment per conditional; empty branches stay
        // "" inside the template.
        let source = "const A = ({ w, a, b }) => <div sz={{ w: w, h: 'max', p: a ? 2 : undefined, m: b ? 4 : undefined }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const A = ({ w, a, b }) => <div className={`h-max w-(--_sz-w) ${a ? \"p-2\" : \"\"} ${b ? \"m-4\" : \"\"}`} style={{\"--_sz-w\": __szSpacingVar(w, \"w\")}} />;"
        );
    }

    #[test]
    fn merges_a_single_ternary_with_statics_as_the_babel_template() {
        // The old 3-arg _szMerge(existing, "statics", ternary) was functionally
        // equal to Babel's 2-arg template merge but byte-different, breaking
        // cross-producer transform-cache reuse for this shape.
        let source =
            "export const A = ({ on }) => <div className=\"q\" sz={{ bg: 'white', p: on ? 2 : 4 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const A = ({ on }) => <div className={_szMerge(\"q\", `bg-white ${on ? \"p-2\" : \"p-4\"}`)} />;"
        );
    }

    #[test]
    fn merges_two_property_ternaries_into_an_existing_class_name() {
        let source =
            "const A = ({ a, b }) => <div className=\"x\" sz={{ p: a ? 2 : 4, m: b ? 1 : 3 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const A = ({ a, b }) => <div className={_szMerge(\"x\", `${a ? \"p-2\" : \"p-4\"} ${b ? \"m-1\" : \"m-3\"}`)} />;"
        );
    }

    #[test]
    fn keeps_runtime_var_siblings_beside_a_nullable_conditional() {
        // A bare runtime identifier, a static literal, and a nullable ternary in
        // ONE object used to punt the whole attribute to the runtime fallback,
        // which never safelists the dynamic utilities — Tailwind emitted no CSS
        // for them and the styling silently never applied (field-reported).
        // Expected shape mirrors the Babel output: statics, then var classes,
        // then the ternary appended in a template literal.
        let source = "const A = ({ width, flex, cond }) => <div sz={{ w: width, h: 'max', flex: cond ? flex : undefined }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const A = ({ width, flex, cond }) => <div className={`h-max w-(--_sz-w) ${cond ? \"flex-(--_sz-flex)\" : \"\"}`} style={{\"--_sz-w\": __szSpacingVar(width, \"w\"), \"--_sz-flex\": cond ? flex : undefined}} />;"
        );
    }

    #[test]
    fn rewrites_dynamic_spacing_value_with_scoped_mangled_var() {
        let source = "const App = () => <div sz={{ p: padVal }} />;";
        let rewritten = rewrite_static_sz_attributes_with_options(
            source,
            "/repo/src/App.tsx",
            &parse(source),
            RewriteOptions { mangle_vars: true },
        )
        .expect("rewritten");

        assert_eq!(
            rewritten,
            "const App = () => <div className=\"p-(--sz)\" style={{\"--sz\": __szSpacingVar(padVal, \"p\")}} />;"
        );
    }

    #[test]
    fn hoists_repeated_dynamic_spacing_value_to_common_ancestor() {
        let source =
            "const App = () => <section><div sz={{ p: pad }} /><span sz={{ p: pad }} /></section>;";
        let rewritten = rewrite_static_sz_attributes_with_options(
            source,
            "/repo/src/App.tsx",
            &parse(source),
            RewriteOptions { mangle_vars: true },
        )
        .expect("rewritten");

        assert_eq!(
            rewritten,
            "const App = () => <section style={{\"--cz\": __szSpacingVar(pad, \"p\")}}><div className=\"p-(--cz)\" /><span className=\"p-(--cz)\" /></section>;"
        );
    }

    #[test]
    fn merges_dynamic_spacing_value_with_static_class() {
        let source = "const App = () => <div className=\"base\" sz={{ p: padVal }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const App = () => <div className=\"base p-(--_sz-p)\" style={{\"--_sz-p\": __szSpacingVar(padVal, \"p\")}} />;"
        );
    }

    #[test]
    fn merges_dynamic_spacing_value_with_dynamic_class() {
        let source = "const App = () => <div className={getClasses()} sz={{ p: padVal }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const App = () => <div className={_szMerge(getClasses(), \"p-(--_sz-p)\")} style={{\"--_sz-p\": __szSpacingVar(padVal, \"p\")}} />;"
        );
    }

    #[test]
    fn merges_dynamic_spacing_value_into_existing_style_expression() {
        let source = "const App = () => <div style={{ color: \"red\" }} sz={{ p: padVal }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const App = () => <div style={{...{ color: \"red\" }, \"--_sz-p\": __szSpacingVar(padVal, \"p\")}} className=\"p-(--_sz-p)\" />;"
        );
    }

    #[test]
    fn merges_dynamic_style_vars_into_safe_object_spreads() {
        let cases = [
            (
                "const A=({width})=><div sz={{w:width}} {...{}}/>;",
                "const A=({width})=><div className=\"w-(--_sz-w)\" {...{style: {\"--_sz-w\": __szSpacingVar(width, \"w\")}}}/>;",
            ),
            (
                "const A=({width})=><div sz={{w:width}} {...{id:'x'}}/>;",
                "const A=({width})=><div className=\"w-(--_sz-w)\" {...{id:'x', style: {\"--_sz-w\": __szSpacingVar(width, \"w\")}}}/>;",
            ),
            (
                "const A=({width,flex})=><div sz={{w:width}} {...{style:{flex,},}}/>;",
                "const A=({width,flex})=><div className=\"w-(--_sz-w)\" {...{style:{flex, \"--_sz-w\": __szSpacingVar(width, \"w\")},}}/>;",
            ),
            (
                "const A=({width,base})=><div sz={{w:width}} {...{style:base,id:'x'}}/>;",
                "const A=({width,base})=><div className=\"w-(--_sz-w)\" {...{style:{...(base), \"--_sz-w\": __szSpacingVar(width, \"w\")},id:'x'}}/>;",
            ),
        ];

        for (source, expected) in cases {
            let rewritten = rewrite(source).expect("rewritten");
            assert_eq!(rewritten, expected, "{source}");
            assert!(!rewritten.contains(" style={{"), "{source}");
        }
    }

    #[test]
    fn falls_back_when_a_safe_spread_ir_no_longer_matches_source() {
        let source = "const A=({width})=><div sz={{w:width}} {...{}}/>;";
        let mut ir = parse(source);
        let spread = ir.jsx_opening_elements[0]
            .safe_style_spread
            .as_mut()
            .expect("safe spread");
        let crate::transform::SafeStyleSpreadExpressionIr::Object(object) = &mut spread.expression
        else {
            panic!("object spread");
        };
        object.object_span.end -= 1;

        let rewritten = rewrite_static_sz_attributes(source, "/repo/src/App.tsx", &ir)
            .expect("fallback rewrite");

        assert!(rewritten.contains(" style={{\"--_sz-w\":"));
        assert!(rewritten.contains("{...{}}"));
    }

    #[test]
    fn merges_dynamic_style_vars_into_each_conditional_spread_branch() {
        let source =
            "const A=({width,cond,flex})=><div sz={{w:width}} {...(cond?{style:{flex,},}:{})}/>;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const A=({width,cond,flex})=><div className=\"w-(--_sz-w)\" {...(cond ? {style:{flex, \"--_sz-w\": __szSpacingVar(width, \"w\")},} : {style: {\"--_sz-w\": __szSpacingVar(width, \"w\")}})}/>;"
        );
        assert_eq!(rewritten.matches("__szSpacingVar").count(), 2);
        assert!(!rewritten.contains(" style={{"));
    }

    #[test]
    fn rewrites_identifier_backed_spread() {
        // `{ ...BASE, m: 2 }` resolves BASE through the declarator scope
        // and flattens its initializer's properties in source order before
        // the trailing literal property. This locks in the contract that
        // identifier-backed spreads do not need a runtime helper as long
        // as every referenced binding resolves to a fully static object.
        let source = "const BASE = { p: 4 } as const;\nexport const App = () => <div sz={{ ...BASE, m: 2 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const BASE = { p: 4 } as const;\nexport const App = () => <div className=\"p-4 m-2\" />;"
        );
    }

    #[test]
    fn rewrites_identifier_spread_only() {
        let source = "const BASE = { p: 4, m: 2 } as const;\nexport const App = () => <div sz={{ ...BASE }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const BASE = { p: 4, m: 2 } as const;\nexport const App = () => <div className=\"p-4 m-2\" />;"
        );
    }

    #[test]
    fn rewrites_static_object_with_last_property_wins_semantics() {
        let source = "const App = () => <div sz={{ p: 2, m: 1, p: 4 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const App = () => <div className=\"p-4 m-1\" />;"
        );
    }

    #[test]
    fn rewrites_identifier_spread_with_trailing_override() {
        let source = "const ITEM = { p: 2, rounded: 'md' } as const;\nconst App = () => <div sz={{ ...ITEM, p: 8 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const ITEM = { p: 2, rounded: 'md' } as const;\nconst App = () => <div className=\"p-8 rounded-md\" />;"
        );
    }

    #[test]
    fn rewrites_nested_variant_override_as_replacement() {
        let source = "const BASE = { hover: { p: 2, m: 1 } } as const;\nconst App = () => <div sz={{ ...BASE, hover: { p: 4 } }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const BASE = { hover: { p: 2, m: 1 } } as const;\nconst App = () => <div className=\"hover:p-4\" />;"
        );
    }

    #[test]
    fn keeps_array_entries_as_composed_style_objects() {
        // Later-wins deep merge: the later element's `p: 4` replaces `p: 2`
        // at the same key path; `m: 1` survives.
        let source = "const App = () => <div sz={[{ p: 2, m: 1 }, { p: 4 }]} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const App = () => <div className=\"p-4 m-1\" />;"
        );
    }

    #[test]
    fn rewrites_empty_static_array_sz_attribute() {
        let source = "export const App = () => <div sz={[false, null, undefined]} />;";
        let rewritten = rewrite(source).expect("rewritten");

        // Zero classes → `className={undefined}` (no class attribute), not `class=""`.
        assert_eq!(
            rewritten,
            "export const App = () => <div className={undefined} />;"
        );
    }

    #[test]
    fn rewrites_typescript_wrapped_static_sz_attribute() {
        let source = "export const App = () => <div sz={{ p: 4 } as const} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"p-4\" />;"
        );
    }

    #[test]
    fn rewrites_typescript_wrapped_static_property_values() {
        let source =
            "export const App = () => <div sz={{ p: (4 as const), m: (2 satisfies number) }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"p-4 m-2\" />;"
        );
    }

    #[test]
    fn appends_static_recovery_token_attribute() {
        let source = "export const App = () => <div szRecover=\"csr\">x</div>;";
        let rewritten = rewrite(source).expect("rewritten");

        assert!(rewritten.contains("szRecover=\"csr\" data-sz-recovery-token=\""));
        assert_eq!(rewritten.matches("data-sz-recovery-token").count(), 1);
    }

    #[test]
    fn appends_recovery_token_after_last_attribute_before_sz_rewrite() {
        let source = "export const App = () => <div szRecover=\"csr\" sz={{ p: 4 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert!(rewritten.contains("szRecover=\"csr\" className=\"p-4\" data-sz-recovery-token=\""));
        assert_eq!(rewritten.matches("data-sz-recovery-token").count(), 1);
    }

    #[test]
    fn skips_recovery_token_when_already_tagged() {
        let source =
            "export const App = () => <div szRecover=\"csr\" data-sz-recovery-token=\"abc\">x</div>;";

        assert_eq!(
            rewrite(source),
            Err(StaticRewriteUnsupported::NoStaticSzAttribute)
        );
    }

    #[test]
    fn rewrites_static_ternary_sz_attribute() {
        let source = "const X = ({ active }) => <div sz={active ? { p: 4 } : { p: 8 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const X = ({ active }) => <div className={active ? \"p-4\" : \"p-8\"} />;"
        );
    }

    #[test]
    fn rewrites_identifier_static_ternary_sz_attribute() {
        let source = "const X = ({ active }) => { const styles = active ? { p: 4 } : { p: 8 }; return <div sz={styles} />; };";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const X = ({ active }) => { const styles = active ? { p: 4 } : { p: 8 }; return <div className={active ? \"p-4\" : \"p-8\"} />; };"
        );
    }

    #[test]
    fn rewrites_static_property_ternary_sz_attribute() {
        let source = "const X = ({ big }) => <div sz={{ p: big ? 8 : 4 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const X = ({ big }) => <div className={big ? \"p-8\" : \"p-4\"} />;"
        );
    }

    #[test]
    fn rewrites_color_opacity_sub_property_ternary() {
        // A ternary on the `op` sub-field must lower to complete color-opacity
        // classes per branch, not the dead `bg:op-30` form.
        let source =
            "const X = ({ dim }) => <div sz={{ bg: { color: 'black', op: dim ? 30 : 100 } }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const X = ({ dim }) => <div className={dim ? \"bg-black/30\" : \"bg-black/100\"} />;"
        );
    }

    #[test]
    fn rewrites_palette_color_opacity_sub_property_ternary() {
        let source =
            "const X = ({ dim }) => <div sz={{ bg: { color: 'red-500', op: dim ? 30 : 100 } }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const X = ({ dim }) => <div className={dim ? \"bg-red-500/30\" : \"bg-red-500/100\"} />;"
        );
    }

    #[test]
    fn rewrites_color_opacity_color_ternary() {
        // A ternary on `color` (with a static `op` sibling) lowers to complete
        // color-opacity classes per branch, not the dead `bg:op-50` / `bg:text-*`
        // pair that a bare sub-property ternary emits.
        let source =
            "const X = ({ c }) => <div sz={{ bg: { color: c ? 'red-500' : 'blue-500', op: 50 } }} />;";
        assert_eq!(
            rewrite(source).expect("rewritten"),
            "const X = ({ c }) => <div className={c ? \"bg-red-500/50\" : \"bg-blue-500/50\"} />;"
        );
    }

    #[test]
    fn rewrites_color_opacity_op_ternary_non_bg_sides() {
        // The op-ternary lowering applies to every color-capable side, not just bg.
        let text =
            "const X = ({ c }) => <div sz={{ text: { color: 'black', op: c ? 30 : 100 } }} />;";
        assert_eq!(
            rewrite(text).expect("rewritten"),
            "const X = ({ c }) => <div className={c ? \"text-black/30\" : \"text-black/100\"} />;"
        );
        let border =
            "const X = ({ c }) => <div sz={{ border: { color: 'red-500', op: c ? 30 : 100 } }} />;";
        assert_eq!(
            rewrite(border).expect("rewritten"),
            "const X = ({ c }) => <div className={c ? \"border-red-500/30\" : \"border-red-500/100\"} />;"
        );
    }

    #[test]
    fn rewrites_color_opacity_ternary_under_deep_variants() {
        // The lowering composes the right variant prefix at any nesting depth.
        let source =
            "const X = ({ c }) => <div sz={{ md: { hover: { bg: { color: 'black', op: c ? 30 : 100 } } } }} />;";
        assert_eq!(
            rewrite(source).expect("rewritten"),
            "const X = ({ c }) => <div className={c ? \"md:hover:bg-black/30\" : \"md:hover:bg-black/100\"} />;"
        );
    }

    #[test]
    fn rewrites_color_opacity_ternary_with_static_sibling_prop() {
        // A static sibling prop stays in the base class; only the color-opacity
        // ternary becomes the conditional segment.
        let source =
            "const X = ({ c }) => <div sz={{ p: 4, bg: { color: 'black', op: c ? 30 : 100 } }} />;";
        assert_eq!(
            rewrite(source).expect("rewritten"),
            "const X = ({ c }) => <div className={`p-4 ${c ? \"bg-black/30\" : \"bg-black/100\"}`} />;"
        );
    }

    #[test]
    fn rewrites_conditional_spread_ternary_sz_attribute() {
        let source = "const active = { bg: 'blue-500', color: 'white' }; const inactive = { bg: 'gray-100', color: 'gray-600' }; const X = ({ on }) => <div sz={{ ...(on ? active : inactive), p: 4 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const active = { bg: 'blue-500', color: 'white' }; const inactive = { bg: 'gray-100', color: 'gray-600' }; const X = ({ on }) => <div className={on ? \"bg-blue-500 text-white p-4\" : \"bg-gray-100 text-gray-600 p-4\"} />;"
        );
    }

    #[test]
    fn rewrites_function_body_local_static_ternary() {
        let source = "const X = ({ active }) => {\n  const ON = { p: 4 } as const;\n  const OFF = { p: 8 } as const;\n  return <div sz={active ? ON : OFF} />;\n};";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const X = ({ active }) => {\n  const ON = { p: 4 } as const;\n  const OFF = { p: 8 } as const;\n  return <div className={active ? \"p-4\" : \"p-8\"} />;\n};"
        );
    }

    #[test]
    fn rewrites_conditional_spread_to_runtime_helper() {
        // Mixing an identifier-backed spread with a conditional spread
        // cannot be fully resolved at compile time without enumerating
        // every reachable class set, so the rewriter punts to the runtime
        // `_sz(...)` helper with the user's exact source preserved.
        let source = "const BASE = { p: 4 } as const;\nconst X = ({ big }) => <div sz={{ ...BASE, ...(big ? { p: 8 } : {}) }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const BASE = { p: 4 } as const;\nconst X = ({ big }) => <div className={_sz({ ...BASE, ...(big ? { p: 8 } : {}) })} />;"
        );
    }

    #[test]
    fn rewrites_dynamic_identifier_to_runtime_helper() {
        let source = "const X = ({ styles }) => <div sz={styles} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const X = ({ styles }) => <div className={_sz(styles)} />;"
        );
    }

    #[test]
    fn rewrites_conditional_spread_ternary_with_static_classname_to_merge_helper() {
        let source = "const X = ({ big }) => <div className=\"existing\" sz={{ ...(big ? { p: 8 } : {}) }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const X = ({ big }) => <div className={_szMerge(\"existing\", big ? \"p-8\" : \"\")} />;"
        );
    }

    #[test]
    fn rewrites_runtime_fallback_with_static_class_to_merge_helper() {
        let source = "const X = ({ styles }) => <div class=\"existing\" sz={styles} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const X = ({ styles }) => <div className={_szMerge(\"existing\", _sz(styles))} />;"
        );
    }

    #[test]
    fn rewrites_conditional_array_objects_to_static_merge_arguments() {
        let source =
            "const base = { p: 4 }; const App = ({ active }) => <div sz={[base, active && { m: 2 }]} />;";
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        };
        let parsed = parse_source_shell(&file);

        let rewritten =
            rewrite_static_sz_attributes(source, &file.filename, &parsed.ir).expect("rewrite");

        assert_eq!(
            rewritten,
            "const base = { p: 4 }; const App = ({ active }) => <div className={_szcn(\"p-4\", active && \"m-2\")} />;"
        );
    }

    #[test]
    fn rewrites_array_ternary_to_one_merge_argument() {
        let source =
            "const App = ({ active }) => <div sz={[active ? { p: 2 } : { p: 4 }, { m: 1 }]} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const App = ({ active }) => <div className={_szcn(active ? \"p-2\" : \"p-4\", \"m-1\")} />;"
        );
    }

    #[test]
    fn rewrites_each_dynamic_css_var_category() {
        let source = "const App = ({ color, angle, milliseconds, value }) => <div sz={{ bg: color, rotate: angle, duration: milliseconds, opacity: value }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert!(rewritten.contains("\"--_sz-bg\": __szColorVar(color)"));
        assert!(rewritten.contains("\"--_sz-rotate\": __szUnitVar(angle, \"deg\", \"rotate\")"));
        assert!(rewritten
            .contains("\"--_sz-duration\": __szUnitVar(milliseconds, \"ms\", \"duration\")"));
        assert!(rewritten.contains("\"--_sz-opacity\": value"));
    }

    #[test]
    fn rejects_multiple_runtime_expression_attributes() {
        for source in [
            "const App=({ a, b }) => <div sz={a ? { p: 2 } : { p: 4 }} sz={b ? { m: 2 } : { m: 4 }} />;",
            "const App=({ a, b }) => <div sz={a} sz={b} />;",
        ] {
            assert_eq!(
                rewrite(source),
                Err(StaticRewriteUnsupported::EmptyClassList),
                "{source}"
            );
        }
    }

    #[test]
    fn rewrites_runtime_fallback_with_dynamic_classname_to_merge_helper() {
        let source = "const X = ({ styles }) => <div className={getClass()} sz={styles} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const X = ({ styles }) => <div className={_szMerge(getClass(), _sz(styles))} />;"
        );
    }

    #[test]
    fn rewrites_static_ternary_with_classname_to_merge_helper() {
        let source = "const X = ({ active }) => <div className=\"existing\" sz={active ? { p: 4 } : { p: 8 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const X = ({ active }) => <div className={_szMerge(\"existing\", active ? \"p-4\" : \"p-8\")} />;"
        );
    }

    #[test]
    fn rejects_empty_class_list() {
        let source = "export const App = () => <div sz={{ bg: 'red-500/50' }} />;";

        assert_eq!(
            rewrite(source),
            Err(StaticRewriteUnsupported::EmptyClassList)
        );
    }
}
