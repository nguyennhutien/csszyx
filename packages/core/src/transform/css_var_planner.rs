//! CSS custom-property name planning for the native transform.
//!
//! This mirrors the TypeScript planner used by the oxc path. Keeping the
//! planner pure gives the Rust rewrite path a deterministic contract before it
//! mutates source code.

use std::collections::HashMap;

use crate::encoder::encode;

use super::SourceIr;

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

/// Plans tiered CSS custom property names without mutating source.
pub fn plan_css_variable_names(usages: &[CssVariablePlanInput]) -> Vec<CssVariablePlanEntry> {
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
                        .or_insert_with(|| format!("--c{}", encode(next_index)))
                        .clone()
                }
                CssVariableTier::Scoped => {
                    let element_id = usage.element_id.clone().unwrap_or_default();
                    let element_names = scoped_names_by_element.entry(element_id).or_default();
                    let next_index = element_names.len();
                    let key = canonical_usage_key(usage);
                    element_names
                        .entry(key)
                        .or_insert_with(|| format!("--s{}", encode(next_index)))
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

/// Applies scoped-tier CSS variable names to a cloned source IR.
///
/// This is the first native rewrite slice: it intentionally handles only
/// element-scoped names. Component-tier hoisting needs a separate LCA planner
/// so it can move style declarations between elements instead of only renaming
/// them in place.
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

fn canonical_usage_key(usage: &CssVariablePlanInput) -> String {
    format!(
        "{}\0{}",
        usage.variant_chain.as_deref().unwrap_or_default(),
        usage.property_key
    )
}

#[cfg(test)]
mod tests {
    use super::{
        apply_scoped_css_variable_names, plan_css_variable_names, CssVariablePlanInput,
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
            runtime_fallback: false,
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
        }
    }
}
