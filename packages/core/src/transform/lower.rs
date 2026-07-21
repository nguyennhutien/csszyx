//! Static csszyx IR lowering.
//!
//! This module converts parser-neutral static sz IR into ordered class names.
//! It is kept separate from rewrite so class-generation parity can be tested
//! before any source mutation ships.

use std::borrow::Cow;

use super::{
    generated::tables::{
        boolean_class, is_aria_state, is_known_variant, is_removed_boolean_sugar, property_prefix,
        variant_prefix,
    },
    SourceIr, StaticSzObject, StaticSzValue,
};

/// Class data lowered from parser-neutral source IR.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoweredSourceClasses {
    /// Generated csszyx/Tailwind classes from static `sz` attributes.
    pub classes: Vec<String>,
    /// Static class/className strings discovered in source order.
    pub raw_class_names: Vec<String>,
}

/// Lower parser-neutral source IR into class lists without rewriting source.
pub fn lower_source_ir_classes(ir: &SourceIr) -> LoweredSourceClasses {
    // szs classes join AFTER every sz-derived class so the discovery order
    // (which fixes production mangle IDs) matches the other engines.
    let classes = ir
        .extracted_classes
        .iter()
        .cloned()
        .chain(ir.sz_attributes.iter().flat_map(lower_sz_attribute_classes))
        .chain(ir.szs_attributes.iter().flat_map(|attribute| {
            attribute.entries.iter().flat_map(|entry| {
                entry
                    .class_name
                    .split_whitespace()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            })
        }))
        .collect();
    // Split each static class attribute into individual class tokens, matching
    // the oxc path: consumers (safelist, mangle) iterate raw_class_names as
    // single classes, so a whole `"flex gap-2"` string would be treated as one
    // bogus class on the default rust parser.
    let raw_class_names = ir
        .class_attributes
        .iter()
        .filter(|attr| attr.expression_span.is_none())
        .flat_map(|attr| attr.value.split_whitespace().map(ToString::to_string))
        .collect();

    LoweredSourceClasses {
        classes,
        raw_class_names,
    }
}

