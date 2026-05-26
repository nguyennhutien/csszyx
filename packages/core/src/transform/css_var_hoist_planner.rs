//! Component-tier CSS custom-property hoist planning for native transform.

use std::collections::{HashMap, HashSet};

const DEFAULT_MAX_DEPTH: usize = 5;

/// Element tree node used by the hoist planner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CssVariableHoistNode {
    /// Stable element id.
    pub id: String,
    /// Parent element id.
    pub parent_id: Option<String>,
    /// Whether this element can receive hoisted style props.
    pub can_host: bool,
}

/// Comparable component-tier CSS variable usage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CssVariableHoistUsage {
    /// Stable usage id returned in a plan.
    pub id: String,
    /// Element that currently owns the variable.
    pub element_id: String,
    /// CSS custom property name.
    pub name: String,
    /// Comparable runtime value identity.
    pub value_key: String,
}

/// One hoist operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CssVariableHoistPlan {
    /// CSS custom property name to hoist.
    pub name: String,
    /// Comparable value identity shared by this group.
    pub value_key: String,
    /// Lowest common ancestor that should receive the variable.
    pub target_element_id: String,
    /// Usages that can remove their local declaration after hoisting.
    pub usage_ids: Vec<String>,
}

/// Stable reason a repeated component-tier group could not be hoisted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CssVariableHoistSkipReason {
    /// The usages do not share a common JSX ancestor in the collected tree.
    NoLca,
    /// The lowest common ancestor cannot receive a style prop.
    NonHostAncestor,
    /// At least one usage is farther than the configured cascade depth cap.
    MaxDepth,
}

/// Diagnostic emitted when a repeated hoist group is intentionally skipped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CssVariableHoistDiagnostic {
    /// CSS custom property name whose component-tier hoist was skipped.
    pub name: String,
    /// Reason the hoist could not be applied safely.
    pub reason: CssVariableHoistSkipReason,
    /// Number of same-name/same-value usages in the skipped group.
    pub usage_count: usize,
    /// Maximum cascade depth, when relevant.
    pub max_depth: Option<usize>,
}

/// Hoist planner options.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CssVariableHoistOptions {
    /// Maximum cascade distance from hoist target to any usage.
    pub max_depth: usize,
}

impl Default for CssVariableHoistOptions {
    fn default() -> Self {
        Self {
            max_depth: DEFAULT_MAX_DEPTH,
        }
    }
}

/// Component-tier hoist plans plus skip diagnostics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CssVariableHoistAnalysis {
    /// Safe hoist plans.
    pub plans: Vec<CssVariableHoistPlan>,
    /// Repeated groups that could not be hoisted.
    pub diagnostics: Vec<CssVariableHoistDiagnostic>,
}

/// Plans component-tier CSS variable hoists without mutating source.
#[cfg(test)]
pub fn plan_component_variable_hoists(
    nodes: &[CssVariableHoistNode],
    usages: &[CssVariableHoistUsage],
    options: CssVariableHoistOptions,
) -> Vec<CssVariableHoistPlan> {
    plan_component_variable_hoists_with_diagnostics(nodes, usages, options).plans
}

