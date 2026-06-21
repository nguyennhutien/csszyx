//! CSS custom-property name planning for the native transform.
//!
//! This mirrors the TypeScript planner used by the oxc path. Keeping the
//! planner pure gives the Rust rewrite path a deterministic contract before it
//! mutates source code.

use std::collections::{HashMap, HashSet};

use crate::encoder::encode;

use super::{
    css_var_hoist_planner::{
        plan_component_variable_hoists_with_diagnostics, CssVariableHoistDiagnostic,
        CssVariableHoistNode, CssVariableHoistOptions, CssVariableHoistSkipReason,
        CssVariableHoistUsage,
    },
    CssVariableMapEntry, DynamicCssVarCategory, SourceIr,
};

/// CSS variable naming tier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CssVariableTier {
    /// Component-level variable that can be shared and hoisted.
    Component,
    /// Element-scoped variable that can safely reuse short names per element.
    Scoped,
}

/// Planner input for one CSS variable usage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CssVariablePlanInput {
    /// Stable caller-owned usage id.
    pub id: String,
    /// Naming tier.
    pub tier: CssVariableTier,
    /// sz property key.
    pub property_key: String,
    /// Optional Tailwind variant chain.
    pub variant_chain: Option<String>,
    /// Required for scoped vars so counters can restart per element.
    pub element_id: Option<String>,
}

/// Planner output for one CSS variable usage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CssVariablePlanEntry {
    /// Stable caller-owned usage id.
    pub id: String,
    /// Naming tier.
    pub tier: CssVariableTier,
    /// sz property key.
    pub property_key: String,
    /// Optional Tailwind variant chain.
    pub variant_chain: Option<String>,
    /// Scoped element id.
    pub element_id: Option<String>,
    /// Planned CSS custom property name.
    pub name: String,
}

/// Options controlling CSS variable name allocation.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CssVariablePlanOptions {
    /// CSS custom-property names already owned by user code in this file.
    pub reserved_names: HashSet<String>,
}

/// Planned IR plus public CSS variable metadata.
#[derive(Debug, Clone, PartialEq)]
pub struct CssVariableMangling {
    /// Planned source IR.
    pub ir: SourceIr,
    /// Original-to-mangled CSS custom property map.
    pub variable_map: Vec<CssVariableMapEntry>,
    /// Non-fatal diagnostics emitted while planning variable mangling.
    pub diagnostics: Vec<String>,
}

/// Plans tiered CSS custom property names without mutating source.
#[cfg(test)]
pub fn plan_css_variable_names(usages: &[CssVariablePlanInput]) -> Vec<CssVariablePlanEntry> {
    plan_css_variable_names_with_options(usages, &CssVariablePlanOptions::default())
}

/// Plans tiered CSS custom property names with caller-provided allocation options.
pub fn plan_css_variable_names_with_options(
    usages: &[CssVariablePlanInput],
    options: &CssVariablePlanOptions,
) -> Vec<CssVariablePlanEntry> {
    let mut component_names: HashMap<String, String> = HashMap::new();
    let mut scoped_names_by_element: HashMap<String, HashMap<String, String>> = HashMap::new();

    usages
        .iter()
        .map(|usage| {
            let name = match usage.tier {
                CssVariableTier::Component => {
                    let next_index = component_names.len();
                    let key = canonical_usage_key(usage);
                    component_names
                        .entry(key)
                        .or_insert_with(|| {
                            allocate_variable_name("--c", next_index, &options.reserved_names)
                        })
                        .clone()
                }
                CssVariableTier::Scoped => {
                    let element_id = usage.element_id.clone().unwrap_or_default();
                    let element_names = scoped_names_by_element.entry(element_id).or_default();
                    let next_index = element_names.len();
                    let key = canonical_usage_key(usage);
                    element_names
                        .entry(key)
                        .or_insert_with(|| {
                            allocate_variable_name("--s", next_index, &options.reserved_names)
                        })
                        .clone()
                }
            };

            CssVariablePlanEntry {
                id: usage.id.clone(),
                tier: usage.tier,
                property_key: usage.property_key.clone(),
                variant_chain: usage.variant_chain.clone(),
                element_id: usage.element_id.clone(),
                name,
            }
        })
        .collect()
}

fn allocate_variable_name(
    prefix: &str,
    start_index: usize,
    reserved_names: &HashSet<String>,
) -> String {
    let mut index = start_index;
    loop {
        let name = format!("{}{}", prefix, encode(index));
        if !reserved_names.contains(&name) {
            return name;
        }
        index += 1;
    }
}

