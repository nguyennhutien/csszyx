//! Generated transform lookup tables.

pub(crate) mod migrate_tables;
pub(crate) mod reverse_tables;
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
        for key in ["p", "bg", "display", "alignContent", "notAKeyAtAll"] {
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

#[cfg(test)]
mod reverse_tables_tests {
    use super::reverse_tables::{
        reverse_property_key, EXTRA_REVERSE_PREFIXES, REVERSE_PROPERTY_MAP,
    };
    use super::tables::property_prefix;

    /// The TypeScript rendering of the same table, as migrate reads it today.
    ///
    /// Both renderings come out of one generator run, so `pnpm gen:reverse-map
    /// --check` already refuses a stale pair. This reads the TypeScript back in
    /// anyway: the check proves the files match the generator, and this proves
    /// the two files say the same thing to their two readers.
    fn typescript_entries() -> Vec<(String, String)> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../cli/src/migrate/generated/reverse-property-map.ts"
        );
        let source = std::fs::read_to_string(path)
            .expect("the TypeScript reverse map is generated into packages/cli");
        source
            .lines()
            .filter_map(|line| {
                let (key, rest) = line.strip_prefix("    ")?.split_once(": '")?;
                let (value, _) = rest.split_once('\'')?;
                Some((key.trim_matches('\'').to_string(), value.to_string()))
            })
            .collect()
    }

    #[test]
    fn the_rust_table_lists_exactly_what_the_typescript_table_lists() {
        let typescript = typescript_entries();
        let parsed = typescript.len();
        assert!(parsed > 200, "parsed only {parsed} entries");
        let rust: Vec<(String, String)> = REVERSE_PROPERTY_MAP
            .iter()
            .map(|(prefix, key)| (prefix.to_string(), key.to_string()))
            .collect();
        assert_eq!(rust, typescript);
    }

    #[test]
    fn every_listed_prefix_looks_up_to_its_key() {
        for (prefix, key) in REVERSE_PROPERTY_MAP {
            assert_eq!(reverse_property_key(prefix), Some(*key), "{prefix}");
        }
        assert_eq!(reverse_property_key("not-a-prefix"), None);
        assert_eq!(reverse_property_key(""), None);
    }

    /// The inversion is only right if the forward table lowers the chosen key
    /// back to the prefix. The extras are exactly the prefixes the forward
    /// table cannot reach, so for those the same lookup must disagree.
    #[test]
    fn every_inverted_prefix_is_what_the_forward_table_lowers_its_key_to() {
        assert!(!EXTRA_REVERSE_PREFIXES.is_empty());
        for (prefix, key) in REVERSE_PROPERTY_MAP {
            if EXTRA_REVERSE_PREFIXES.contains(prefix) {
                assert_ne!(
                    property_prefix(key),
                    Some(*prefix),
                    "{prefix} is not an extra"
                );
            } else {
                assert_eq!(property_prefix(key), Some(*prefix), "{prefix} -> {key}");
            }
        }
        for prefix in EXTRA_REVERSE_PREFIXES {
            assert!(
                REVERSE_PROPERTY_MAP
                    .iter()
                    .any(|(listed, _)| listed == prefix),
                "extra {prefix} is missing from the table"
            );
        }
    }

    #[test]
    fn prefixes_are_unique_and_sorted() {
        for pair in REVERSE_PROPERTY_MAP.windows(2) {
            assert!(pair[0].0 < pair[1].0, "{} before {}", pair[0].0, pair[1].0);
        }
    }
}

#[cfg(test)]
mod migrate_tables_tests {
    use std::collections::BTreeMap;

    use super::migrate_tables::{
        boolean_value, reverse_boolean, reverse_variant, BooleanValue, BOOLEAN_VALUE_MAP,
        KNOWN_BREAKPOINTS, KNOWN_VARIANTS, MIGRATE_SETS, REVERSE_BOOLEAN_MAP, REVERSE_VARIANT_MAP,
        SORTED_PREFIXES,
    };
    use super::reverse_tables::REVERSE_PROPERTY_MAP;
    use super::tables::is_known_variant;