/// Plans component-tier CSS variable hoists and records why repeated groups
/// cannot be hoisted.
pub fn plan_component_variable_hoists_with_diagnostics(
    nodes: &[CssVariableHoistNode],
    usages: &[CssVariableHoistUsage],
    options: CssVariableHoistOptions,
) -> CssVariableHoistAnalysis {
    let node_by_id = nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let mut group_index_by_key: HashMap<String, usize> = HashMap::new();
    let mut groups: Vec<Vec<&CssVariableHoistUsage>> = Vec::new();

    for usage in usages {
        let group_key = format!("{}\0{}", usage.name, usage.value_key);
        if let Some(index) = group_index_by_key.get(&group_key).copied() {
            groups[index].push(usage);
        } else {
            group_index_by_key.insert(group_key, groups.len());
            groups.push(vec![usage]);
        }
    }

    let mut plans = Vec::new();
    let mut diagnostics = Vec::new();
    for group in groups {
        if group.len() < 2 {
            continue;
        }
        let element_ids = group
            .iter()
            .map(|usage| usage.element_id.as_str())
            .collect::<Vec<_>>();
        let Some(target_element_id) = find_lowest_common_ancestor(&element_ids, &node_by_id) else {
            diagnostics.push(build_hoist_diagnostic(
                &group,
                CssVariableHoistSkipReason::NoLca,
                None,
            ));
            continue;
        };
        let Some(target) = node_by_id.get(target_element_id) else {
            diagnostics.push(build_hoist_diagnostic(
                &group,
                CssVariableHoistSkipReason::NoLca,
                None,
            ));
            continue;
        };
        if !target.can_host {
            diagnostics.push(build_hoist_diagnostic(
                &group,
                CssVariableHoistSkipReason::NonHostAncestor,
                None,
            ));
            continue;
        }
        if group.iter().any(|usage| {
            distance_to_ancestor(&usage.element_id, target_element_id, &node_by_id)
                > options.max_depth
        }) {
            diagnostics.push(build_hoist_diagnostic(
                &group,
                CssVariableHoistSkipReason::MaxDepth,
                Some(options.max_depth),
            ));
            continue;
        }
        plans.push(CssVariableHoistPlan {
            name: group[0].name.clone(),
            value_key: group[0].value_key.clone(),
            target_element_id: target_element_id.to_string(),
            usage_ids: group.iter().map(|usage| usage.id.clone()).collect(),
        });
    }

    CssVariableHoistAnalysis { plans, diagnostics }
}

fn build_hoist_diagnostic(
    group: &[&CssVariableHoistUsage],
    reason: CssVariableHoistSkipReason,
    max_depth: Option<usize>,
) -> CssVariableHoistDiagnostic {
    CssVariableHoistDiagnostic {
        name: group
            .first()
            .map(|usage| usage.name.clone())
            .unwrap_or_default(),
        reason,
        usage_count: group.len(),
        max_depth,
    }
}

fn find_lowest_common_ancestor<'a>(
    element_ids: &[&'a str],
    node_by_id: &HashMap<&'a str, &'a CssVariableHoistNode>,
) -> Option<&'a str> {
    let (first, rest) = element_ids.split_first()?;
    let mut current_ancestors = ancestor_chain(first, node_by_id);
    for element_id in rest {
        let next_ancestors = ancestor_chain(element_id, node_by_id)
            .into_iter()
            .collect::<HashSet<_>>();
        current_ancestors.retain(|id| next_ancestors.contains(id));
        if current_ancestors.is_empty() {
            return None;
        }
    }
    current_ancestors.first().copied()
}

fn ancestor_chain<'a>(
    element_id: &'a str,
    node_by_id: &HashMap<&'a str, &'a CssVariableHoistNode>,
) -> Vec<&'a str> {
    let mut chain = Vec::new();
    let mut current = Some(element_id);
    while let Some(id) = current {
        let Some(node) = node_by_id.get(id) else {
            break;
        };
        chain.push(id);
        current = node.parent_id.as_deref();
    }
    chain
}

fn distance_to_ancestor(
    element_id: &str,
    ancestor_id: &str,
    node_by_id: &HashMap<&str, &CssVariableHoistNode>,
) -> usize {
    let mut distance = 0;
    let mut current = Some(element_id);
    while let Some(id) = current {
        if id == ancestor_id {
            return distance;
        }
        let Some(node) = node_by_id.get(id) else {
            break;
        };
        current = node.parent_id.as_deref();
        distance += 1;
    }
    usize::MAX
}

#[cfg(test)]
mod tests {
    use super::{
        plan_component_variable_hoists, plan_component_variable_hoists_with_diagnostics,
        CssVariableHoistDiagnostic, CssVariableHoistNode, CssVariableHoistOptions,
        CssVariableHoistPlan, CssVariableHoistSkipReason, CssVariableHoistUsage,
    };

    #[test]
    fn hoists_identical_component_tier_vars_to_lowest_common_ancestor() {
        let plan = plan_component_variable_hoists(
            &[
                node("root", None),
                node("card", Some("root")),
                node("title", Some("card")),
                node("body", Some("card")),
            ],
            &[
                usage("a", "title", "--cz", "blue-500"),
                usage("b", "body", "--cz", "blue-500"),
            ],
            CssVariableHoistOptions::default(),
        );

        assert_eq!(
            plan,
            [CssVariableHoistPlan {
                name: "--cz".to_string(),
                value_key: "blue-500".to_string(),
                target_element_id: "card".to_string(),
                usage_ids: vec!["a".to_string(), "b".to_string()],
            }]
        );
    }