/// Applies scoped-tier CSS variable names to a cloned source IR.
///
/// This is the first native rewrite slice: it intentionally handles only
/// element-scoped names. Component-tier hoisting needs a separate LCA planner
/// so it can move style declarations between elements instead of only renaming
/// them in place.
#[cfg(test)]
pub fn apply_scoped_css_variable_names(ir: &SourceIr) -> SourceIr {
    let mut next = ir.clone();
    let mut usages = Vec::new();
    let mut locations = Vec::new();

    for element in &ir.jsx_opening_elements {
        let element_id = element.opening_span.start.to_string();
        for attr_index in &element.sz_attribute_indices {
            let attribute = &ir.sz_attributes[*attr_index];
            for (prop_index, prop) in attribute.dynamic_css_vars.iter().enumerate() {
                let id = locations.len().to_string();
                usages.push(CssVariablePlanInput {
                    id,
                    tier: CssVariableTier::Scoped,
                    property_key: prop.key.clone(),
                    variant_chain: prop.variant_prefix.clone(),
                    element_id: Some(element_id.clone()),
                });
                locations.push((*attr_index, prop_index));
            }
        }
    }

    for entry in plan_css_variable_names(&usages) {
        let Ok(location_index) = entry.id.parse::<usize>() else {
            continue;
        };
        let Some((attr_index, prop_index)) = locations.get(location_index).copied() else {
            continue;
        };
        if let Some(prop) = next
            .sz_attributes
            .get_mut(attr_index)
            .and_then(|attribute| attribute.dynamic_css_vars.get_mut(prop_index))
        {
            prop.var_name = entry.name;
        }
    }

    next
}

/// Applies component-tier hoists, then scoped names for non-hoisted vars.
#[allow(clippy::too_many_lines)]
pub fn apply_css_variable_mangling(
    ir: &SourceIr,
    source: &str,
    max_depth: Option<usize>,
) -> CssVariableMangling {
    let mut next = ir.clone();
    let mut component_usages = Vec::new();
    let mut locations = Vec::new();
    let mut variable_map = Vec::new();
    let reserved_names = collect_static_style_custom_property_names(ir, source);
    let plan_options = CssVariablePlanOptions { reserved_names };

    for (element_index, element) in ir.jsx_opening_elements.iter().enumerate() {
        for attr_index in &element.sz_attribute_indices {
            let attribute = &ir.sz_attributes[*attr_index];
            for (prop_index, prop) in attribute.dynamic_css_vars.iter().enumerate() {
                let id = locations.len().to_string();
                component_usages.push(CssVariablePlanInput {
                    id,
                    tier: CssVariableTier::Component,
                    property_key: prop.key.clone(),
                    variant_chain: prop.variant_prefix.clone(),
                    element_id: Some(element_index.to_string()),
                });
                locations.push((element_index, *attr_index, prop_index));
            }
        }
    }

    let component_plan = plan_css_variable_names_with_options(&component_usages, &plan_options);
    let hoist_nodes = ir
        .jsx_opening_elements
        .iter()
        .enumerate()
        .map(|(index, element)| CssVariableHoistNode {
            id: index.to_string(),
            parent_id: element
                .parent_element_index
                .map(|parent| parent.to_string()),
            can_host: element.can_host_style,
        })
        .collect::<Vec<_>>();
    let hoist_usages = component_plan
        .iter()
        .filter_map(|entry| {
            let location_index = entry.id.parse::<usize>().ok()?;
            let (element_index, attr_index, prop_index) = *locations.get(location_index)?;
            let prop = &ir.sz_attributes[attr_index].dynamic_css_vars[prop_index];
            Some(CssVariableHoistUsage {
                id: entry.id.clone(),
                element_id: element_index.to_string(),
                name: entry.name.clone(),
                value_key: dynamic_value_key(source, prop),
            })
        })
        .collect::<Vec<_>>();
    let hoist_analysis = plan_component_variable_hoists_with_diagnostics(
        &hoist_nodes,
        &hoist_usages,
        CssVariableHoistOptions {
            max_depth: max_depth.unwrap_or_else(|| CssVariableHoistOptions::default().max_depth),
        },
    );
    let hoist_plans = hoist_analysis.plans;

    let mut hoisted_location_ids = std::collections::HashSet::new();
    for plan in hoist_plans {
        let Some(first_usage_id) = plan.usage_ids.first() else {
            continue;
        };
        let Ok(first_location_index) = first_usage_id.parse::<usize>() else {
            continue;
        };
        let Some((_, first_attr_index, first_prop_index)) =
            locations.get(first_location_index).copied()
        else {
            continue;
        };
        let mut hoisted_prop =
            next.sz_attributes[first_attr_index].dynamic_css_vars[first_prop_index].clone();
        hoisted_prop.var_name.clone_from(&plan.name);
        hoisted_prop.hoisted = false;
        if let Some(target) = next.jsx_opening_elements.get_mut(
            plan.target_element_id
                .parse::<usize>()
                .unwrap_or(usize::MAX),
        ) {
            target.hoisted_dynamic_css_vars.push(hoisted_prop);
        }

        for usage_id in plan.usage_ids {
            let Ok(location_index) = usage_id.parse::<usize>() else {
                continue;
            };
            let Some((_, attr_index, prop_index)) = locations.get(location_index).copied() else {
                continue;
            };
            if let Some(prop) = next
                .sz_attributes
                .get_mut(attr_index)
                .and_then(|attribute| attribute.dynamic_css_vars.get_mut(prop_index))
            {
                push_variable_map(&mut variable_map, &prop.var_name, &plan.name);
                prop.var_name.clone_from(&plan.name);
                prop.hoisted = true;
                hoisted_location_ids.insert(location_index);
            }
        }
    }

    let scoped_usages = locations
        .iter()
        .enumerate()
        .filter(|(location_index, _)| !hoisted_location_ids.contains(location_index))
        .map(
            |(location_index, (element_index, attr_index, prop_index))| {
                let prop = &ir.sz_attributes[*attr_index].dynamic_css_vars[*prop_index];
                CssVariablePlanInput {
                    id: location_index.to_string(),
                    tier: CssVariableTier::Scoped,
                    property_key: prop.key.clone(),
                    variant_chain: prop.variant_prefix.clone(),
                    element_id: Some(element_index.to_string()),
                }
            },
        )
        .collect::<Vec<_>>();
    for entry in plan_css_variable_names_with_options(&scoped_usages, &plan_options) {
        let Ok(location_index) = entry.id.parse::<usize>() else {
            continue;
        };
        let Some((_, attr_index, prop_index)) = locations.get(location_index).copied() else {
            continue;
        };
        if let Some(prop) = next
            .sz_attributes
            .get_mut(attr_index)
            .and_then(|attribute| attribute.dynamic_css_vars.get_mut(prop_index))
        {
            push_variable_map(&mut variable_map, &prop.var_name, &entry.name);
            prop.var_name = entry.name;
        }
    }

    CssVariableMangling {
        ir: next,
        variable_map,
        diagnostics: hoist_analysis
            .diagnostics
            .iter()
            .map(format_hoist_skip_diagnostic)
            .collect(),
    }
}