/// Lower one static `sz` attribute into classes.
///
/// For a ternary `sz={cond ? A : B}` attribute both branches contribute to the
/// reported class list so `result.classes` matches what oxc-JS reports today
/// (both possible runtime outcomes flow back as static knowledge for the
/// className manifest). The rewrite layer keeps the two branches separate
/// when it emits source.
pub fn lower_sz_attribute_classes(attribute: &super::SzAttributeIr) -> Vec<String> {
    let mut classes = attribute
        .literal_class_name
        .as_deref()
        .into_iter()
        .flat_map(str::split_whitespace)
        .filter(|class_name| !class_name.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    classes.extend(lower_static_sz_object(&attribute.object));
    classes.extend(attribute.candidate_classes.iter().cloned());
    classes.extend(attribute.array_parts.iter().flat_map(|part| {
        // Element order: a static part contributes its classes, a dynamic part
        // its safelist candidates — mangle IDs follow discovery order.
        part.classes
            .iter()
            .chain(part.ternary.iter().flat_map(|ternary| {
                ternary
                    .consequent_classes
                    .iter()
                    .chain(ternary.alternate_classes.iter())
            }))
            .chain(part.candidates.iter())
            .cloned()
    }));
    classes.extend(
        attribute
            .dynamic_css_vars
            .iter()
            .filter(|prop| !prop.skip_class)
            .map(dynamic_css_var_class),
    );
    for ternary in &attribute.ternaries {
        classes.extend(ternary.consequent_classes.iter().cloned());
        classes.extend(ternary.alternate_classes.iter().cloned());
    }
    classes
}

/// Build the Tailwind CSS-variable utility for one dynamic property.
pub(super) fn dynamic_css_var_class(prop: &super::DynamicCssVarIr) -> String {
    let variant = prop
        .variant_prefix
        .as_ref()
        .map_or_else(String::new, |prefix| format!("{prefix}:"));
    format!("{variant}{}-({})", prop.class_prefix, prop.var_name)
}

/// Lower a static sz object into Tailwind/csszyx class names in source order.
pub fn lower_static_sz_object(object: &StaticSzObject) -> Vec<String> {
    let mut classes = Vec::with_capacity(object.properties.len());
    lower_object_into(object, "", &mut classes);
    merge_text_size_and_leading(classes)
}

/// Whether a key is a recognized sz property or variant, mirroring the JS
/// `isKnown` check in transform-core so the native engine warns on the same set
/// of typo'd keys as the oxc/Babel engines. Generous by construction — a key is
/// "known" if ANY table or special form claims it (`property_prefix` already
/// covers the many special-cased keys like `content`/`display`/`snapAlign`), so
/// a valid key is never flagged as unknown.
#[cfg(any(feature = "native-engine", test))]
pub(crate) fn is_known_sz_key(key: &str) -> bool {
    property_prefix(key).is_some()
        || boolean_class(key).is_some()
        // Flag-only utilities (truncate, blur, grayscale, invert, sepia,
        // backdrop*) carry no value, so they are absent from `boolean_class`'s
        // emit table (which only lists shorthands whose class name differs from
        // the key). The `Boolean(true)` emit path falls back to the key itself
        // for them, so they DO produce a class — the known-key check must agree,
        // or rust warns "Unknown property … will be ignored" for a class it
        // actually emits, diverging from the JS engines (whose BOOLEAN_SHORTHANDS
        // set includes them and never warns).
        // Fully-qualified rather than imported: this is the ONLY caller, and it
        // is gated behind `#[cfg(any(feature = "native-engine", test))]`. A plain
        // `use` would read as unused under the default feature set, and a
        // `cargo clippy --fix` pass (e.g. the pre-commit hook) would delete the
        // import, breaking the native build. Referencing it inline keeps the
        // symbol tied to its single cfg-gated use.
        || super::generated::tables::is_boolean_shorthand(key)
        || super::generated::tables::is_known_special_property(key)
        || is_removed_boolean_sugar(key)
        || is_known_variant(key)
        || is_aria_state(key)
        || variant_prefix(key).is_some()
        || is_special_cased_property(key)
        || key.starts_with("--")
        || key.starts_with('[')
        || key.starts_with('@')
        || matches!(
            key,
            "min"
                | "max"
                | "fromPos"
                | "viaPos"
                | "toPos"
                | "group"
                | "peer"
                | "has"
                | "not"
                | "data"
                | "aria"
                | "supports"
        )
}

/// Keys that `format_static_class` handles by a dedicated branch WITHOUT a
/// `property_prefix` table entry (they map to a fixed Tailwind utility, e.g.
/// `alignContent` -> `content-*`). They are valid sz keys, so `is_known_sz_key`
/// must not flag them as typos. Kept beside the format_static_class branches
/// that own them; the engine parity test (rust warn-set == oxc warn-set) gates
/// any drift if a new such branch is added without updating this list.
#[cfg(any(feature = "native-engine", test))]
fn is_special_cased_property(key: &str) -> bool {
    matches!(
        key,
        "alignContent"
            | "backgroundRepeat"
            | "listStyle"
            | "maskComposite"
            | "maskMode"
            | "maskType"
            | "ordinal"
            | "snapStrictness"
    )
}

/// Collect the keys of unrecognized sz properties (likely typos) as
/// `(key, byte_offset)` pairs. Walks nested SIMPLE-variant objects the same way
/// the lowering does, but does NOT descend into parametric variants
/// (`data`/`aria`/`group`/`peer`/`has`/`not`/`supports`), `css`, `bgImg`, or
/// color-with-opacity objects — their members are parameters/values, not sz
/// properties, so checking them would falsely warn (matches the oxc/Babel walk).
#[cfg(any(feature = "native-engine", test))]
pub(crate) fn collect_unknown_sz_keys(object: &StaticSzObject, out: &mut Vec<(String, u32)>) {
    for property in &object.properties {
        if !is_known_sz_key(&property.key) {
            out.push((property.key.clone(), property.span.start));
            continue;
        }
        if let StaticSzValue::Object(nested) = &property.value {
            if matches!(
                property.key.as_str(),
                "css" | "bgImg" | "supports" | "data" | "not" | "aria" | "has" | "group" | "peer"
            ) {
                continue;
            }
            if property_prefix(&property.key).is_some()
                && object_string_property(nested, "color").is_some()
            {
                continue;
            }
            collect_unknown_sz_keys(nested, out);
        }
    }
}

/// Collects spacing-scale properties whose numeric value is not a quarter
/// step — Tailwind's bare spacing syntax only accepts multiples of 0.25, so
/// `p-1.4` generates no CSS, and a unitless bracket is no escape (`padding:
/// 1.4` is invalid CSS). Same descent rules as `collect_unknown_sz_keys`;
/// `leading` is excluded because it falls back to the unitless-ratio bracket.
#[cfg(feature = "native-engine")]
pub(crate) fn collect_dead_spacing_steps(
    object: &StaticSzObject,
    out: &mut Vec<(String, f64, u32)>,
) {
    for property in &object.properties {
        match &property.value {
            StaticSzValue::Number(value) => {
                if is_dead_spacing_step(&property.key, *value) {
                    out.push((property.key.clone(), *value, property.span.start));
                }
            }
            StaticSzValue::String(value) => {
                let unsigned = value.strip_prefix('-').unwrap_or(value);
                if is_unsigned_decimal(unsigned) {
                    if let Ok(parsed) = value.parse::<f64>() {
                        if is_dead_spacing_step(&property.key, parsed) {
                            out.push((property.key.clone(), parsed, property.span.start));
                        }
                    }
                }
            }
            StaticSzValue::Object(nested) => {
                if matches!(
                    property.key.as_str(),
                    "css"
                        | "bgImg"
                        | "supports"
                        | "data"
                        | "not"
                        | "aria"
                        | "has"
                        | "group"
                        | "peer"
                ) {
                    continue;
                }
                if property_prefix(&property.key).is_some()
                    && object_string_property(nested, "color").is_some()
                {
                    continue;
                }
                collect_dead_spacing_steps(nested, out);
            }
            StaticSzValue::Boolean(_) => {}
        }
    }
}

/// Collects PROPERTY keys whose value is an object that is not the
/// `{ color, op }` form. The lowering falls through to variant handling and
/// emits classes like `p:bg-red-500` — `p:` matches no Tailwind variant, so
/// the styles silently generate no CSS. Reports the first nested keys so the
/// diagnostic can echo the stray shape; descends like the lowering does.
#[cfg(feature = "native-engine")]
pub(crate) fn collect_property_object_values(
    object: &StaticSzObject,
    out: &mut Vec<(String, String, u32)>,
) {
    for property in &object.properties {
        let StaticSzValue::Object(nested) = &property.value else {
            continue;
        };
        // Parametric/scope variants and object-shaped value keys take nested
        // objects legitimately.
        if matches!(
            property.key.as_str(),
            "css" | "bgImg" | "supports" | "data" | "not" | "aria" | "has" | "group" | "peer"
        ) {
            continue;
        }
        // The `{ color, op }` object form on a property key is the documented
        // color-opacity spelling.
        if property_prefix(&property.key).is_some()
            && object_string_property(nested, "color").is_some()
        {
            continue;
        }
        if property_prefix(&property.key).is_some()
            && !super::generated::tables::is_known_variant(&property.key)
        {
            let nested_keys = nested
                .properties
                .iter()
                .take(3)
                .map(|p| p.key.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            out.push((property.key.clone(), nested_keys, property.span.start));
            continue;
        }
        collect_property_object_values(nested, out);
    }
}

/// Whether a bare numeric value on a spacing-scale key has no Tailwind class.
#[cfg(feature = "native-engine")]
fn is_dead_spacing_step(key: &str, value: f64) -> bool {
    (value * 4.0).fract() != 0.0
        && matches!(
            super::parser::dynamic_css_var_category(key),
            super::ir::DynamicCssVarCategory::Spacing
        )
}

fn merge_text_size_and_leading(mut classes: Vec<String>) -> Vec<String> {
    let mut consumed = vec![false; classes.len()];

    for text_index in 0..classes.len() {
        let Some((text_prefix, text_size)) = text_size_class_parts(&classes[text_index]) else {
            continue;
        };
        for leading_index in 0..classes.len() {
            if consumed[leading_index] || leading_index == text_index {
                continue;
            }
            let Some((leading_prefix, leading_value)) =
                leading_class_parts(&classes[leading_index])
            else {
                continue;
            };
            if text_prefix != leading_prefix {
                continue;
            }
            classes[text_index] = format!("{text_prefix}text-{text_size}/{leading_value}");
            consumed[leading_index] = true;
            break;
        }
    }

    classes
        .into_iter()
        .enumerate()
        .filter_map(|(index, class_name)| (!consumed[index]).then_some(class_name))
        .collect()
}

fn text_size_class_parts(class_name: &str) -> Option<(&str, &str)> {
    let (prefix, base) = split_variant_prefix(class_name);
    let size = base.strip_prefix("text-")?;
    let known_size = matches!(
        size,
        "xs" | "sm"
            | "base"
            | "lg"
            | "xl"
            | "2xl"
            | "3xl"
            | "4xl"
            | "5xl"
            | "6xl"
            | "7xl"
            | "8xl"
            | "9xl"
    ) || (size.starts_with('[') && size.ends_with(']'))
        || (size.starts_with('(') && size.ends_with(')'));
    known_size.then_some((prefix, size))
}

fn leading_class_parts(class_name: &str) -> Option<(&str, &str)> {
    let (prefix, base) = split_variant_prefix(class_name);
    Some((prefix, base.strip_prefix("leading-")?))
}

fn split_variant_prefix(class_name: &str) -> (&str, &str) {
    class_name
        .rfind(':')
        .map_or(("", class_name), |index| class_name.split_at(index + 1))
}

fn lower_object_into(object: &StaticSzObject, prefix: &str, classes: &mut Vec<String>) {
    for property in &object.properties {
        match &property.value {
            StaticSzValue::Object(nested) => {
                if property.key == "css" {
                    lower_css_properties(nested, prefix, classes);
                    continue;
                }

                if property.key == "bgImg" {
                    if let Some(class_name) = format_bg_img_object(nested, prefix) {
                        classes.push(class_name);
                    }
                    continue;
                }

                // Color-with-opacity object — { bg: { color: 'blue-500', op: 20 } }
                // → bg-blue-500/20. Distinguished from variant nesting by a
                // `color` member on a key that maps to a color utility, matching
                // the Babel/oxc transform; without this it lowered as a nested
                // variant into broken classes like `bg:text-white` / `bg:op-20`.
                if property_prefix(&property.key).is_some()
                    && object_string_property(nested, "color").is_some()
                {
                    if let Some(class_name) =
                        format_color_opacity_object(&property.key, nested, prefix)
                    {
                        classes.push(class_name);
                    }
                    continue;
                }

                // Parametric / scope variants combine with `-` and bracket their
                // parameter rather than chaining a plain `:` like simple variants
                // do, matching the Babel/oxc transform.
                match property.key.as_str() {
                    "supports" => {
                        lower_bracket_param_variant(nested, prefix, "supports", classes);
                        continue;
                    }
                    "data" => {
                        lower_bracket_param_variant(nested, prefix, "data", classes);
                        continue;
                    }
                    "not" => {
                        lower_not_variant(nested, prefix, classes);
                        continue;
                    }
                    "aria" => {
                        lower_aria_variant(nested, prefix, classes);
                        continue;
                    }
                    "has" => {
                        lower_has_variant(nested, prefix, classes);
                        continue;
                    }
                    "group" => {
                        lower_group_peer_variant("group", nested, prefix, classes);
                        continue;
                    }
                    "peer" => {
                        lower_group_peer_variant("peer", nested, prefix, classes);
                        continue;
                    }
                    _ => {}
                }

                let variant = variant_prefix(&property.key).unwrap_or(&property.key);
                let mut next_prefix = String::with_capacity(prefix.len() + property.key.len() + 1);
                next_prefix.push_str(prefix);
                next_prefix.push_str(variant);
                next_prefix.push(':');
                lower_object_into(nested, &next_prefix, classes);
            }
            value => {
                if let Some(class_name) = format_static_class(&property.key, value, prefix) {
                    classes.push(class_name);
                }
            }
        }
    }
}

fn lower_css_properties(object: &StaticSzObject, prefix: &str, classes: &mut Vec<String>) {
    for property in &object.properties {
        let value = match &property.value {
            StaticSzValue::String(value) => value.clone(),
            StaticSzValue::Number(value) => format_abs_number(*value),
            StaticSzValue::Boolean(value) => value.to_string(),
            StaticSzValue::Object(_) => continue,
        };
        classes.push(format!(
            "{prefix}[{}:{}]",
            kebab_case(&property.key),
            normalize_arbitrary_value(&value)
        ));
    }
}

/// Lowers a parametric bracket variant such as `supports`/`data`:
/// `{ supports: { 'display:grid': {...} } }` → `supports-[display:grid]:…`,
/// `{ data: { active: {...} } }` → `data-[active]:…`.
fn lower_bracket_param_variant(
    object: &StaticSzObject,
    prefix: &str,
    name: &str,
    classes: &mut Vec<String>,
) {
    for property in &object.properties {
        if let StaticSzValue::Object(body) = &property.value {
            let next_prefix = format!("{prefix}{name}-[{}]:", property.key);
            lower_object_into(body, &next_prefix, classes);
        }
    }
}

/// Lowers the `not` variant: `{ not: { first: {...} } }` → `not-first:…`, with a
/// nested supports condition bracketed
/// (`{ not: { supports: { 'x': {...} } } }` → `not-supports-[x]:…`).
fn lower_not_variant(object: &StaticSzObject, prefix: &str, classes: &mut Vec<String>) {
    for property in &object.properties {
        let StaticSzValue::Object(body) = &property.value else {
            continue;
        };
        if property.key == "supports" {
            for condition in &body.properties {
                if let StaticSzValue::Object(inner) = &condition.value {
                    let next_prefix = format!("{prefix}not-supports-[{}]:", condition.key);
                    lower_object_into(inner, &next_prefix, classes);
                }
            }
        } else {
            let variant = get_variant_prefix(&property.key);
            let next_prefix = format!("{prefix}not-{variant}:");
            lower_object_into(body, &next_prefix, classes);
        }
    }
}

/// Resolves a variant key to its emitted prefix (VARIANT_MAP entry or
/// kebab-case fallback), mirroring the oxc `getVariantPrefix`.
fn get_variant_prefix(key: &str) -> Cow<'static, str> {
    variant_prefix(key).map_or_else(|| Cow::Owned(kebab_case(key)), Cow::Borrowed)
}

/// Lowers the `aria` variant: `{ aria: { checked: {...} } }` → `aria-checked:…`
/// for standard states, `{ aria: { 'busy=true': {...} } }` → `aria-[busy=true]:…`
/// otherwise.
fn lower_aria_variant(object: &StaticSzObject, prefix: &str, classes: &mut Vec<String>) {
    for property in &object.properties {
        if let StaticSzValue::Object(body) = &property.value {
            let next_prefix = if is_aria_state(&property.key) {
                format!("{prefix}aria-{}:", property.key)
            } else {
                format!("{prefix}aria-[{}]:", property.key)
            };
            lower_object_into(body, &next_prefix, classes);
        }
    }
}

/// Lowers the `has` variant: `{ has: { checked: {...} } }` → `has-[:checked]:…`
/// for states, `{ has: { img: {...} } }` → `has-[img]:…` for raw selectors.
fn lower_has_variant(object: &StaticSzObject, prefix: &str, classes: &mut Vec<String>) {
    for property in &object.properties {
        if let StaticSzValue::Object(body) = &property.value {
            let selector = property.key.as_str();
            let next_prefix = if selector.starts_with(':') {
                format!("{prefix}has-[{selector}]:")
            } else if is_known_variant(selector) {
                format!("{prefix}has-[:{selector}]:")
            } else {
                format!("{prefix}has-[{selector}]:")
            };
            lower_object_into(body, &next_prefix, classes);
        }
    }
}

/// Lowers the `group`/`peer` scope variants, mirroring the oxc `handleGroupPeer`:
/// known variants combine with `-` (group-hover), has/data/aria nest as
/// parameters, arbitrary selectors bracket, and a named scope appends `/name`.
fn lower_group_peer_variant(
    scope: &str,
    object: &StaticSzObject,
    prefix: &str,
    classes: &mut Vec<String>,
) {
    for property in &object.properties {
        let StaticSzValue::Object(nested) = &property.value else {
            continue;
        };
        let nested_key = property.key.as_str();

        match nested_key {
            "has" => {
                for selector in &nested.properties {
                    if let StaticSzValue::Object(body) = &selector.value {
                        let np = format!("{prefix}{scope}-has-[{}]:", selector.key);
                        lower_object_into(body, &np, classes);
                    }
                }
                continue;
            }
            "data" => {
                for attr in &nested.properties {
                    if let StaticSzValue::Object(body) = &attr.value {
                        let np = format!("{prefix}{scope}-data-[{}]:", attr.key);
                        lower_object_into(body, &np, classes);
                    }
                }
                continue;
            }
            "aria" => {
                for attr in &nested.properties {
                    if let StaticSzValue::Object(body) = &attr.value {
                        let np = if is_aria_state(&attr.key) {
                            format!("{prefix}{scope}-aria-{}:", attr.key)
                        } else {
                            format!("{prefix}{scope}-aria-[{}]:", attr.key)
                        };
                        lower_object_into(body, &np, classes);
                    }
                }
                continue;
            }
            _ => {}
        }

        if nested_key.starts_with('.')
            || nested_key.starts_with('#')
            || nested_key.starts_with('[')
            || nested_key.starts_with(':')
        {
            let np = format!("{prefix}{scope}-[{nested_key}]:");
            lower_object_into(nested, &np, classes);
            continue;
        }

        if is_known_variant(nested_key) || is_known_variant(get_variant_prefix(nested_key).as_ref())
        {
            let mapped = get_variant_prefix(nested_key);
            let np = format!("{prefix}{scope}-{mapped}:");
            lower_object_into(nested, &np, classes);
            continue;
        }

        // Named scope: { group: { name: { hover: {...} } } } → group-hover/name:
        for state in &nested.properties {
            let StaticSzValue::Object(state_body) = &state.value else {
                continue;
            };
            match state.key.as_str() {
                "data" => {
                    for attr in &state_body.properties {
                        if let StaticSzValue::Object(body) = &attr.value {
                            let np = format!("{prefix}{scope}-data-[{}]/{nested_key}:", attr.key);
                            lower_object_into(body, &np, classes);
                        }
                    }
                }
                "aria" => {
                    for attr in &state_body.properties {
                        if let StaticSzValue::Object(body) = &attr.value {
                            let aria_segment = if is_aria_state(&attr.key) {
                                format!("aria-{}", attr.key)
                            } else {
                                format!("aria-[{}]", attr.key)
                            };
                            let np = format!("{prefix}{scope}-{aria_segment}/{nested_key}:");
                            lower_object_into(body, &np, classes);
                        }
                    }
                }
                _ => {
                    let mapped = get_variant_prefix(&state.key);
                    let np = format!("{prefix}{scope}-{mapped}/{nested_key}:");
                    lower_object_into(state_body, &np, classes);
                }
            }
        }
    }
}

#[allow(clippy::too_many_lines)]
fn format_static_class(key: &str, value: &StaticSzValue, prefix: &str) -> Option<String> {
    if key == "animationDelay" {
        let ms = match value {
            StaticSzValue::Number(num) => format!("{}ms", format_abs_number(*num)),
            StaticSzValue::String(s) => s.clone(),
            _ => return None,
        };
        return Some(format!("{prefix}[animation-delay:{ms}]"));
    }

    // A purely numeric key can never be a CSS property or Tailwind utility —
    // it is almost always a numeric lookup table (`{ 50: 100 }`) swallowed by
    // extraction, and the fallback below would mint garbage classes like
    // `50-100` straight into the safelist. Emit nothing (matches the JS core).
    if property_prefix(key).is_none() && key.parse::<f64>().is_ok() {
        return None;
    }

    // Unknown keys fall back to a kebab-cased utility name (breakWord →
    // break-word) the way the oxc path does, instead of the raw camelCase key.
    let class_key: Cow<str> =
        property_prefix(key).map_or_else(|| Cow::Owned(kebab_case(key)), Cow::Borrowed);

    match value {
        // Removed boolean-sugar aliases (flex/absolute/italic/...): emit nothing.
        // The canonical key with a value is the only spelling now. Guarded on the
        // `true` form so the flex shorthand (`flex: 1`, handled below) is untouched.
        StaticSzValue::Boolean(true) if is_removed_boolean_sugar(key) => None,
        StaticSzValue::Boolean(true) => Some(format!(
            "{prefix}{}",
            boolean_class(key).unwrap_or_else(|| class_key.as_ref())
        )),
        StaticSzValue::Boolean(false) | StaticSzValue::Object(_) => None,
        StaticSzValue::Number(value) => {
            // Gradient color-stop positions render as a bare percent: from-50%.
            if let Some(grad) = gradient_stop_prefix(key) {
                return Some(format!("{prefix}{grad}-{}%", format_abs_number(*value)));
            }
            // leading numbers ride the spacing scale like Tailwind's bare
            // syntax; non-quarter-step values (1.4) have no bare spelling —
            // Tailwind drops leading-1.4 — so they bracket as the unitless
            // ratio instead of emitting a dead class. Mirrors the oxc lane.
            if (key == "leading" || key == "lineHeight") && (value * 4.0).fract() != 0.0 {
                return Some(format!("{prefix}leading-[{}]", format_abs_number(*value)));
            }
            Some(format_number_class(class_key.as_ref(), *value, prefix))
        }
        StaticSzValue::String(value) => {
            // leading numeric STRINGS are the unitless line-height ratio and
            // auto-bracket (leading: '1.5' → leading-[1.5]); bare numbers ride
            // the spacing scale. Mirrors the oxc lane.
            if (key == "leading" || key == "lineHeight") && is_unsigned_decimal(value) {
                return Some(format!("{prefix}leading-[{value}]"));
            }
            if key == "bgImg" {
                return Some(format_bg_img_string(value, prefix));
            }
            if key == "bgSize" {
                return Some(format_bg_size(value, prefix));
            }
            if key == "bgRepeat" || key == "backgroundRepeat" {
                return Some(format_bg_repeat(value, prefix));
            }
            if key == "content" {
                return Some(format_content(value, prefix));
            }
            // display / position / visibility carry their value as the bare
            // Tailwind utility (`flex`, `grid`, `absolute`, `visible`), not a
            // `display-flex` style prefix-value pair. This mirrors the Babel/oxc
            // transform so both parser paths emit classes Tailwind actually
            // generates.
            if key == "display" {
                return Some(if value == "none" {
                    format!("{prefix}hidden")
                } else {
                    format!("{prefix}{value}")
                });
            }
            if key == "position" {
                return Some(format!("{prefix}{value}"));
            }
            if key == "visibility" {
                return Some(if value == "hidden" {
                    format!("{prefix}invisible")
                } else {
                    format!("{prefix}{value}")
                });
            }
            if key == "isolation" {
                return Some(if value == "isolate" {
                    format!("{prefix}isolate")
                } else {
                    format!("{prefix}isolation-{value}")
                });
            }
            // Single-property typography utilities carry their value as a bare
            // Tailwind class (`uppercase`, `italic`, `underline`, `antialiased`),
            // mirroring the Babel/oxc transform. The boolean-sugar aliases were
            // removed, so these canonical string forms are the only spelling.
            if key == "textTransform" {
                return Some(match value.as_str() {
                    "none" | "normal-case" => format!("{prefix}normal-case"),
                    "uppercase" | "lowercase" | "capitalize" => format!("{prefix}{value}"),
                    _ => return None,
                });
            }
            if key == "fontStyle" {
                return Some(match value.as_str() {
                    "italic" => format!("{prefix}italic"),
                    "normal" => format!("{prefix}not-italic"),
                    _ => return None,
                });
            }
            if key == "fontSmoothing" {
                return Some(match value.as_str() {
                    "grayscale" => format!("{prefix}antialiased"),
                    "subpixel" => format!("{prefix}subpixel-antialiased"),
                    _ => return None,
                });
            }
            if key == "decoration" {
                return Some(match value.as_str() {
                    "none" => format!("{prefix}no-underline"),
                    "underline" | "overline" | "line-through" | "no-underline" => {
                        format!("{prefix}{value}")
                    }
                    _ => return None,
                });
            }
            // listStyleType: standard keywords stay bare (list-disc), CSS vars use
            // the paren form, everything else is arbitrary (list-[upper-roman]).
            if key == "list" || key == "listStyle" {
                return Some(if value.starts_with("--") {
                    format!("{prefix}list-({value})")
                } else if matches!(value.as_str(), "none" | "disc" | "decimal") {
                    format!("{prefix}list-{value}")
                } else {
                    format!("{prefix}list-[{value}]")
                });
            }
            // alignContent maps onto Tailwind's content-* utilities (content-center,
            // content-between). Kept distinct from the `content` CSS property above.
            if key == "alignContent" {
                return Some(format!("{prefix}content-{value}"));
            }
            // mask-* sub-properties collapse the sub-axis: maskPos: 'center' is
            // mask-center, not mask-position-center.
            if matches!(
                key,
                "maskPos" | "maskSize" | "maskShape" | "maskComposite" | "maskMode"
            ) {
                return Some(format!("{prefix}mask-{value}"));
            }
            if key == "maskType" {
                return Some(format!("{prefix}mask-type-{value}"));
            }
            if key == "maskRepeat" {
                return Some(match value.as_str() {
                    "repeat" => format!("{prefix}mask-repeat"),
                    "no-repeat" => format!("{prefix}mask-no-repeat"),
                    _ => format!("{prefix}mask-{value}"),
                });
            }
            // font-variant-numeric values are emitted bare (normal-nums, tabular-nums).
            if key == "fontVariant"
                && matches!(
                    value.as_str(),
                    "normal-nums"
                        | "ordinal"
                        | "slashed-zero"
                        | "lining-nums"
                        | "oldstyle-nums"
                        | "proportional-nums"
                        | "tabular-nums"
                        | "diagonal-fractions"
                        | "stacked-fractions"
                )
            {
                return Some(format!("{prefix}{value}"));
            }
            // scroll-snap direct maps: the sub-axis is dropped (snap-mandatory,
            // snap-center), except snap-align-none which keeps the axis.
            if key == "snapAlign" {
                return match value.as_str() {
                    "start" => Some(format!("{prefix}snap-start")),
                    "end" => Some(format!("{prefix}snap-end")),
                    "center" => Some(format!("{prefix}snap-center")),
                    "none" => Some(format!("{prefix}snap-align-none")),
                    _ => None,
                };
            }
            if key == "snapStrictness" {
                return match value.as_str() {
                    "mandatory" => Some(format!("{prefix}snap-mandatory")),
                    "proximity" => Some(format!("{prefix}snap-proximity")),
                    _ => None,
                };
            }
            if key == "snapStop" {
                return match value.as_str() {
                    "normal" => Some(format!("{prefix}snap-normal")),
                    "always" => Some(format!("{prefix}snap-always")),
                    _ => None,
                };
            }
            if key == "snapType" {
                return match value.as_str() {
                    "none" => Some(format!("{prefix}snap-none")),
                    "x" => Some(format!("{prefix}snap-x")),
                    "y" => Some(format!("{prefix}snap-y")),
                    "both" => Some(format!("{prefix}snap-both")),
                    _ => None,
                };
            }
            // Named container: { '@container': 'sidebar' } → @container/sidebar.
            if key == "@container" {
                return Some(format!("{prefix}@container/{value}"));
            }
            // Named scope markers: { group: 'item' } → group/item, mirroring
            // the oxc `collectUnresolvedStringProperty` branch.
            if key == "group" || key == "peer" {
                return Some(format!("{prefix}{key}/{value}"));
            }
            // Gradient color-stop positions reuse the from/via/to prefix. CSS vars
            // use the paren form, bare integer percents stay bare, the rest bracket.
            if let Some(grad) = gradient_stop_prefix(key) {
                return Some(if value.starts_with("--") {
                    format!("{prefix}{grad}-({value})")
                } else if is_integer_percent(value) {
                    format!("{prefix}{grad}-{value}")
                } else {
                    format!("{prefix}{grad}-[{value}]")
                });
            }
            // font-stretch: named keywords use the font- prefix (font-condensed),
            // integer percents stay bare (font-stretch-50%), decimals bracket.
            if key == "fontStretch" {
                return Some(format!("{prefix}{}", format_font_stretch(value)));
            }
            // Filter functions take a unit-bearing numeric whose string form is
            // always arbitrary (brightness-[1.25]); scale: '3d' is the one keyword.
            if matches!(
                key,
                "brightness"
                    | "contrast"
                    | "saturate"
                    | "scale"
                    | "backdropBrightness"
                    | "backdropContrast"
                    | "backdropSaturate"
            ) {
                if value == "3d" && key == "scale" {
                    return Some(format!("{prefix}scale-3d"));
                }
                return Some(if value.starts_with("--") {
                    format!("{prefix}{class_key}-({value})")
                } else {
                    format!("{prefix}{class_key}-[{value}]")
                });
            }
            // Composite/function values (origin, ease, animate, filter, drop-shadow)
            // are arbitrary whenever they carry a function, underscore, percent, or a
            // unit/space that needs brackets.
            if matches!(
                key,
                "origin" | "ease" | "animate" | "filter" | "backdropFilter" | "dropShadow"
            ) && (needs_brackets(value)
                || value.contains('(')
                || value.contains('_')
                || value.contains('%'))
            {
                return Some(format!(
                    "{prefix}{class_key}-[{}]",
                    normalize_arbitrary_value(value)
                ));
            }
            // perspective-origin: named keywords stay bare, the rest are arbitrary
            // (perspective-origin-[25%_25%]).
            if key == "perspectiveOrigin" {
                return Some(
                    if matches!(
                        value.as_str(),
                        "center"
                            | "top"
                            | "right"
                            | "bottom"
                            | "left"
                            | "top-left"
                            | "top-right"
                            | "bottom-left"
                            | "bottom-right"
                    ) {
                        format!("{prefix}perspective-origin-{value}")
                    } else {
                        format!(
                            "{prefix}perspective-origin-[{}]",
                            normalize_arbitrary_value(value)
                        )
                    },
                );
            }
            // transformStyle: 'flat' | '3d' → transform-flat, transform-3d.
            if key == "transformStyle" {
                return Some(format!("{prefix}transform-{value}"));
            }

            // Bare numeric fractions (1/2, 3/4) are sizing values, not the
            // `color/op` slash strings the guard below suppresses. Fraction-
            // friendly properties keep them native (w-1/2, basis-1/3); the rest
            // wrap them as arbitrary (p-[1/2]). Mirrors the Babel/oxc transform.
            if is_bare_fraction(value) {
                return Some(if is_fraction_supported_prop(key) {
                    format!("{prefix}{class_key}-{value}")
                } else {
                    format!("{prefix}{class_key}-[{value}]")
                });
            }

            if has_slash_opacity(value) {
                return None;
            }

            if is_tailwind_build_function(value) {
                return Some(format!(
                    "{prefix}{class_key}-[{}]",
                    normalize_arbitrary_value(value)
                ));
            }

            if value.starts_with("--") && value.contains('(') {
                return Some(format!(
                    "{prefix}{class_key}-[{}]",
                    normalize_arbitrary_value(value)
                ));
            }

            if value.starts_with("--") {
                return Some(css_var_type_hint(key).map_or_else(
                    || format!("{prefix}{class_key}-({value})"),
                    |type_hint| format!("{prefix}{class_key}-({type_hint}:{value})"),
                ));
            }

            // Bracket the whole value (sign included) when it needs arbitrary
            // syntax, then hoist a surviving leading `-` to the utility prefix.
            // A negative length stays inside the bracket (top-[-1px]); a bare
            // negative fraction hoists (-inset-1/2), mirroring the oxc transform.
            let final_value = if key == "aspect" && is_decimal_ratio(value) {
                format!("[{value}]")
            } else if needs_brackets(value) {
                // Tailwind arbitrary values cannot contain raw spaces (the class
                // attribute would split into separate tokens), so collapse
                // whitespace to underscores, matching the Babel/oxc transform.
                format!("[{}]", normalize_arbitrary_value(value))
            } else {
                value.clone()
            };

            Some(final_value.strip_prefix('-').map_or_else(
                || format!("{prefix}{class_key}-{final_value}"),
                |stripped| format!("{prefix}-{class_key}-{stripped}"),
            ))
        }
    }
}

/// Maps a gradient color-stop position key to its Tailwind prefix
/// (`fromPos` → `from`, `viaPos` → `via`, `toPos` → `to`).
pub(crate) fn gradient_stop_prefix(key: &str) -> Option<&'static str> {
    match key {
        "fromPos" => Some("from"),
        "viaPos" => Some("via"),
        "toPos" => Some("to"),
        _ => None,
    }
}

