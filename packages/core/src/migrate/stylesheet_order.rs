//! The order Tailwind's stylesheet puts the closed-value classes in.
//!
//! Before 0.18, two keys of one group in one sz object both emitted their
//! class (`{ tabularNums: true, proportionalNums: true }` shipped
//! `tabular-nums proportional-nums`), and the stylesheet decided which one
//! rendered: the rule that comes later wins. An sz object now decides by the
//! order it is written, so the codemod keeps the property whose class came
//! last here, and the page renders as it did (ADR 0003, "migrate keeps the
//! render").
//!
//! Data, not a guess: `packages/cli/tests/migrate-stylesheet-order.test.ts`
//! builds these classes with Tailwind and fails when its order, or the set of
//! classes the closed keys emit, drifts from this list. Only the order within
//! one key or one family is read; the order across properties is whatever
//! Tailwind printed.

use crate::transform::generated::tables::{boolean_class, closed_enum_class};

/// Every class a closed key or a family's flag key emits, in stylesheet order.
pub(super) const STYLESHEET_ORDER: &[&str] = &[
    "collapse",
    "invisible",
    "visible",
    "absolute",
    "fixed",
    "relative",
    "static",
    "sticky",
    "isolate",
    "isolation-auto",
    "block",
    "contents",
    "flex",
    "flow-root",
    "grid",
    "hidden",
    "inline",
    "inline-block",
    "inline-flex",
    "inline-grid",
    "inline-table",
    "list-item",
    "table",
    "table-caption",
    "table-cell",
    "table-column",
    "table-column-group",
    "table-footer-group",
    "table-header-group",
    "table-row",
    "table-row-group",
    "touch-pan-left",
    "touch-pan-right",
    "touch-pan-x",
    "touch-pan-down",
    "touch-pan-up",
    "touch-pan-y",
    "touch-pinch-zoom",
    "touch-auto",
    "touch-manipulation",
    "touch-none",
    "diagonal-fractions",
    "lining-nums",
    "oldstyle-nums",
    "ordinal",
    "proportional-nums",
    "slashed-zero",
    "stacked-fractions",
    "tabular-nums",
    "normal-nums",
    "contain-inline-size",
    "contain-layout",
    "contain-paint",
    "contain-size",
    "contain-style",
    "contain-content",
    "contain-none",
    "contain-strict",
];

/// The class a key and a static value emit, when it is one of the classes
/// above: a closed key's value, or `true` on a flag key.
pub(super) fn static_class(key: &str, value: &str) -> Option<&'static str> {
    if value == "true" {
        return boolean_class(key).filter(|class| rank(class).is_some());
    }
    closed_enum_class(key, value)
}

/// Where a class sits in the stylesheet; a later rule wins.
pub(super) fn rank(class: &str) -> Option<usize> {
    STYLESHEET_ORDER.iter().position(|known| *known == class)
}

#[cfg(test)]
mod tests {
    use super::{rank, static_class};
    use crate::transform::generated::tables::{
        closed_enum_values, global_keyword_for_group, global_keyword_groups,
    };

    /// The codemod resolves a stand-alone keyword beside its groups by
    /// deleting the groups, which keeps the render only while every
    /// stand-alone class sorts after every class of its groups.
    #[test]
    fn every_stand_alone_class_sorts_after_each_class_of_its_groups() {
        for global in ["nums", "touch", "contain"] {
            let standalone = classes_of(global);
            assert!(!standalone.is_empty(), "{global}");
            for group in global_keyword_groups(global).expect(global).split(' ') {
                assert_eq!(global_keyword_for_group(group), Some(global));
                for group_class in classes_of(group) {
                    for class in &standalone {
                        assert!(rank(group_class) < rank(class), "{group_class} {class}");
                    }
                }
            }
        }
    }

    #[test]
    fn a_key_outside_the_list_has_no_static_class() {
        assert_eq!(static_class("srOnly", "true"), None);
        assert_eq!(static_class("p", "4"), None);
        assert_eq!(static_class("numOrdinal", "true"), Some("ordinal"));
        assert_eq!(rank("p-4"), None);
    }

    /// A closed key's classes, or a flag key's one class.
    fn classes_of(key: &str) -> Vec<&'static str> {
        closed_enum_values(key).map_or_else(
            || static_class(key, "true").into_iter().collect(),
            |values| {
                values
                    .split(", ")
                    .map(|value| static_class(key, value).expect(value))
                    .collect()
            },
        )
    }
}
