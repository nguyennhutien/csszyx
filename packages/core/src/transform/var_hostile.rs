//! Keys whose Tailwind utility cannot read a CSS custom property.
//!
//! The css-var strategy for a runtime value assumes one thing: that
//! `<prefix>-(--var)` is the same utility as `<prefix>-<literal>`, only with
//! the value deferred. For most of the sz vocabulary that holds. For the keys
//! below it does not, in one of two ways:
//!
//! - **The var form is a different property.** `textAlign` and `color` both
//!   lower to `text-*`, and Tailwind v4 reads `text-(--v)` as a COLOR — so a
//!   runtime `textAlign` produced `color: var(…)` holding `"center"`, an
//!   invalid value that unsets the inherited colour and aligns nothing.
//! - **The var form is not a utility at all.** `display-(--v)` matches
//!   nothing, so the class reached the safelist, Tailwind generated no rule,
//!   and the element was silently unstyled.
//!
//! Both are the csszyx→Tailwind→CSS contract failing with no signal, so a key
//! listed here drops its class AND its style variable and reports. Emitting a
//! dead class alongside a warning is the shape 0.14.1 removed from the removed
//! -alias path, for the reason it applies here too: broken usage that still
//! renders a class looks like it works.
//!
//! Membership is not a judgement call — `scripts/check-var-hostile-keys.mjs`
//! derives it by compiling both forms of every documented key through the
//! pinned Tailwind and comparing the CSS properties each one sets. Run it
//! after a Tailwind upgrade: a version that adds an arbitrary-value form for
//! one of these keys should take it off this list, not keep warning about it.
//!
//! Only the BUILD lane needs this. The runtime lowering receives an actual
//! value and produces the keyword utility, so `_sz({ textAlign: align })` was
//! always correct and is untouched.

/// Whether a runtime value on this key must be dropped rather than lowered to
/// a CSS custom property.
pub fn is_var_hostile_dynamic(key: &str) -> bool {
    matches!(key, k if is_wrong_property(k) || has_no_var_form(k))
}

/// Keys whose `-(--var)` form resolves to a DIFFERENT CSS property.
///
/// The damaging half: Tailwind emits a rule, so the element is styled — just
/// not the way the author asked, and often over something that was working.
fn is_wrong_property(key: &str) -> bool {
    matches!(
        key,
        "bgAttach"
            | "bgImg"
            | "bgRepeat"
            | "bgSize"
            | "borderCollapse"
            | "borderStyle"
            | "decoration"
            | "decorationStyle"
            | "flexDir"
            | "flexWrap"
            | "fontFamily"
            | "listPos"
            | "objectFit"
            | "outlineStyle"
            | "text"
            | "textAlign"
            | "textTransform"
            | "textWrap"
            | "transformStyle"
            | "transitionBehavior"
    )
}

/// Keys whose `-(--var)` form matches no Tailwind utility.
///
/// The silent half: no rule is generated, so the element is simply unstyled
/// and the class is safelist noise.
fn has_no_var_form(key: &str) -> bool {
    matches!(
        key,
        "alignContent"
            | "appearance"
            | "backface"
            | "bgClip"
            | "bgOrigin"
            | "box"
            | "boxDecoration"
            | "breakAfter"
            | "breakBefore"
            | "breakInside"
            | "caption"
            | "clear"
            | "container"
            | "display"
            | "fieldSizing"
            | "float"
            | "fontSmoothing"
            | "fontStyle"
            | "fontVariant"
            | "forcedColorAdjust"
            | "gridFlow"
            | "isolation"
            | "items"
            | "justify"
            | "justifyItems"
            | "justifySelf"
            | "maskClip"
            | "maskComposite"
            | "maskConic"
            | "maskLinear"
            | "maskMode"
            | "maskOrigin"
            | "maskRepeat"
            | "maskType"
            | "mixBlend"
            | "notSrOnly"
            | "ordinal"
            | "overflow"
            | "overflowX"
            | "overflowY"
            | "overscroll"
            | "overscrollX"
            | "overscrollY"
            | "placeContent"
            | "placeItems"
            | "placeSelf"
            | "pointerEvents"
            | "position"
            | "resize"
            | "scheme"
            | "scroll"
            | "scrollbar"
            | "scrollbarGutter"
            | "select"
            | "self"
            | "slashedZero"
            | "snapAlign"
            | "snapStop"
            | "snapType"
            | "srOnly"
            | "tableLayout"
            | "textClip"
            | "textEllipsis"
            | "touch"
            | "visibility"
            | "whitespace"
    )
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