fn collect_static_style_custom_property_names(ir: &SourceIr, source: &str) -> HashSet<String> {
    let mut names = HashSet::new();
    for style in &ir.style_attributes {
        let Some(span) = style.expression_span else {
            continue;
        };
        let expression = &source[span.start as usize..span.end as usize];
        for name in extract_quoted_custom_property_keys(expression) {
            names.insert(name);
        }
    }
    names
}

fn extract_quoted_custom_property_keys(expression: &str) -> Vec<String> {
    let bytes = expression.as_bytes();
    let mut names = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        let quote = bytes[index];
        if quote != b'"' && quote != b'\'' {
            index += 1;
            continue;
        }
        let start = index + 1;
        index = start;
        while index < bytes.len() && bytes[index] != quote {
            index += 1;
        }
        if index >= bytes.len() {
            break;
        }
        let value = &expression[start..index];
        let mut after = index + 1;
        while after < bytes.len() && bytes[after].is_ascii_whitespace() {
            after += 1;
        }
        if value.starts_with("--") && after < bytes.len() && bytes[after] == b':' {
            names.push(value.to_string());
        }
        index += 1;
    }
    names
}

fn format_hoist_skip_diagnostic(diagnostic: &CssVariableHoistDiagnostic) -> String {
    let reason = match diagnostic.reason {
        CssVariableHoistSkipReason::NoLca => "no-lca",
        CssVariableHoistSkipReason::NonHostAncestor => "non-host-ancestor",
        CssVariableHoistSkipReason::MaxDepth => "max-depth",
    };
    let suffix = diagnostic
        .max_depth
        .map(|max_depth| format!(" (maxDepth {max_depth})"))
        .unwrap_or_default();
    format!(
        "[csszyx] mangleVars skipped component CSS variable hoist for {} across {} usages: {}{}",
        diagnostic.name, diagnostic.usage_count, reason, suffix
    )
}

