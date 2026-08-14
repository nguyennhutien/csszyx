//! Generated transform lookup tables.

pub(crate) mod sz_fallback_matrix;
pub(crate) mod tables;

#[cfg(test)]
mod sz_fallback_matrix_tests {
    use super::sz_fallback_matrix::{
        sz_fallback_reason, sz_fallback_suggestion, SzFallbackKind, SZ_FALLBACK_UNKNOWN_CALLEE,
    };

    /// Every kind, so a new variant cannot be added without extending these.
    const ALL_KINDS: [SzFallbackKind; 6] = [
        SzFallbackKind::Call,
        SzFallbackKind::Identifier,
        SzFallbackKind::Import,
        SzFallbackKind::Member,
        SzFallbackKind::Other,
        SzFallbackKind::SzvFactory,
    ];

    #[test]
    fn reasons_carrying_a_detail_substitute_it() {
        assert_eq!(
            sz_fallback_reason(SzFallbackKind::Call, "makeSz", ""),
            "function call `makeSz()` result is unknown at build time"
        );
        assert_eq!(
            sz_fallback_reason(SzFallbackKind::Identifier, "cardSz", ""),
            "identifier `cardSz` could not be resolved to a static value"
        );
        assert_eq!(
            sz_fallback_reason(SzFallbackKind::Other, "ConditionalExpression", ""),
            "expression of type `ConditionalExpression` is not statically analyzable"
        );
    }

    #[test]
    fn a_reason_without_a_placeholder_ignores_the_detail() {
        assert_eq!(
            sz_fallback_reason(SzFallbackKind::Member, "ignored", "ignored"),
            "member expression is not statically resolvable"
        );
    }

    #[test]
    fn no_kind_leaks_the_placeholder() {
        // A brace surviving into output means the generator escaped wrongly and
        // the reader would see `{detail}` in their build log.
        for kind in ALL_KINDS {
            let reason = sz_fallback_reason(kind, "x", "p");
            assert!(!reason.contains("{detail}"), "{reason}");
            assert!(!reason.contains("{path}"), "{reason}");
            assert!(!reason.contains('{'), "{reason}");
            assert!(!reason.contains('}'), "{reason}");
        }
    }

    #[test]
    fn every_kind_points_at_a_concrete_next_step() {
        for kind in ALL_KINDS {
            let suggestion = sz_fallback_suggestion(kind);
            assert!(
                suggestion.contains("szv()") || suggestion.contains("dynamic()"),
                "{suggestion}"
            );
        }
    }

    #[test]
    fn kinds_do_not_share_wording() {
        // Two arms rendering the same text would make the classification
        // pointless and hide a copy-paste slip in the matrix.
        let reasons: Vec<String> = ALL_KINDS
            .iter()
            .map(|kind| sz_fallback_reason(*kind, "detail", "path"))
            .collect();
        for (index, reason) in reasons.iter().enumerate() {
            assert!(
                !reasons[index + 1..].contains(reason),
                "duplicate reason: {reason}"
            );
        }
    }

    #[test]
    fn the_unknown_callee_stand_in_matches_the_typescript_matrix() {
        assert_eq!(SZ_FALLBACK_UNKNOWN_CALLEE, "?");
    }
}

#[cfg(test)]
mod diagnostic_table_tests {
    use super::tables::{key_migration_note, key_suggestion};