    /// migrate's hand-written tables, read back from the TypeScript that is
    /// still their source of truth.
    ///
    /// The generator evaluates that module and renders what it finds, so its
    /// `--check` already refuses a stale file. This reads the source text
    /// instead, so the two cannot agree by both being wrong about what the
    /// module evaluates to.
    fn typescript_source() -> String {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../cli/src/migrate/reverse-map.ts"
        );
        std::fs::read_to_string(path).expect("migrate's reverse-map.ts is in packages/cli")
    }

    /// The quoted strings on one line of a table body, in order.
    ///
    /// The module is formatter-owned, so every quote on a line is paired:
    /// the odd segments between quotes are the values.
    fn quoted(line: &str) -> Vec<String> {
        line.split('\'')
            .skip(1)
            .step_by(2)
            .map(str::to_string)
            .collect()
    }

    /// Every `export const NAME = new Set([...])` in the module, spreads
    /// resolved against the sets declared before them.
    fn typescript_sets() -> BTreeMap<String, Vec<String>> {
        let source = typescript_source();
        let mut sets: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut current: Option<(String, Vec<String>)> = None;
        for line in source.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("//") {
                continue;
            }
            if let Some((name, members)) = current.as_mut() {
                if trimmed.starts_with("])") {
                    sets.insert(name.clone(), members.clone());
                    current = None;
                } else if let Some(spread) = trimmed.strip_prefix("...") {
                    let spread = spread.trim_end_matches(',');
                    members.extend(sets[spread].iter().cloned());
                } else {
                    // A Set keeps the first of two equal members.
                    for member in quoted(trimmed) {
                        if !members.contains(&member) {
                            members.push(member);
                        }
                    }
                }
                continue;
            }
            let Some(declaration) = trimmed.strip_prefix("export const ") else {
                continue;
            };
            let Some((name, initializer)) = declaration.split_once(" = new Set([") else {
                continue;
            };
            let members = quoted(initializer);
            if initializer.contains("])") {
                sets.insert(name.to_string(), members);
            } else {
                current = Some((name.to_string(), members));
            }
        }
        sets
    }

    /// The lines of one `export const NAME: ... = {` block, comments dropped.
    fn typescript_block(name: &str) -> Vec<String> {
        let source = typescript_source();
        let start = format!("export const {name}");
        let mut lines = source
            .lines()
            .skip_while(|line| !line.starts_with(&start))
            .skip_while(|line| !line.ends_with("= {"))
            .skip(1)
            .take_while(|line| !line.starts_with("};"))
            .map(|line| line.trim().to_string())
            .filter(|line| !line.starts_with("//"))
            .collect::<Vec<_>>();
        lines.retain(|line| !line.is_empty());
        assert!(!lines.is_empty(), "no block for {name}");
        lines
    }

    /// `key: 'value',` pairs of a string-valued record block.
    fn typescript_string_record(name: &str) -> Vec<(String, String)> {
        typescript_block(name)
            .iter()
            .filter_map(|line| {
                let (key, rest) = line.split_once(": '")?;
                let (value, _) = rest.split_once('\'')?;
                Some((key.trim_matches('\'').to_string(), value.to_string()))
            })
            .collect()
    }

    /// One `'...'`-quoted field of an object literal, if the literal has it.
    fn field(text: &str, field: &str) -> Option<String> {
        let (_, after) = text.split_once(&format!("{field}: '"))?;
        after.split_once('\'').map(|(value, _)| value.to_string())
    }

    #[test]
    fn every_typescript_set_is_rendered_with_the_same_members() {
        let typescript = typescript_sets();
        let parsed = typescript.len();
        assert!(parsed > 20, "parsed only {parsed} sets");
        let rust: BTreeMap<String, Vec<String>> = MIGRATE_SETS
            .iter()
            .map(|(name, members, _)| {
                (
                    name.to_string(),
                    members.iter().map(ToString::to_string).collect(),
                )
            })
            .collect();
        assert_eq!(rust, typescript);
    }

    #[test]
    fn every_set_predicate_accepts_its_members_and_nothing_else() {
        for (name, members, contains) in MIGRATE_SETS {
            for member in *members {
                assert!(contains(member), "{name} should contain {member}");
            }
            assert!(!contains("not-a-member"), "{name}");
            assert!(!contains(""), "{name}");
        }
    }

    #[test]
    fn the_string_records_match_the_typescript_records() {
        let rust = |pairs: &[(&str, &str)]| -> Vec<(String, String)> {
            pairs
                .iter()
                .map(|(key, value)| (key.to_string(), value.to_string()))
                .collect()
        };
        assert_eq!(
            rust(REVERSE_BOOLEAN_MAP),
            typescript_string_record("REVERSE_BOOLEAN_MAP")
        );
        assert_eq!(
            rust(REVERSE_VARIANT_MAP),
            typescript_string_record("REVERSE_VARIANT_MAP")
        );
    }

    #[test]
    fn the_boolean_value_map_matches_the_typescript_record() {
        let mut expected = Vec::new();
        let mut entry = String::new();
        for line in typescript_block("BOOLEAN_VALUE_MAP") {
            entry.push_str(&line);
            entry.push(' ');
            if !line.ends_with("},") {
                continue;
            }
            let (class, object) = entry.split_once(": {").expect("an entry");
            expected.push((
                class.trim().trim_matches('\'').to_string(),
                field(object, "prop").expect("prop"),
                field(object, "value").expect("value"),
                field(object, "cssProperty"),
            ));
            entry.clear();
        }
        let actual: Vec<(String, String, String, Option<String>)> = BOOLEAN_VALUE_MAP
            .iter()
            .map(|(class, entry)| {
                (
                    class.to_string(),
                    entry.prop.to_string(),
                    entry.value.to_string(),
                    entry.css_property.map(str::to_string),
                )
            })
            .collect();
        assert_eq!(actual, expected);
    }

    #[test]
    fn every_record_entry_looks_up_to_its_value() {
        for (class, key) in REVERSE_BOOLEAN_MAP {
            assert_eq!(reverse_boolean(class), Some(*key), "{class}");
        }
        for (variant, key) in REVERSE_VARIANT_MAP {
            assert_eq!(reverse_variant(variant), Some(*key), "{variant}");
        }
        for (class, entry) in BOOLEAN_VALUE_MAP {
            assert_eq!(boolean_value(class), Some(*entry), "{class}");
        }
        assert_eq!(reverse_boolean("not-a-class"), None);
        assert_eq!(reverse_variant("not-a-variant"), None);
        assert_eq!(boolean_value("not-a-class"), None);
        assert_eq!(
            boolean_value("antialiased"),
            Some(BooleanValue {
                prop: "fontSmoothing",
                value: "grayscale",
                css_property: Some("font-smoothing"),
            })
        );
        assert_eq!(
            boolean_value("snap-x"),
            Some(BooleanValue {
                prop: "snapType",
                value: "x",
                css_property: None
            })
        );
    }

    /// Longest-prefix matching only works if the longer prefix is tried
    /// first: `border-t` must win over `border` for `border-t-2`.
    #[test]
    fn sorted_prefixes_are_the_reverse_map_prefixes_longest_first() {
        let mut expected: Vec<&str> = REVERSE_PROPERTY_MAP
            .iter()
            .map(|(prefix, _)| *prefix)
            .collect();
        expected.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
        assert_eq!(SORTED_PREFIXES, expected.as_slice());
    }

    /// migrate must not write a variant the compiler would then reject.
    #[test]
    fn migrate_only_knows_variants_the_compiler_accepts() {
        for variant in KNOWN_VARIANTS {
            assert!(is_known_variant(variant), "{variant}");
        }
        for breakpoint in KNOWN_BREAKPOINTS {
            assert!(KNOWN_VARIANTS.contains(breakpoint), "{breakpoint}");
        }
    }
}