fn push_variable_map(map: &mut Vec<CssVariableMapEntry>, original: &str, mangled: &str) {
    if original == mangled {
        return;
    }
    if map
        .iter()
        .any(|entry| entry.original == original && entry.mangled == mangled)
    {
        return;
    }
    map.push(CssVariableMapEntry {
        original: original.to_string(),
        mangled: mangled.to_string(),
    });
}

fn dynamic_value_key(source: &str, prop: &super::DynamicCssVarIr) -> String {
    let expression = normalize_dynamic_expression_key(
        &source[prop.expression_span.start as usize..prop.expression_span.end as usize],
    );
    match prop.category {
        DynamicCssVarCategory::Spacing => format!("spacing:{expression}"),
        DynamicCssVarCategory::Color => format!("color:{expression}"),
        DynamicCssVarCategory::Angle => format!("angle:{expression}"),
        DynamicCssVarCategory::Duration => format!("duration:{expression}"),
        DynamicCssVarCategory::Passthrough => format!("pass:{expression}"),
    }
}

fn normalize_dynamic_expression_key(expression: &str) -> String {
    let mut normalized = expression.trim().to_string();
    while has_redundant_outer_parens(&normalized) {
        normalized = normalized[1..normalized.len() - 1].trim().to_string();
    }
    normalized
}

fn has_redundant_outer_parens(expression: &str) -> bool {
    if !expression.starts_with('(') || !expression.ends_with(')') {
        return false;
    }
    let mut depth = 0_i32;
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let last_index = expression.len() - 1;
    for (index, char) in expression.char_indices() {
        if let Some(active_quote) = quote {
            if escaped {
                escaped = false;
            } else if char == '\\' {
                escaped = true;
            } else if char == active_quote {
                quote = None;
            }
            continue;
        }
        if matches!(char, '"' | '\'' | '`') {
            quote = Some(char);
            continue;
        }
        if char == '(' {
            depth += 1;
        } else if char == ')' {
            depth -= 1;
            if depth == 0 && index != last_index {
                return false;
            }
        }
        if depth < 0 {
            return false;
        }
    }
    depth == 0
}