/// Matches a bare integer percentage such as `50%` (the `^\d+%$` form).
pub(crate) fn is_integer_percent(value: &str) -> bool {
    value
        .strip_suffix('%')
        .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

/// Matches a percentage with an optional decimal part such as `50%` or `12.5%`.
fn is_percent(value: &str) -> bool {
    let Some(num) = value.strip_suffix('%') else {
        return false;
    };
    let mut parts = num.split('.');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(int), None, None) => !int.is_empty() && int.bytes().all(|b| b.is_ascii_digit()),
        (Some(int), Some(frac), None) => {
            !int.is_empty()
                && !frac.is_empty()
                && int.bytes().all(|b| b.is_ascii_digit())
                && frac.bytes().all(|b| b.is_ascii_digit())
        }
        _ => false,
    }
}

/// Lowers `fontStretch` to its bare Tailwind class (caller prepends the variant
/// prefix): named keywords use the `font-` prefix (`font-condensed`), integer
/// percents stay bare (`font-stretch-50%`), decimals and other values arbitrary.
pub(crate) fn format_font_stretch(value: &str) -> String {
    const KEYWORDS: &[&str] = &[
        "ultra-condensed",
        "extra-condensed",
        "condensed",
        "semi-condensed",
        "normal",
        "semi-expanded",
        "expanded",
        "extra-expanded",
        "ultra-expanded",
    ];
    if KEYWORDS.contains(&value) {
        format!("font-{value}")
    } else if value.starts_with("--") {
        format!("font-stretch-({value})")
    } else if is_percent(value) {
        if value.contains('.') {
            format!("font-stretch-[{value}]")
        } else {
            format!("font-stretch-{value}")
        }
    } else {
        format!("font-stretch-[{value}]")
    }
}