    #[test]
    fn does_not_hoist_different_values() {
        let plan = plan_component_variable_hoists(
            &[
                node("root", None),
                node("a", Some("root")),
                node("b", Some("root")),
            ],
            &[
                usage("a1", "a", "--cz", "blue-500"),
                usage("b1", "b", "--cz", "red-500"),
            ],
            CssVariableHoistOptions::default(),
        );

        assert!(plan.is_empty());
    }

    #[test]
    fn respects_max_depth_cap() {
        let nodes = [
            node("root", None),
            node("a", Some("root")),
            node("b", Some("a")),
            node("c", Some("b")),
            node("d", Some("c")),
            node("e", Some("d")),
            node("f", Some("e")),
            node("sibling", Some("root")),
        ];
        let usages = [
            usage("deep", "f", "--cz", "blue-500"),
            usage("wide", "sibling", "--cz", "blue-500"),
        ];

        assert!(plan_component_variable_hoists(
            &nodes,
            &usages,
            CssVariableHoistOptions { max_depth: 5 },
        )
        .is_empty());
        assert_eq!(
            plan_component_variable_hoists_with_diagnostics(
                &nodes,
                &usages,
                CssVariableHoistOptions { max_depth: 5 },
            )
            .diagnostics,
            [CssVariableHoistDiagnostic {
                name: "--cz".to_string(),
                reason: CssVariableHoistSkipReason::MaxDepth,
                usage_count: 2,
                max_depth: Some(5),
            }]
        );
        assert_eq!(
            plan_component_variable_hoists(
                &nodes,
                &usages,
                CssVariableHoistOptions { max_depth: 6 },
            ),
            [CssVariableHoistPlan {
                name: "--cz".to_string(),
                value_key: "blue-500".to_string(),
                target_element_id: "root".to_string(),
                usage_ids: vec!["deep".to_string(), "wide".to_string()],
            }]
        );
    }

    #[test]
    fn skips_ancestors_that_cannot_host_style_props() {
        let mut fragment = node("fragment", Some("root"));
        fragment.can_host = false;

        let plan = plan_component_variable_hoists(
            &[
                node("root", None),
                fragment.clone(),
                node("a", Some("fragment")),
                node("b", Some("fragment")),
            ],
            &[
                usage("a1", "a", "--cz", "blue-500"),
                usage("b1", "b", "--cz", "blue-500"),
            ],
            CssVariableHoistOptions::default(),
        );

        assert!(plan.is_empty());
        assert_eq!(
            plan_component_variable_hoists_with_diagnostics(
                &[
                    node("root", None),
                    fragment,
                    node("a", Some("fragment")),
                    node("b", Some("fragment")),
                ],
                &[
                    usage("a1", "a", "--cz", "blue-500"),
                    usage("b1", "b", "--cz", "blue-500"),
                ],
                CssVariableHoistOptions::default(),
            )
            .diagnostics,
            [CssVariableHoistDiagnostic {
                name: "--cz".to_string(),
                reason: CssVariableHoistSkipReason::NonHostAncestor,
                usage_count: 2,
                max_depth: None,
            }]
        );
    }

    #[test]
    fn diagnoses_missing_common_ancestor() {
        let analysis = plan_component_variable_hoists_with_diagnostics(
            &[node("a", None), node("b", None)],
            &[
                usage("a1", "a", "--cz", "blue-500"),
                usage("b1", "b", "--cz", "blue-500"),
            ],
            CssVariableHoistOptions::default(),
        );

        assert_eq!(analysis.plans, []);
        assert_eq!(
            analysis.diagnostics,
            [CssVariableHoistDiagnostic {
                name: "--cz".to_string(),
                reason: CssVariableHoistSkipReason::NoLca,
                usage_count: 2,
                max_depth: None,
            }]
        );
    }

    fn node(id: &str, parent_id: Option<&str>) -> CssVariableHoistNode {
        CssVariableHoistNode {
            id: id.to_string(),
            parent_id: parent_id.map(str::to_string),
            can_host: true,
        }
    }

    fn usage(id: &str, element_id: &str, name: &str, value_key: &str) -> CssVariableHoistUsage {
        CssVariableHoistUsage {
            id: id.to_string(),
            element_id: element_id.to_string(),
            name: name.to_string(),
            value_key: value_key.to_string(),
        }
    }
}
