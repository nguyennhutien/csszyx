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