fn css_var_type_hint(key: &str) -> Option<&'static str> {
    match key {
        "fontFamily" => Some("family-name"),
        "weight" => Some("weight"),
        "text" => Some("length"),
        // Shadow-family color keys: a bare `shadow-(--c)` is parsed by
        // Tailwind as the shadow VALUE (`--tw-shadow: var(--c)`), so the var
        // needs the `color:` hint to land on `--tw-*-shadow-color`.
        "shadowColor" | "insetShadowColor" | "textShadowColor" | "dropShadowColor" => Some("color"),
        _ => None,
    }
}

fn format_bg_img_object(object: &StaticSzObject, prefix: &str) -> Option<String> {
    let gradient = object_string_property(object, "gradient")?;
    let mut class_name = match gradient {
        "linear" => match object.properties.iter().find(|prop| prop.key == "dir") {
            Some(prop) => match &prop.value {
                StaticSzValue::Number(value) if *value < 0.0 => {
                    format!("-bg-linear-{}", format_abs_number(*value))
                }
                StaticSzValue::Number(value) => format!("bg-linear-{}", format_abs_number(*value)),
                StaticSzValue::String(value) if value.starts_with("--") => {
                    format!("bg-linear-({value})")
                }
                StaticSzValue::String(value) if value.starts_with("to-") => {
                    format!("bg-linear-{value}")
                }
                StaticSzValue::String(value) => {
                    format!("bg-linear-[{}]", normalize_arbitrary_value(value))
                }
                _ => return None,
            },
            None => "bg-linear-to-r".to_string(),
        },
        "radial" => match object.properties.iter().find(|prop| prop.key == "dir") {
            Some(prop) => match &prop.value {
                StaticSzValue::String(value) if value.starts_with("--") => {
                    format!("bg-radial-({value})")
                }
                StaticSzValue::String(value) => {
                    format!("bg-radial-[{}]", normalize_arbitrary_value(value))
                }
                _ => return None,
            },
            None => "bg-radial".to_string(),
        },
        "conic" => match object.properties.iter().find(|prop| prop.key == "dir") {
            Some(prop) => match &prop.value {
                StaticSzValue::Number(value) if *value < 0.0 => {
                    format!("-bg-conic-{}", format_abs_number(*value))
                }
                StaticSzValue::Number(value) => format!("bg-conic-{}", format_abs_number(*value)),
                StaticSzValue::String(value) if value.starts_with("--") => {
                    format!("bg-conic-({value})")
                }
                StaticSzValue::String(value) => {
                    format!("bg-conic-[{}]", normalize_arbitrary_value(value))
                }
                _ => return None,
            },
            None => "bg-conic".to_string(),
        },
        _ => return None,
    };

    if let Some(interpolation) = object_string_property(object, "in") {
        class_name.push('/');
        class_name.push_str(interpolation);
    }

    Some(format!("{prefix}{class_name}"))
}

fn object_string_property<'a>(object: &'a StaticSzObject, key: &str) -> Option<&'a str> {
    object
        .properties
        .iter()
        .find(|prop| prop.key == key)
        .and_then(|prop| match &prop.value {
            StaticSzValue::String(value) => Some(value.as_str()),
            _ => None,
        })
}

fn format_color_opacity_object(key: &str, object: &StaticSzObject, prefix: &str) -> Option<String> {
    let tw_prefix = property_prefix(key)?;
    let raw_color = object_string_property(object, "color")?;

    let color_base = if is_tailwind_build_function(raw_color)
        || (raw_color.starts_with("--") && raw_color.contains('('))
    {
        format!("[{}]", normalize_arbitrary_value(raw_color))
    } else if raw_color.starts_with("--") {
        // Shadow-family prefixes parse a bare `(--var)` suffix as the shadow
        // VALUE, so a var used as a color needs the `color:` hint. Mirrors
        // `buildColorObjectClass` in the Babel/oxc transform.
        if matches!(
            tw_prefix,
            "shadow" | "inset-shadow" | "text-shadow" | "drop-shadow"
        ) {
            format!("(color:{raw_color})")
        } else {
            format!("({raw_color})")
        }
    } else if needs_brackets(raw_color) {
        format!("[{}]", normalize_arbitrary_value(raw_color))
    } else {
        normalize_arbitrary_value(raw_color)
    };

    let op_value = object
        .properties
        .iter()
        .find(|prop| prop.key == "op")
        .map(|prop| &prop.value);

    match op_value {
        Some(op_value) => {
            let op_str = format_opacity_value(op_value)?;
            Some(format!("{prefix}{tw_prefix}-{color_base}/{op_str}"))
        }
        None => Some(format!("{prefix}{tw_prefix}-{color_base}")),
    }
}

fn format_opacity_value(value: &StaticSzValue) -> Option<String> {
    match value {
        // Integers and half steps (0, 0.5, 50, 75.5 …) stay plain; other
        // decimals (0.05, 0.02 …) become arbitrary `/[0.05]`. Mirrors the
        // Babel/oxc `formatOpacity`.
        StaticSzValue::Number(op) => {
            if (op * 2.0).fract() == 0.0 {
                Some(format_abs_number(*op))
            } else {
                Some(format!("[{}]", format_abs_number(*op)))
            }
        }
        StaticSzValue::String(op) if op.starts_with("--") => Some(format!("({op})")),
        StaticSzValue::String(op) => Some(format!("[{op}]")),
        _ => None,
    }
}

fn format_bg_img_string(value: &str, prefix: &str) -> String {
    let value = value.trim();
    if value == "none" {
        return format!("{prefix}bg-none");
    }

    let normalized = value.strip_prefix('-').unwrap_or(value);
    if normalized.starts_with("repeating-") {
        return format!("{prefix}bg-[{}]", normalize_arbitrary_value(value));
    }
    if normalized.starts_with("linear-")
        || normalized.starts_with("radial")
        || normalized.starts_with("conic")
        || normalized.starts_with("gradient-to-")
    {
        let mapped = normalized.replace("gradient-to-", "linear-to-");
        if value.starts_with('-') {
            return format!("{prefix}-bg-{mapped}");
        }
        return format!("{prefix}bg-{mapped}");
    }
    if value.starts_with("--") {
        return format!("{prefix}bg-(image:{value})");
    }
    if value.starts_with("url(") {
        return format!("{prefix}bg-[{value}]");
    }
    format!("{prefix}bg-[url({value})]")
}

