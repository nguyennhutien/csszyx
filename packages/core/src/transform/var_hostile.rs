//! What the build lane does about a key Tailwind cannot read a variable for.
//!
//! The css-var strategy for a runtime value assumes `<prefix>-(--var)` is the
//! same utility as `<prefix>-<literal>` with the value deferred. For 86 keys it
//! is not, in two ways the generated tables separate: the var form resolves to a
//! DIFFERENT property (`text-(--v)` is a COLOUR, so a runtime `textAlign`
//! produced `color: var(…)` holding `"center"` — invalid, unsetting the
//! inherited colour and aligning nothing), or it matches no utility at all
//! (`display-(--v)`, so the class reached the safelist, Tailwind generated no
//! rule, and the element was silently unstyled).
//!
//! Both are the csszyx→Tailwind→CSS contract failing with no signal, so a key
//! listed here drops its class AND its style variable and reports. Emitting a
//! dead class alongside a warning is the shape 0.14.1 removed from the removed
//! -alias path, for the reason it applies here too: broken usage that still
//! renders a class looks like it works.
//!
//! Only the BUILD lane needs this. The runtime lowering receives an actual
//! value and produces the keyword utility, so `_sz({ textAlign: align })` was
//! always correct and is untouched.
//!
//! Membership lives in `packages/compiler/src/var-hostile-keys.ts` with the rest
//! of the transform vocabulary and reaches this module through
//! `pnpm gen:rust-tables`, so the two languages cannot disagree about which keys
//! they are. It is not a judgement call either: `pnpm check:var-hostile-keys`
//! derives the same set by compiling both forms of every documented key through
//! the pinned Tailwind. Run it after a Tailwind upgrade — a version that adds an
//! arbitrary-value form for one of these keys should take it off the list rather
//! than keep warning about a shape that now works.

use super::generated::tables;

/// Whether a runtime value on this key must be dropped rather than lowered to
/// a CSS custom property.
pub fn is_var_hostile_dynamic(key: &str) -> bool {
    tables::is_var_hostile_wrong_property(key) || tables::is_var_hostile_no_var_form(key)
}

#[cfg(test)]
mod tests {
    use super::is_var_hostile_dynamic;

    #[test]
    fn separates_two_keys_that_share_one_tailwind_prefix() {
        // `color` and `textAlign` both lower to `text-*`, and only one of them
        // has a var form. A rule keyed off the prefix would take the working
        // one down with the broken one.
        assert!(is_var_hostile_dynamic("textAlign"));
        assert!(!is_var_hostile_dynamic("color"));
    }

    #[test]
    fn covers_both_failure_shapes() {
        assert!(is_var_hostile_dynamic("bgSize"), "wrong property");
        assert!(is_var_hostile_dynamic("display"), "no var form");
    }

    #[test]
    fn leaves_the_valued_lanes_alone() {
        for key in ["p", "w", "bg", "z", "rotate", "duration", "opacity"] {
            assert!(!is_var_hostile_dynamic(key), "{key}");
        }
    }
}