    /// The CSS property names the table translates, alias to canonical key.
    const CANONICAL_KEY_SUGGESTIONS: &[(&str, &str)] = &[
        ("backgroundColor", "bg"),
        ("backgroundImage", "bgImg"),
        ("backgroundSize", "bgSize"),
        ("backgroundPosition", "bgPos"),
        ("backgroundRepeat", "bgRepeat"),
        ("bgAttachment", "bgAttach"),
        ("bgImage", "bgImg"),
        ("borderRadius", "rounded"),
        ("borderTopLeftRadius", "roundedTl"),
        ("borderTopRightRadius", "roundedTr"),
        ("borderBottomLeftRadius", "roundedBl"),
        ("borderBottomRightRadius", "roundedBr"),
        ("borderWidth", "border"),
        ("padding", "p"),
        ("paddingTop", "pt"),
        ("paddingRight", "pr"),
        ("paddingBottom", "pb"),
        ("paddingLeft", "pl"),
        ("paddingX", "px"),
        ("paddingY", "py"),
        ("margin", "m"),
        ("marginTop", "mt"),
        ("marginRight", "mr"),
        ("marginBottom", "mb"),
        ("marginLeft", "ml"),
        ("marginX", "mx"),
        ("marginY", "my"),
        ("width", "w"),
        ("height", "h"),
        ("minWidth", "minW"),
        ("maxWidth", "maxW"),
        ("minHeight", "minH"),
        ("maxHeight", "maxH"),
        ("aspectRatio", "aspect"),
        ("boxSizing", "box"),
        ("boxDecorationBreak", "boxDecoration"),
        ("objectPosition", "objectPos"),
        ("zIndex", "z"),
        (
            "font",
            "weight (for font-weight) or fontFamily (for family)",
        ),
        ("fontWeight", "weight"),
        ("fontSize", "text"),
        ("textDecoration", "decoration"),
        ("textDecorationColor", "decorationColor"),
        ("textDecorationStyle", "decorationStyle"),
        ("textDecorationThickness", "decorationThickness"),
        ("textUnderlineOffset", "underlineOffset"),
        ("lineHeight", "leading"),
        ("letterSpacing", "tracking"),
        ("textIndent", "indent"),
        ("verticalAlign", "align"),
        ("wordBreak", "break"),
        ("overflowWrap", "wrap"),
        ("listStyleType", "list"),
        ("listStylePosition", "listPos"),
        ("listStyleImage", "listImg"),
        ("listStyle", "list"),
        ("listPosition", "listPos"),
        ("listImage", "listImg"),
        ("flexBasis", "basis"),
        ("flexDirection", "flexDir"),
        ("flexGrow", "grow"),
        ("flexShrink", "shrink"),
        ("alignItems", "items"),
        ("alignContent", "content"),
        ("alignSelf", "self"),
        ("justifyContent", "justify"),
        ("gridTemplateColumns", "gridCols"),
        ("gridTemplateRows", "gridRows"),
        ("gridColumn", "col"),
        ("gridRow", "row"),
        ("gridAutoFlow", "gridFlow"),
        ("gridAutoColumns", "autoCols"),
        ("gridAutoRows", "autoRows"),
        ("boxShadow", "shadow"),
        ("mixBlendMode", "mixBlend"),
        ("backgroundBlendMode", "bgBlend"),
        ("transitionProperty", "transition"),
        ("transitionDuration", "duration"),
        ("transitionTimingFunction", "ease"),
        ("transitionDelay", "delay"),
        ("animation", "animate"),
        ("transformOrigin", "origin"),
        ("caretColor", "caret"),
        ("accentColor", "accent"),
        ("scrollBehavior", "scroll"),
        ("scrollMargin", "scrollM"),
        ("scrollPadding", "scrollP"),
        ("scrollSnapAlign", "snapAlign"),
        ("scrollSnapStop", "snapStop"),
        ("scrollSnapType", "snapType"),
        ("touchAction", "touch"),
        ("userSelect", "select"),
        ("captionSide", "caption"),
        (
            "scrollbarColor",
            "scrollbarThumb (thumb color) or scrollbarTrack (track color)",
        ),
        ("scrollbarWidth", "scrollbar"),
        ("flexWrapReverse", "flexWrap: 'wrap-reverse'"),
        ("flexNowrap", "flexWrap: 'nowrap'"),
    ];

    /// Every canonical-key suggestion the table offers.
    ///
    /// These strings are the whole value of the unknown-key diagnostic: the
    /// warning fires either way, but without the suggestion it tells an author
    /// their key is wrong and nothing about what to write instead, which for a
    /// name like `borderTopLeftRadius` is the difference between a five-second
    /// fix and a search through the docs. The table is generated, so the entries
    /// are listed here rather than derived from it — an entry that disappears
    /// from the generator must fail here rather than pass by agreeing with
    /// itself.
    #[test]
    fn every_css_property_name_maps_to_its_canonical_key() {
        for (alias, canonical) in CANONICAL_KEY_SUGGESTIONS {
            assert_eq!(
                key_suggestion(alias),
                Some(*canonical),
                "suggestion for {alias}"
            );
        }

        // A key that IS canonical has nothing to suggest, so the lookup must
        // not answer for everything.
        for key in ["p", "bg", "display", "notAKeyAtAll"] {
            assert_eq!(key_suggestion(key), None, "{key}");
        }
    }

    /// Every removed key explains where its feature went.
    ///
    /// A migration note is the only thing standing between an author whose
    /// working code stopped working and a silent no-op. Losing one turns a
    /// removal into an unexplained blank.
    #[test]
    fn every_removed_key_carries_its_migration_note() {
        for (key, note) in [
            ("maskFrom", "the from stop moved into its layer — maskLinear / maskRadial / maskConic take { from }"),
            ("maskTo", "the to stop moved into its layer — maskLinear / maskRadial / maskConic take { to }"),
            ("maskVia", "masks have no via stop in Tailwind — use { from, to } on maskLinear / maskRadial / maskConic"),
            ("maskShape", "the shape keyword moved to maskRadial — { shape: \"circle\" | \"ellipse\" }"),
        ] {
            assert_eq!(key_migration_note(key), Some(note), "note for {key}");
        }

        for key in ["maskLinear", "p", "bg"] {
            assert_eq!(key_migration_note(key), None, "{key}");
        }
    }
}