fn format_bg_size(value: &str, prefix: &str) -> String {
    match value {
        "auto" | "cover" | "contain" => format!("{prefix}bg-{value}"),
        value if value.starts_with("--") => format!("{prefix}bg-size-({value})"),
        value => format!("{prefix}bg-size-[{}]", normalize_arbitrary_value(value)),
    }
}

fn format_bg_repeat(value: &str, prefix: &str) -> String {
    match value {
        "repeat" => format!("{prefix}bg-repeat"),
        "no-repeat" => format!("{prefix}bg-no-repeat"),
        value => {
            let suffix = value.strip_prefix("repeat-").unwrap_or(value);
            format!("{prefix}bg-repeat-{suffix}")
        }
    }
}

fn format_content(value: &str, prefix: &str) -> String {
    if value == "none" {
        return format!("{prefix}content-none");
    }
    if value.starts_with("--") {
        return format!("{prefix}content-({value})");
    }
    let inner = if value.starts_with('"') && value.ends_with('"') && value.len() >= 2 {
        format!("'{}'", &value[1..value.len() - 1])
    } else {
        value.to_string()
    };
    format!("{prefix}content-[{inner}]")
}

fn format_number_class(key: &str, value: f64, prefix: &str) -> String {
    let is_negative = value < 0.0;
    let final_value = format_abs_number(value);

    if is_negative {
        format!("{prefix}-{key}-{final_value}")
    } else {
        format!("{prefix}{key}-{final_value}")
    }
}

fn format_abs_number(value: f64) -> String {
    let abs_value = value.abs();
    if abs_value.fract() == 0.0 {
        #[allow(clippy::cast_possible_truncation)]
        (abs_value as i64).to_string()
    } else {
        abs_value.to_string()
    }
}

const CSS_UNITS: &[&str] = &[
    "px", "rem", "em", "%", "vh", "vw", "ch", "dvh", "dvw", "svh", "svw", "lvh", "lvw", "cqw",
    "cqh", "deg", "rad", "turn", "grad", "ms", "s", "fr",
];

fn has_slash_opacity(value: &str) -> bool {
    // Suppress a color/opacity slash (red-500/50, white/50) — the object form
    // `{ color, op }` is the supported spelling. A numeric ratio (4/2.5, -1/2)
    // or a function value (calc(100/5)) is a real arbitrary value, not opacity.
    if value.contains('(') || is_decimal_ratio(value) {
        return false;
    }
    value.find('/').is_some_and(|pos| {
        pos > 0
            && value
                .as_bytes()
                .get(pos - 1)
                .is_some_and(u8::is_ascii_digit)
    })
}

/// Matches a numeric ratio with optional decimals and an optional leading sign,
/// such as `4/2.5`, `16/9`, or `-1/2`.
pub(crate) fn is_decimal_ratio(value: &str) -> bool {
    let unsigned = value.strip_prefix('-').unwrap_or(value);
    let Some((num, den)) = unsigned.split_once('/') else {
        return false;
    };
    is_unsigned_decimal(num) && is_unsigned_decimal(den)
}

/// Matches a non-empty run of digits with at most one decimal point (`12`, `2.5`).
fn is_unsigned_decimal(value: &str) -> bool {
    let mut parts = value.split('.');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(int), None, None) => !int.is_empty() && int.bytes().all(|b| b.is_ascii_digit()),
        (Some(int), Some(frac), None) => {
            !int.is_empty()
                && !frac.is_empty()
                && int.bytes().all(|b| b.is_ascii_digit())
                && frac.bytes().all(|b| b.is_ascii_digit())
        }
        _ => false,
    }
}

/// Kebab-cases a camelCase key the way the oxc fallback does:
/// inserts a `-` between a lowercase/digit and an uppercase letter, then
/// lowercases (breakWord → break-word).
fn kebab_case(key: &str) -> String {
    let mut out = String::with_capacity(key.len() + 2);
    let mut prev_lower_or_digit = false;
    for ch in key.chars() {
        if ch.is_ascii_uppercase() {
            if prev_lower_or_digit {
                out.push('-');
            }
            out.push(ch.to_ascii_lowercase());
            prev_lower_or_digit = false;
        } else {
            out.push(ch.to_ascii_lowercase());
            prev_lower_or_digit = ch.is_ascii_lowercase() || ch.is_ascii_digit();
        }
    }
    out
}

/// Matches a bare numeric fraction such as `1/2` or `3/4` (the `^\d+/\d+$` form).
fn is_bare_fraction(value: &str) -> bool {
    let mut parts = value.split('/');
    match (parts.next(), parts.next(), parts.next()) {
        (Some(numerator), Some(denominator), None) => {
            !numerator.is_empty()
                && !denominator.is_empty()
                && numerator.bytes().all(|byte| byte.is_ascii_digit())
                && denominator.bytes().all(|byte| byte.is_ascii_digit())
        }
        _ => false,
    }
}

/// Properties that accept native Tailwind fractions (w-1/2, basis-1/3) instead
/// of arbitrary brackets. Mirrors `FRACTION_SUPPORTED_PROPS` in the oxc path.
fn is_fraction_supported_prop(key: &str) -> bool {
    matches!(
        key,
        "w" | "width"
            | "min-w"
            | "minW"
            | "minWidth"
            | "max-w"
            | "maxW"
            | "maxWidth"
            | "h"
            | "height"
            | "min-h"
            | "minH"
            | "minHeight"
            | "max-h"
            | "maxH"
            | "maxHeight"
            | "size"
            | "basis"
            | "flexBasis"
            | "flex"
            | "inset"
            | "inset-x"
            | "insetX"
            | "inset-y"
            | "insetY"
            | "top"
            | "right"
            | "bottom"
            | "left"
            | "start"
            | "end"
            | "translate"
            | "translate-x"
            | "translateX"
            | "translate-y"
            | "translateY"
            | "aspect"
    )
}

fn needs_brackets(value: &str) -> bool {
    if value.starts_with('[') && value.ends_with(']') {
        return false;
    }

    if value.starts_with('#')
        || value.starts_with("rgb")
        || value.starts_with("hsl")
        || value.starts_with("oklch")
        || value.starts_with("color(")
        || value.starts_with("hwb(")
        || value.starts_with("lab(")
        || value.starts_with("lch(")
        || value.starts_with("oklab(")
    {
        return true;
    }

    if value.contains("calc(")
        || value.contains("var(")
        || value.contains("attr(")
        || value.contains("url(")
        || value.contains("clamp(")
        || value.contains("min(")
        || value.contains("max(")
        || value.contains(' ')
    {
        return true;
    }

    if value.starts_with('.') && value.len() > 1 && value.as_bytes()[1].is_ascii_digit() {
        return true;
    }

    CSS_UNITS.iter().any(|unit| {
        value.strip_suffix(unit).is_some_and(|prefix| {
            // Tolerate a leading sign so a negative length (-1px) brackets too.
            let prefix = prefix.strip_prefix('-').unwrap_or(prefix);
            !prefix.is_empty() && prefix.chars().all(|c| c.is_ascii_digit() || c == '.')
        })
    })
}

#[inline]
const fn is_ascii_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'
}

