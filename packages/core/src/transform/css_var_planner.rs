//! CSS custom-property name planning for the native transform.
//!
//! This mirrors the TypeScript planner used by the oxc path. Keeping the
//! planner pure gives the Rust rewrite path a deterministic contract before it
//! mutates source code.

use std::collections::HashMap;

use crate::encoder::encode;

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

fn canonical_usage_key(usage: &CssVariablePlanInput) -> String {
    format!(
        "{}\0{}",
        usage.variant_chain.as_deref().unwrap_or_default(),
        usage.property_key
    )
}

#[cfg(test)]
mod tests {
    use super::{plan_css_variable_names, CssVariablePlanInput, CssVariableTier};

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
}