fn canonical_usage_key(usage: &CssVariablePlanInput) -> String {
    format!(
        "{}\0{}",
        usage.variant_chain.as_deref().unwrap_or_default(),
        usage.property_key
    )
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::{
        apply_scoped_css_variable_names, normalize_dynamic_expression_key, plan_css_variable_names,
        plan_css_variable_names_with_options, CssVariablePlanInput, CssVariablePlanOptions,
        CssVariableTier,
    };
    use crate::transform::{
        DynamicCssVarCategory, DynamicCssVarIr, JsxOpeningElementIr, SourceIr, StaticSzObject,
        SzAttributeIr, TextSpan,
    };

    fn usage(id: &str, tier: CssVariableTier, property_key: &str) -> CssVariablePlanInput {
        CssVariablePlanInput {
            id: id.to_string(),
            tier,
            property_key: property_key.to_string(),
            variant_chain: None,
            element_id: None,
        }
    }

    #[test]
    fn assigns_deterministic_component_names_and_deduplicates_matching_keys() {
        let mut md_gap = usage("d", CssVariableTier::Component, "gap");
        md_gap.variant_chain = Some("md".to_string());

        let plan = plan_css_variable_names(&[
            usage("a", CssVariableTier::Component, "bg"),
            usage("b", CssVariableTier::Component, "color"),
            usage("c", CssVariableTier::Component, "bg"),
            md_gap,
        ]);

        let pairs = plan
            .iter()
            .map(|entry| (entry.id.as_str(), entry.name.as_str()))
            .collect::<Vec<_>>();
        assert_eq!(
            pairs,
            [("a", "--cz"), ("b", "--cy"), ("c", "--cz"), ("d", "--cx")]
        );
    }

    #[test]
    fn restarts_scoped_names_per_element() {
        let mut usages = [
            usage("a", CssVariableTier::Scoped, "x"),
            usage("b", CssVariableTier::Scoped, "y"),
            usage("c", CssVariableTier::Scoped, "x"),
            usage("d", CssVariableTier::Scoped, "y"),
        ];
        usages[0].element_id = Some("card-1".to_string());
        usages[1].element_id = Some("card-1".to_string());
        usages[2].element_id = Some("card-2".to_string());
        usages[3].element_id = Some("card-2".to_string());

        let plan = plan_css_variable_names(&usages);

        let pairs = plan
            .iter()
            .map(|entry| (entry.id.as_str(), entry.name.as_str()))
            .collect::<Vec<_>>();
        assert_eq!(
            pairs,
            [("a", "--sz"), ("b", "--sy"), ("c", "--sz"), ("d", "--sy")]
        );
    }

    #[test]
    fn keeps_component_and_scoped_counters_independent() {
        let mut scoped = usage("scoped", CssVariableTier::Scoped, "bg");
        scoped.element_id = Some("card".to_string());

        let plan = plan_css_variable_names(&[
            usage("component", CssVariableTier::Component, "bg"),
            scoped,
        ]);

        let pairs = plan
            .iter()
            .map(|entry| (entry.id.as_str(), entry.name.as_str()))
            .collect::<Vec<_>>();
        assert_eq!(pairs, [("component", "--cz"), ("scoped", "--sz")]);
    }

    #[test]
    fn skips_user_reserved_css_custom_property_names() {
        let mut scoped = usage("scoped", CssVariableTier::Scoped, "p");
        scoped.element_id = Some("card".to_string());
        let plan = plan_css_variable_names_with_options(
            &[usage("component", CssVariableTier::Component, "bg"), scoped],
            &CssVariablePlanOptions {
                reserved_names: HashSet::from(["--cz".to_string(), "--sz".to_string()]),
            },
        );

        let pairs = plan
            .iter()
            .map(|entry| (entry.id.as_str(), entry.name.as_str()))
            .collect::<Vec<_>>();
        assert_eq!(pairs, [("component", "--cy"), ("scoped", "--sy")]);
    }

    #[test]
    fn normalizes_dynamic_value_key_outer_parentheses() {
        assert_eq!(normalize_dynamic_expression_key(" pad "), "pad");
        assert_eq!(normalize_dynamic_expression_key("((pad))"), "pad");
        assert_eq!(
            normalize_dynamic_expression_key("(pad) + gap"),
            "(pad) + gap"
        );
    }

    #[test]
    fn applies_scoped_names_to_dynamic_css_vars_per_element() {
        let ir = SourceIr {
            filename: "fixture.tsx".to_string(),
            source_span: TextSpan { start: 0, end: 120 },
            sz_attributes: vec![
                sz_attribute(vec![
                    dynamic_prop("p", "--_sz-p"),
                    dynamic_prop("m", "--_sz-m"),
                ]),
                sz_attribute(vec![dynamic_prop("p", "--_sz-p")]),
            ],
            unsupported_sz_attribute_spans: Vec::new(),
            class_attributes: Vec::new(),
            extracted_classes: Vec::new(),
            style_attributes: Vec::new(),
            recovery_attributes: Vec::new(),
            unsupported_recovery_attribute_spans: Vec::new(),
            jsx_opening_elements: vec![opening_element(10, vec![0]), opening_element(40, vec![1])],
        };

        let planned = apply_scoped_css_variable_names(&ir);

        assert_eq!(
            planned.sz_attributes[0].dynamic_css_vars[0].var_name,
            "--sz"
        );
        assert_eq!(
            planned.sz_attributes[0].dynamic_css_vars[1].var_name,
            "--sy"
        );
        assert_eq!(
            planned.sz_attributes[1].dynamic_css_vars[0].var_name,
            "--sz"
        );
    }

    fn sz_attribute(dynamic_css_vars: Vec<DynamicCssVarIr>) -> SzAttributeIr {
        SzAttributeIr {
            attribute_span: TextSpan { start: 0, end: 0 },
            value_span: TextSpan { start: 0, end: 0 },
            object: StaticSzObject::empty(),
            literal_class_name: None,
            rewrites_empty_class: false,
            ternary: None,
            array_parts: Vec::new(),
            runtime_fallback: false,
            runtime_fallback_spread: false,
            candidate_classes: Vec::new(),
            dynamic_css_vars,
        }
    }

    fn dynamic_prop(key: &str, var_name: &str) -> DynamicCssVarIr {
        DynamicCssVarIr {
            key: key.to_string(),
            class_prefix: key.to_string(),
            var_name: var_name.to_string(),
            category: DynamicCssVarCategory::Passthrough,
            expression_span: TextSpan { start: 0, end: 0 },
            variant_prefix: None,
            hoisted: false,
        }
    }

    fn opening_element(start: u32, sz_attribute_indices: Vec<usize>) -> JsxOpeningElementIr {
        JsxOpeningElementIr {
            opening_span: TextSpan {
                start,
                end: start + 10,
            },
            parent_element_index: None,
            can_host_style: true,
            sz_attribute_indices,
            class_attribute_index: None,
            style_attribute_index: None,
            recovery_attribute_index: None,
            has_recovery_token_attribute: false,
            last_attribute_end: None,
            element_name: "div".to_string(),
            hoisted_dynamic_css_vars: Vec::new(),
        }
    }
}