#[inline]
const fn is_ascii_identifier_start_byte(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

/// Distinguishes Tailwind build-time function calls (`--spacing(4)`) from CSS
/// custom-property names (`--spacing`). This byte scanner is O(n), uses no
/// auxiliary allocation, and rejects incomplete or trailing syntax.
fn is_tailwind_build_function(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 5 || !bytes.starts_with(b"--") {
        return false;
    }

    if !is_ascii_identifier_start_byte(bytes[2]) {
        return false;
    }

    let mut index = 3;
    while index < bytes.len() && is_ascii_identifier_byte(bytes[index]) {
        index += 1;
    }
    if index == 2 || index >= bytes.len() || bytes[index] != b'(' {
        return false;
    }

    let mut depth = 0_usize;
    let mut quote = 0_u8;
    let mut escaped = false;
    while index < bytes.len() {
        let byte = bytes[index];
        if escaped {
            escaped = false;
        } else if byte == b'\\' {
            escaped = true;
        } else if quote != 0 {
            if byte == quote {
                quote = 0;
            }
        } else if byte == b'\'' || byte == b'"' {
            quote = byte;
        } else if byte == b'(' {
            depth += 1;
        } else if byte == b')' {
            depth -= 1;
            if depth == 0 {
                return index == bytes.len() - 1;
            }
        }
        index += 1;
    }

    false
}

pub(crate) fn normalize_arbitrary_value(value: &str) -> String {
    let stripped = value
        .strip_prefix('[')
        .and_then(|inner| inner.strip_suffix(']'))
        .unwrap_or(value);
    stripped.split_whitespace().collect::<Vec<_>>().join("_")
}

#[cfg(test)]
mod tests {
    use super::{
        collect_unknown_sz_keys, format_color_opacity_object, has_slash_opacity, is_known_sz_key,
        is_percent, is_tailwind_build_function, is_unsigned_decimal, lower_source_ir_classes,
        lower_static_sz_object, needs_brackets,
    };
    use crate::transform::{
        ClassAttributeIr, SourceIr, StaticSzObject, StaticSzProperty, StaticSzValue, SzAttributeIr,
        TextSpan,
    };

    fn property(key: &str, value: StaticSzValue) -> StaticSzProperty {
        StaticSzProperty {
            key: key.to_string(),
            span: TextSpan { start: 0, end: 0 },
            value,
        }
    }

    fn object(properties: Vec<StaticSzProperty>) -> StaticSzValue {
        StaticSzValue::Object(StaticSzObject { properties })
    }

    #[test]
    fn is_known_sz_key_accepts_valid_keys_and_rejects_typos() {
        // Real properties, variants, special-cased keys, removed sugar, escapes.
        for key in [
            "m",
            "p",
            "gap",
            "bg",
            "flexDir",
            "hover",
            "md",
            "data",
            "aria",
            "group",
            "min",
            "max",
            "fromPos",
            "alignContent",
            "backgroundRepeat",
            "maskMode",
            "snapStrictness",
            "grid",
            "flex",
            // Flag-only utilities: emit a class via the Boolean(true) fallback
            // but carry no value, so they are absent from boolean_class's table.
            // is_known_sz_key must still recognize them or rust warns for a class
            // it emits (field-reported for `truncate`).
            "truncate",
            "css",
            "textEllipsis",
            "textClip",
            "blur",
            "grayscale",
            "invert",
            "sepia",
            "backdropBlur",
            "backdropGrayscale",
            "backdropInvert",
            "backdropSepia",
            "--brand",
            "[mask-type]",
            "@container",
        ] {
            assert!(is_known_sz_key(key), "expected known: {key}");
        }
        // Typos must be flagged.
        for key in ["xyzzy", "pading", "colour", "fooBar", "wibble"] {
            assert!(!is_known_sz_key(key), "expected unknown: {key}");
        }
    }

    #[test]
    fn collect_unknown_sz_keys_finds_typos_and_recurses_simple_variants() {
        let object = StaticSzObject {
            properties: vec![
                property("p", StaticSzValue::Number(4.0)),
                property("xyzzy", StaticSzValue::Number(4.0)),
                StaticSzProperty {
                    key: "hover".to_string(),
                    span: TextSpan { start: 0, end: 0 },
                    value: StaticSzValue::Object(StaticSzObject {
                        properties: vec![property("nope", StaticSzValue::Number(1.0))],
                    }),
                },
            ],
        };
        let mut out = Vec::new();
        collect_unknown_sz_keys(&object, &mut out);
        let keys: Vec<&str> = out.iter().map(|(k, _)| k.as_str()).collect();
        // Top-level typo + nested typo under a SIMPLE variant, but not `p`.
        assert_eq!(keys, ["xyzzy", "nope"]);
    }

    #[test]
    fn collect_unknown_sz_keys_does_not_descend_parametric_variants() {
        // `data`/`aria`/etc. members are parameter names, not sz props.
        let object = StaticSzObject {
            properties: vec![StaticSzProperty {
                key: "data".to_string(),
                span: TextSpan { start: 0, end: 0 },
                value: StaticSzValue::Object(StaticSzObject {
                    properties: vec![property("active", StaticSzValue::Boolean(true))],
                }),
            }],
        };
        let mut out = Vec::new();
        collect_unknown_sz_keys(&object, &mut out);
        assert!(
            out.is_empty(),
            "must not warn on parametric params: {out:?}"
        );
    }

    #[test]
    fn has_slash_opacity_truth_table() {
        assert!(has_slash_opacity("blue-500/20"));
        assert!(has_slash_opacity("brand-500/50"));
        // A digit before the slash counts as opacity here; the color filter runs upstream.
        assert!(has_slash_opacity("w-1/2"));
        assert!(!has_slash_opacity("blue-500"));
    }

    #[test]
    fn needs_brackets_extended() {
        // Color functions and CSS units must be wrapped as arbitrary values.
        assert!(needs_brackets("rgb(255,0,0)"));
        assert!(needs_brackets("hsl(200,50%,50%)"));
        assert!(needs_brackets("oklch(50% 0.1 200)"));
        assert!(needs_brackets("50dvh"));
        assert!(needs_brackets("1fr"));
        assert!(needs_brackets("1ch"));
        assert!(needs_brackets("90rad"));
        assert!(needs_brackets("180turn"));
        // Plain tokens, already-bracketed values, and bare numbers must not be wrapped.
        assert!(!needs_brackets("red-500"));
        assert!(!needs_brackets("[#333]"));
        assert!(!needs_brackets("4"));
    }

    #[test]
    fn tailwind_build_function_scanner_handles_nested_and_malformed_input() {
        assert!(is_tailwind_build_function("--spacing(4)"));
        assert!(is_tailwind_build_function("--spacing(var(--step, \"(\"))"));
        assert!(is_tailwind_build_function("--spacing(calc(2\\) + 2))"));
        assert!(!is_tailwind_build_function("--spacing"));
        assert!(!is_tailwind_build_function("--spacing(calc(2 + 2)"));
        assert!(!is_tailwind_build_function("--spacing(4)junk"));
        assert!(!is_tailwind_build_function("--9(4)"));
        assert!(!is_tailwind_build_function("---x(4)"));
        assert!(is_tailwind_build_function("--_x(4)"));

        let long_malformed = format!("--spacing({}", "(".repeat(64 * 1024));
        assert!(!is_tailwind_build_function(&long_malformed));
    }

    #[test]
    fn lowers_primitives_in_source_order() {
        let object = StaticSzObject {
            properties: vec![
                property("p", StaticSzValue::Number(4.0)),
                property("bg", StaticSzValue::String("red-500".to_string())),
                property("fontStyle", StaticSzValue::String("italic".to_string())),
            ],
        };

        assert_eq!(
            lower_static_sz_object(&object),
            ["p-4", "bg-red-500", "italic"]
        );
    }

    #[test]
    fn uses_generated_property_and_boolean_maps() {
        let object = StaticSzObject {
            properties: vec![
                property("start", StaticSzValue::Number(4.0)),
                property("display", StaticSzValue::String("inline-block".to_string())),
                property("bgImg", StaticSzValue::String("url(/hero.png)".to_string())),
            ],
        };

        assert_eq!(
            lower_static_sz_object(&object),
            ["inset-s-4", "inline-block", "bg-[url(/hero.png)]"]
        );
    }

    #[test]
    fn lowers_nested_variants() {
        let object = StaticSzObject {
            properties: vec![property(
                "hover",
                StaticSzValue::Object(StaticSzObject {
                    properties: vec![property(
                        "bg",
                        StaticSzValue::String("blue-500".to_string()),
                    )],
                }),
            )],
        };

        assert_eq!(lower_static_sz_object(&object), ["hover:bg-blue-500"]);
    }

    #[test]
    fn merges_text_size_and_leading_only_within_the_same_variant() {
        let matching = StaticSzObject {
            properties: vec![
                property(
                    "hover",
                    object(vec![property("text", StaticSzValue::String("sm".into()))]),
                ),
                property(
                    "hover",
                    object(vec![property(
                        "leading",
                        StaticSzValue::String("tight".into()),
                    )]),
                ),
            ],
        };
        assert_eq!(lower_static_sz_object(&matching), ["hover:text-sm/tight"]);

        let mismatched = StaticSzObject {
            properties: vec![
                property(
                    "hover",
                    object(vec![property("text", StaticSzValue::String("sm".into()))]),
                ),
                property(
                    "focus",
                    object(vec![property(
                        "leading",
                        StaticSzValue::String("tight".into()),
                    )]),
                ),
            ],
        };
        assert_eq!(
            lower_static_sz_object(&mismatched),
            ["hover:text-sm", "focus:leading-tight"]
        );
    }

    #[test]
    fn lowers_not_and_aria_variant_matrix() {
        let declaration = |key: &str, value: StaticSzValue| StaticSzObject {
            properties: vec![property(key, value)],
        };
        let padding = || object(vec![property("p", StaticSzValue::Number(4.0))]);

        assert_eq!(
            lower_static_sz_object(&declaration(
                "not",
                object(vec![property(
                    "supports",
                    object(vec![property("display:grid", padding())]),
                )]),
            )),
            ["not-supports-[display:grid]:p-4"]
        );
        assert_eq!(
            lower_static_sz_object(&declaration(
                "not",
                object(vec![
                    property("hover", padding()),
                    property("ignored", StaticSzValue::Boolean(false)),
                ]),
            )),
            ["not-hover:p-4"]
        );
        assert_eq!(
            lower_static_sz_object(&declaration(
                "not",
                object(vec![property("focusVisible", padding())]),
            )),
            ["not-focus-visible:p-4"]
        );
        assert_eq!(
            lower_static_sz_object(&declaration(
                "aria",
                object(vec![
                    property("checked", padding()),
                    property("busy=true", padding()),
                    property("ignored", StaticSzValue::Boolean(false)),
                ]),
            )),
            ["aria-checked:p-4", "aria-[busy=true]:p-4"]
        );
    }

    #[test]
    fn lowers_group_peer_parametric_and_named_scope_matrix() {
        let padding = |value| object(vec![property("p", StaticSzValue::Number(value))]);
        let margin = |value| object(vec![property("m", StaticSzValue::Number(value))]);
        let object = StaticSzObject {
            properties: vec![
                property(
                    "group",
                    object(vec![
                        property("ignored", StaticSzValue::Boolean(false)),
                        property("data", object(vec![property("active", padding(1.0))])),
                        property(
                            "aria",
                            object(vec![
                                property("checked", padding(2.0)),
                                property("x=1", padding(3.0)),
                            ]),
                        ),
                        property(
                            "card",
                            object(vec![
                                property("data", object(vec![property("active", margin(1.0))])),
                                property(
                                    "aria",
                                    object(vec![
                                        property("checked", margin(2.0)),
                                        property("x=1", margin(3.0)),
                                    ]),
                                ),
                                property("ignored", StaticSzValue::Boolean(false)),
                            ]),
                        ),
                    ]),
                ),
                property(
                    "peer",
                    object(vec![property(
                        "has",
                        object(vec![property("img", padding(4.0))]),
                    )]),
                ),
            ],
        };

        assert_eq!(
            lower_static_sz_object(&object),
            [
                "group-data-[active]:p-1",
                "group-aria-checked:p-2",
                "group-aria-[x=1]:p-3",
                "group-data-[active]/card:m-1",
                "group-aria-checked/card:m-2",
                "group-aria-[x=1]/card:m-3",
                "peer-has-[img]:p-4",
            ]
        );
    }

    #[test]
    fn lowers_responsive_breakpoints() {
        // Helpers to build nested variant objects compactly.
        fn obj(props: Vec<StaticSzProperty>) -> StaticSzValue {
            StaticSzValue::Object(StaticSzObject { properties: props })
        }
        let nest = |key: &str, child: StaticSzValue| StaticSzObject {
            properties: vec![property(key, child)],
        };

        // breakpoint × state, both nesting orders — order is preserved as authored.
        assert_eq!(
            lower_static_sz_object(&nest(
                "md",
                obj(vec![property(
                    "hover",
                    obj(vec![property(
                        "bg",
                        StaticSzValue::String("blue-500".into())
                    )])
                )]),
            )),
            ["md:hover:bg-blue-500"]
        );
        assert_eq!(
            lower_static_sz_object(&nest(
                "hover",
                obj(vec![property(
                    "md",
                    obj(vec![property(
                        "bg",
                        StaticSzValue::String("blue-500".into())
                    )])
                )]),
            )),
            ["hover:md:bg-blue-500"]
        );

        // breakpoint × group × state.
        assert_eq!(
            lower_static_sz_object(&nest(
                "md",
                obj(vec![property(
                    "group",
                    obj(vec![property(
                        "hover",
                        obj(vec![property("p", StaticSzValue::Number(2.0))])
                    )])
                )]),
            )),
            ["md:group-hover:p-2"]
        );

        // custom breakpoint passes through.
        assert_eq!(
            lower_static_sz_object(&nest(
                "tablet",
                obj(vec![property("p", StaticSzValue::Number(3.0))])
            )),
            ["tablet:p-3"]
        );

        // breakpoint × nested color-opacity value object.
        assert_eq!(
            lower_static_sz_object(&nest(
                "md",
                obj(vec![property(
                    "bg",
                    obj(vec![
                        property("color", StaticSzValue::String("black".into())),
                        property("op", StaticSzValue::Number(30.0)),
                    ]),
                )]),
            )),
            ["md:bg-black/30"]
        );

        // multiple breakpoints on one element keep source order.
        assert_eq!(
            lower_static_sz_object(&StaticSzObject {
                properties: vec![
                    property("sm", obj(vec![property("p", StaticSzValue::Number(1.0))])),
                    property("md", obj(vec![property("p", StaticSzValue::Number(2.0))])),
                ],
            }),
            ["sm:p-1", "md:p-2"]
        );
    }

    #[test]
    fn lowers_background_image_object_syntax() {
        let object = StaticSzObject {
            properties: vec![property(
                "bgImg",
                StaticSzValue::Object(StaticSzObject {
                    properties: vec![
                        property("gradient", StaticSzValue::String("linear".to_string())),
                        property("dir", StaticSzValue::String("to-br".to_string())),
                    ],
                }),
            )],
        };

        assert_eq!(lower_static_sz_object(&object), ["bg-linear-to-br"]);
    }

    #[test]
    fn lowers_background_image_gradient_matrix() {
        let gradient = |kind: &str, dir: Option<StaticSzValue>, interpolation: Option<&str>| {
            let mut properties = vec![property(
                "gradient",
                StaticSzValue::String(kind.to_string()),
            )];
            if let Some(dir) = dir {
                properties.push(property("dir", dir));
            }
            if let Some(interpolation) = interpolation {
                properties.push(property(
                    "in",
                    StaticSzValue::String(interpolation.to_string()),
                ));
            }
            StaticSzObject {
                properties: vec![property("bgImg", object(properties))],
            }
        };

        for (input, expected) in [
            (
                gradient("linear", Some(StaticSzValue::Number(45.0)), None),
                Some("bg-linear-45"),
            ),
            (
                gradient("linear", Some(StaticSzValue::Number(-45.0)), None),
                Some("-bg-linear-45"),
            ),
            (
                gradient("linear", Some(StaticSzValue::String("--a".into())), None),
                Some("bg-linear-(--a)"),
            ),
            (
                gradient("linear", Some(StaticSzValue::Boolean(true)), None),
                None,
            ),
            (
                gradient(
                    "linear",
                    Some(StaticSzValue::String("45deg in oklab".into())),
                    None,
                ),
                Some("bg-linear-[45deg_in_oklab]"),
            ),
            (
                gradient("linear", None, Some("oklch")),
                Some("bg-linear-to-r/oklch"),
            ),
            (gradient("radial", None, None), Some("bg-radial")),
            (
                gradient("radial", Some(StaticSzValue::String("--a".into())), None),
                Some("bg-radial-(--a)"),
            ),
            (
                gradient(
                    "radial",
                    Some(StaticSzValue::String("circle at top".into())),
                    None,
                ),
                Some("bg-radial-[circle_at_top]"),
            ),
            (gradient("conic", None, None), Some("bg-conic")),
            (
                gradient("conic", Some(StaticSzValue::Number(45.0)), None),
                Some("bg-conic-45"),
            ),
            (
                gradient("conic", Some(StaticSzValue::Number(-45.0)), None),
                Some("-bg-conic-45"),
            ),
            (
                gradient("conic", Some(StaticSzValue::String("--a".into())), None),
                Some("bg-conic-(--a)"),
            ),
            (
                gradient(
                    "conic",
                    Some(StaticSzValue::String("from 45deg".into())),
                    None,
                ),
                Some("bg-conic-[from_45deg]"),
            ),
            (
                gradient("radial", Some(StaticSzValue::Number(5.0)), None),
                None,
            ),
            (gradient("unknown", None, None), None),
        ] {
            let classes = lower_static_sz_object(&input);
            assert_eq!(classes.first().map(String::as_str), expected);
            assert_eq!(classes.len(), usize::from(expected.is_some()));
        }

        let missing_gradient = StaticSzObject {
            properties: vec![property(
                "bgImg",
                object(vec![property("dir", StaticSzValue::String("to-r".into()))]),
            )],
        };
        assert!(lower_static_sz_object(&missing_gradient).is_empty());
    }

    #[test]
    fn lowers_font_stretch_value_shapes() {
        let object = StaticSzObject {
            properties: ["condensed", "--f", "50%", "50.5%", "wide"]
                .into_iter()
                .map(|value| property("fontStretch", StaticSzValue::String(value.into())))
                .collect(),
        };

        assert_eq!(
            lower_static_sz_object(&object),
            [
                "font-condensed",
                "font-stretch-(--f)",
                "font-stretch-50%",
                "font-stretch-[50.5%]",
                "font-stretch-[wide]",
            ]
        );
    }

    #[test]
    fn lowers_tailwind_special_value_matrix() {
        let object = StaticSzObject {
            properties: vec![
                property("animationDelay", StaticSzValue::Number(150.0)),
                property("animationDelay", StaticSzValue::String("2s".into())),
                property("animationDelay", StaticSzValue::Boolean(true)),
                property("fromPos", StaticSzValue::String("--stop".into())),
                property("viaPos", StaticSzValue::String("50%".into())),
                property("toPos", StaticSzValue::String("12.5%".into())),
                property("bgImg", StaticSzValue::String("none".into())),
                property("bgImg", StaticSzValue::String("linear-to-r".into())),
                property("bgImg", StaticSzValue::String("-linear-45".into())),
                property("bgImg", StaticSzValue::String("gradient-to-br".into())),
                property(
                    "bgImg",
                    StaticSzValue::String("repeating-linear-gradient(red, blue)".into()),
                ),
                property("bgImg", StaticSzValue::String("--hero".into())),
                property("bgImg", StaticSzValue::String("url(/hero.png)".into())),
                property("bgImg", StaticSzValue::String("/fallback.png".into())),
                property("content", StaticSzValue::String("none".into())),
                property("content", StaticSzValue::String("--label".into())),
                property("content", StaticSzValue::String("\"hello\"".into())),
                property("decoration", StaticSzValue::String("none".into())),
                property("fontFamily", StaticSzValue::String("--font".into())),
                property("weight", StaticSzValue::String("--weight".into())),
                property("text", StaticSzValue::String("--size".into())),
                property("textTransform", StaticSzValue::String("invalid".into())),
                property("fontStyle", StaticSzValue::String("invalid".into())),
                property("fontSmoothing", StaticSzValue::String("invalid".into())),
                property("decoration", StaticSzValue::String("invalid".into())),
                property("snapAlign", StaticSzValue::String("invalid".into())),
                property("snapStrictness", StaticSzValue::String("invalid".into())),
                property("snapStop", StaticSzValue::String("invalid".into())),
                property("snapType", StaticSzValue::String("invalid".into())),
                property(
                    "fontVariant",
                    StaticSzValue::String("diagonal-fractions".into()),
                ),
                property(
                    "fontVariant",
                    StaticSzValue::String("stacked-fractions".into()),
                ),
                property(
                    "bg",
                    object(vec![
                        property("color", StaticSzValue::String("red-500".into())),
                        property("op", StaticSzValue::Boolean(true)),
                    ]),
                ),
            ],
        };

        assert_eq!(
            lower_static_sz_object(&object),
            [
                "[animation-delay:150ms]",
                "[animation-delay:2s]",
                "from-(--stop)",
                "via-50%",
                "to-[12.5%]",
                "bg-none",
                "bg-linear-to-r",
                "-bg-linear-45",
                "bg-linear-to-br",
                "bg-[repeating-linear-gradient(red,_blue)]",
                "bg-(image:--hero)",
                "bg-[url(/hero.png)]",
                "bg-[url(/fallback.png)]",
                "content-none",
                "content-(--label)",
                "content-['hello']",
                "no-underline",
                "font-(family-name:--font)",
                "font-(weight:--weight)",
                "text-(length:--size)",
                "diagonal-fractions",
                "stacked-fractions",
            ]
        );
    }

    #[test]
    fn special_lowering_helpers_fail_closed_on_invalid_shapes() {
        let object = StaticSzObject {
            properties: vec![
                property(
                    "css",
                    object(vec![
                        property("zIndex", StaticSzValue::Number(2.0)),
                        property("inert", StaticSzValue::Boolean(true)),
                        property("nested", object(vec![])),
                    ]),
                ),
                property(
                    "has",
                    object(vec![
                        property(
                            ":focus",
                            object(vec![property("p", StaticSzValue::Number(1.0))]),
                        ),
                        property(
                            "hover",
                            object(vec![property("p", StaticSzValue::Number(2.0))]),
                        ),
                    ]),
                ),
                property(
                    "perspectiveOrigin",
                    StaticSzValue::String("top-right".into()),
                ),
                property(
                    "bgImg",
                    object(vec![
                        property("gradient", StaticSzValue::String("conic".into())),
                        property("dir", StaticSzValue::Boolean(true)),
                    ]),
                ),
            ],
        };
        assert_eq!(
            lower_static_sz_object(&object),
            [
                "[z-index:2]",
                "[inert:true]",
                "has-[:focus]:p-1",
                "has-[:hover]:p-2",
                "perspective-origin-top-right",
            ]
        );

        assert!(format_color_opacity_object("unknown", &StaticSzObject::empty(), "").is_none());
        assert!(format_color_opacity_object("bg", &StaticSzObject::empty(), "").is_none());
        assert!(!is_percent("1.2.3%"));
        assert!(!is_unsigned_decimal("1.2.3"));
    }

    #[test]
    fn lowers_arbitrary_css_sub_properties() {
        let object = StaticSzObject {
            properties: vec![property(
                "hover",
                StaticSzValue::Object(StaticSzObject {
                    properties: vec![property(
                        "css",
                        StaticSzValue::Object(StaticSzObject {
                            properties: vec![
                                property(
                                    "writingMode",
                                    StaticSzValue::String("vertical-lr".to_string()),
                                ),
                                property(
                                    "--brand",
                                    StaticSzValue::String("rgb(1 2 3)".to_string()),
                                ),
                            ],
                        }),
                    )],
                }),
            )],
        };

        assert_eq!(
            lower_static_sz_object(&object),
            [
                "hover:[writing-mode:vertical-lr]",
                "hover:[--brand:rgb(1_2_3)]"
            ]
        );
    }

    #[test]
    fn lowers_background_size_and_content_special_cases() {
        let object = StaticSzObject {
            properties: vec![property(
                "before",
                StaticSzValue::Object(StaticSzObject {
                    properties: vec![
                        property("bgSize", StaticSzValue::String("24px 24px".to_string())),
                        property("bgRepeat", StaticSzValue::String("no-repeat".to_string())),
                        property("content", StaticSzValue::String("''".to_string())),
                    ],
                }),
            )],
        };

        assert_eq!(
            lower_static_sz_object(&object),
            [
                "before:bg-size-[24px_24px]",
                "before:bg-no-repeat",
                "before:content-['']"
            ]
        );
    }

    #[test]
    fn lowers_display_position_visibility_to_bare_utilities() {
        let object = StaticSzObject {
            properties: vec![
                property("display", StaticSzValue::String("flex".to_string())),
                property("position", StaticSzValue::String("absolute".to_string())),
                property("visibility", StaticSzValue::String("visible".to_string())),
                property("isolation", StaticSzValue::String("isolate".to_string())),
            ],
        };
        assert_eq!(
            lower_static_sz_object(&object),
            ["flex", "absolute", "visible", "isolate"]
        );
    }

    #[test]
    fn lowers_display_none_and_visibility_hidden_to_aliases() {
        let object = StaticSzObject {
            properties: vec![
                property("display", StaticSzValue::String("none".to_string())),
                property("visibility", StaticSzValue::String("hidden".to_string())),
                property("display", StaticSzValue::String("inline-flex".to_string())),
            ],
        };
        assert_eq!(
            lower_static_sz_object(&object),
            ["hidden", "invisible", "inline-flex"]
        );
    }

    fn color_op(prop: &str, color: &str, op: Option<StaticSzValue>) -> Vec<String> {
        let mut props = vec![property("color", StaticSzValue::String(color.to_string()))];
        if let Some(op) = op {
            props.push(property("op", op));
        }
        let object = StaticSzObject {
            properties: vec![property(
                prop,
                StaticSzValue::Object(StaticSzObject { properties: props }),
            )],
        };
        lower_static_sz_object(&object)
    }

    #[test]
    fn lowers_color_opacity_objects() {
        assert_eq!(
            color_op("bg", "blue-500", Some(StaticSzValue::Number(20.0))),
            ["bg-blue-500/20"]
        );
        assert_eq!(
            color_op("bg", "--my-color", Some(StaticSzValue::Number(50.0))),
            ["bg-(--my-color)/50"]
        );
        assert_eq!(
            color_op("bg", "#0d0d12", Some(StaticSzValue::Number(90.0))),
            ["bg-[#0d0d12]/90"]
        );
        assert_eq!(
            color_op("bg", "black", Some(StaticSzValue::Number(0.05))),
            ["bg-black/[0.05]"]
        );
        assert_eq!(
            color_op(
                "bg",
                "pink-500",
                Some(StaticSzValue::String("78%".to_string()))
            ),
            ["bg-pink-500/[78%]"]
        );
        // `color` maps to the `text` utility, mirroring the property map.
        assert_eq!(
            color_op("color", "white", Some(StaticSzValue::Number(70.0))),
            ["text-white/70"]
        );
        // No `op` member → plain color utility, no slash.
        assert_eq!(color_op("bg", "white", None), ["bg-white"]);
    }

    #[test]
    fn lowers_shadow_family_var_colors_with_color_hint() {
        // Object form: a bare `(--c)` after a shadow-family prefix would set
        // the shadow VALUE, so the lowering adds the `color:` hint.
        assert_eq!(
            color_op("shadowColor", "--c", Some(StaticSzValue::Number(50.0))),
            ["shadow-(color:--c)/50"]
        );
        assert_eq!(
            color_op("insetShadowColor", "--c", Some(StaticSzValue::Number(30.0))),
            ["inset-shadow-(color:--c)/30"]
        );
        assert_eq!(
            color_op("textShadowColor", "--c", Some(StaticSzValue::Number(25.0))),
            ["text-shadow-(color:--c)/25"]
        );
        assert_eq!(
            color_op("dropShadowColor", "--c", Some(StaticSzValue::Number(40.0))),
            ["drop-shadow-(color:--c)/40"]
        );
        // Fractional half-step opacity stays bare (Tailwind 4.3.3 supports
        // fractional modifiers on shadow utilities).
        assert_eq!(
            color_op("shadowColor", "--c", Some(StaticSzValue::Number(12.5))),
            ["shadow-(color:--c)/12.5"]
        );
        // Non-shadow color prefixes keep the bare paren form.
        assert_eq!(color_op("bg", "--c", None), ["bg-(--c)"]);

        // String form routes through the generic CSS-var type hints.
        for (key, expected) in [
            ("shadowColor", "shadow-(color:--c)"),
            ("insetShadowColor", "inset-shadow-(color:--c)"),
            ("textShadowColor", "text-shadow-(color:--c)"),
            ("dropShadowColor", "drop-shadow-(color:--c)"),
        ] {
            let object = StaticSzObject {
                properties: vec![property(key, StaticSzValue::String("--c".into()))],
            };
            assert_eq!(lower_static_sz_object(&object), [expected]);
        }
    }

    #[cfg(feature = "native-engine")]
    #[test]
    fn collects_dead_spacing_steps() {
        let object = StaticSzObject {
            properties: vec![
                property("p", StaticSzValue::Number(1.4)),
                property("m", StaticSzValue::Number(1.5)),
                property("gap", StaticSzValue::String("1.1".into())),
                property("w", StaticSzValue::String("1.4rem".into())),
                property("leading", StaticSzValue::Number(1.4)),
                property("hidden", StaticSzValue::Boolean(true)),
                property(
                    "hover",
                    StaticSzValue::Object(StaticSzObject {
                        properties: vec![property("p", StaticSzValue::Number(2.3))],
                    }),
                ),
            ],
        };
        let mut out: Vec<(String, f64, u32)> = Vec::new();
        super::collect_dead_spacing_steps(&object, &mut out);
        let keys: Vec<(&str, f64)> = out.iter().map(|(k, v, _)| (k.as_str(), *v)).collect();
        // 1.5 is a quarter step, "1.4rem" carries a unit, and leading falls
        // back to the unitless-ratio bracket — none of those warn.
        assert_eq!(keys, [("p", 1.4), ("gap", 1.1), ("p", 2.3)]);
    }

    #[cfg(feature = "native-engine")]
    #[test]
    fn collects_property_object_values() {
        let color_op = StaticSzValue::Object(StaticSzObject {
            properties: vec![
                property("color", StaticSzValue::String("blue-500".into())),
                property("op", StaticSzValue::Number(50.0)),
            ],
        });
        let object = StaticSzObject {
            properties: vec![
                // Property key with a stray object → reported with nested keys.
                property(
                    "p",
                    StaticSzValue::Object(StaticSzObject {
                        properties: vec![property("bg", StaticSzValue::String("red-500".into()))],
                    }),
                ),
                // Color-op form on a property key is documented — silent.
                property("bg", color_op),
                // Variant nesting is legit, but the walk descends into it.
                property(
                    "hover",
                    StaticSzValue::Object(StaticSzObject {
                        properties: vec![property(
                            "shadow",
                            StaticSzValue::Object(StaticSzObject {
                                properties: vec![property("op", StaticSzValue::Number(12.5))],
                            }),
                        )],
                    }),
                ),
                // Parametric variants own their nested shape — silent.
                property(
                    "data",
                    StaticSzValue::Object(StaticSzObject {
                        properties: vec![property("active", StaticSzValue::Boolean(true))],
                    }),
                ),
            ],
        };
        let mut out: Vec<(String, String, u32)> = Vec::new();
        super::collect_property_object_values(&object, &mut out);
        let found: Vec<(&str, &str)> = out
            .iter()
            .map(|(k, n, _)| (k.as_str(), n.as_str()))
            .collect();
        assert_eq!(found, [("p", "bg"), ("shadow", "op")]);
    }

    #[test]
    fn lowers_named_scope_markers() {
        // { group: 'item' } is the marker CLASS (group/item), not a variant —
        // the generic kebab fallthrough would wrongly emit group-item.
        for (key, value, expected) in [
            ("group", "item", "group/item"),
            ("peer", "form", "peer/form"),
        ] {
            let object = StaticSzObject {
                properties: vec![property(key, StaticSzValue::String(value.into()))],
            };
            assert_eq!(lower_static_sz_object(&object), [expected]);
        }
    }

    #[test]
    fn kebab_cases_unknown_keys() {
        let object = StaticSzObject {
            properties: vec![property("breakWord", StaticSzValue::Boolean(true))],
        };
        assert_eq!(lower_static_sz_object(&object), ["break-word"]);
    }

    #[test]
    fn lowers_bare_fractions_native_or_arbitrary() {
        let supported = StaticSzObject {
            properties: vec![
                property("w", StaticSzValue::String("1/2".to_string())),
                property("basis", StaticSzValue::String("1/3".to_string())),
            ],
        };
        assert_eq!(lower_static_sz_object(&supported), ["w-1/2", "basis-1/3"]);

        let arbitrary = StaticSzObject {
            properties: vec![property("p", StaticSzValue::String("1/2".to_string()))],
        };
        assert_eq!(lower_static_sz_object(&arbitrary), ["p-[1/2]"]);
    }

    #[test]
    fn escapes_spaces_in_arbitrary_values() {
        let object = StaticSzObject {
            properties: vec![property(
                "gridCols",
                StaticSzValue::String("280px minmax(0,1fr)".to_string()),
            )],
        };
        assert_eq!(
            lower_static_sz_object(&object),
            ["grid-cols-[280px_minmax(0,1fr)]"]
        );
    }

    #[test]
    fn lowers_negative_and_skips_false_booleans() {
        // A `false` value emits nothing. The italic/antialiased `false` aliases
        // were removed with the boolean sugar — use { fontStyle: 'normal' }.
        let object = StaticSzObject {
            properties: vec![
                property("m", StaticSzValue::Number(-2.0)),
                property("grow", StaticSzValue::Boolean(false)),
                property("fontStyle", StaticSzValue::String("normal".to_string())),
            ],
        };

        assert_eq!(lower_static_sz_object(&object), ["-m-2", "not-italic"]);
    }

    #[test]
    fn drops_removed_boolean_sugar_and_keeps_flex_shorthand() {
        // { flex: true } (removed display sugar) emits nothing; { flex: 1 }
        // (flex-grow shorthand) is untouched.
        let removed = StaticSzObject {
            properties: vec![
                property("flex", StaticSzValue::Boolean(true)),
                property("absolute", StaticSzValue::Boolean(true)),
                property("italic", StaticSzValue::Boolean(true)),
                property("p", StaticSzValue::Number(4.0)),
            ],
        };
        assert_eq!(lower_static_sz_object(&removed), ["p-4"]);

        let shorthand = StaticSzObject {
            properties: vec![property("flex", StaticSzValue::Number(1.0))],
        };
        assert_eq!(lower_static_sz_object(&shorthand), ["flex-1"]);
    }

    #[test]
    fn lowers_canonical_single_property_typography() {
        let object = StaticSzObject {
            properties: vec![
                property(
                    "textTransform",
                    StaticSzValue::String("uppercase".to_string()),
                ),
                property("decoration", StaticSzValue::String("underline".to_string())),
                property(
                    "fontSmoothing",
                    StaticSzValue::String("grayscale".to_string()),
                ),
                property("textTransform", StaticSzValue::String("none".to_string())),
            ],
        };
        // Source order preserved; textTransform appears twice (last is the reset).
        assert_eq!(
            lower_static_sz_object(&object),
            ["uppercase", "underline", "antialiased", "normal-case"]
        );
    }

    #[test]
    fn brackets_arbitrary_values_and_suppresses_slash_opacity() {
        let object = StaticSzObject {
            properties: vec![
                property("w", StaticSzValue::String("12px".to_string())),
                property("bg", StaticSzValue::String("red-500/50".to_string())),
            ],
        };

        assert_eq!(lower_static_sz_object(&object), ["w-[12px]"]);
    }

    #[test]
    fn lowers_source_ir_classes_in_source_order() {
        let ir = SourceIr {
            filename: "/repo/src/App.tsx".to_string(),
            source_span: TextSpan::new(0, 80).expect("valid span"),
            sz_attributes: vec![SzAttributeIr {
                attribute_span: TextSpan::new(10, 26).expect("valid span"),
                value_span: TextSpan::new(14, 25).expect("valid span"),
                object: StaticSzObject {
                    properties: vec![StaticSzProperty {
                        key: "start".to_string(),
                        span: TextSpan::new(17, 25).expect("valid span"),
                        value: StaticSzValue::Number(4.0),
                    }],
                },
                literal_class_name: None,
                rewrites_empty_class: false,
                ternaries: Vec::new(),
                array_parts: Vec::new(),
                runtime_fallback: false,
                runtime_fallback_spread: false,
                candidate_classes: Vec::new(),
                dynamic_css_vars: Vec::new(),
            }],
            unsupported_sz_attribute_spans: Vec::new(),
            class_attributes: vec![ClassAttributeIr {
                attribute_span: TextSpan::new(28, 46).expect("valid span"),
                value_span: TextSpan::new(39, 44).expect("valid span"),
                value: "block".to_string(),
                expression_span: None,
            }],
            extracted_classes: Vec::new(),
            style_attributes: Vec::new(),
            recovery_attributes: Vec::new(),
            unsupported_recovery_attribute_spans: Vec::new(),
            jsx_opening_elements: Vec::new(),
            szs_attributes: Vec::new(),
            szs_diagnostics: Vec::new(),
        };

        let lowered = lower_source_ir_classes(&ir);

        assert_eq!(lowered.classes, ["inset-s-4"]);
        assert_eq!(lowered.raw_class_names, ["block"]);
    }
}
