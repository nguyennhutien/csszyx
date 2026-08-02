//! szv per-key precompile — Rust mirror of `szv-precompile.ts`.
//!
//! The decision spec lives in the TypeScript module; this file re-implements
//! the pure halves — canonical-overlap detection, table compilation, the
//! static pick, JSON serialization, reference accounting — over the native
//! IR types. The cross-engine suite locks every verdict to the JS lanes: a
//! `build.parser` flip must not change the emitted code.

#![allow(clippy::redundant_pub_crate)]

use super::generated::tables::{is_known_variant, property_prefix};
use super::ir::{StaticSzObject, StaticSzValue};
use super::lower::lower_static_sz_object;

/// A compiled szv table: dimension and value order preserved from the config,
/// because both the serializer and the pick iterate in declaration order.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SzvTable {
    /// Compiled `base` classes (empty when the config had none).
    pub base: String,
    /// Compiled variant leaves, in config order.
    pub dimensions: Vec<(String, Vec<(String, String)>)>,
    /// Normalized `defaultVariants`, in config order; None when absent.
    pub defaults: Option<Vec<(String, String)>>,
}

/// One statically resolved config, branches still as IR objects.
pub(crate) struct StaticSzvConfig {
    pub base: Option<StaticSzObject>,
    /// dimension → (value → leaf), in declaration order.
    pub variants: Vec<(String, Vec<(String, StaticSzObject)>)>,
    /// Normalized defaults, in declaration order.
    pub defaults: Option<Vec<(String, String)>>,
}

/// True for a canonical array-index key: the exact decimal form of a uint32
/// below 2^32 − 1. JavaScript iterates these FIRST and in ascending order on
/// any object, regardless of declaration order.
fn is_array_index_like(key: &str) -> bool {
    if key.is_empty() || (key.len() > 1 && key.starts_with('0')) {
        return false;
    }
    if !key.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    key.parse::<u64>().is_ok_and(|value| value < 4_294_967_295)
}

/// Reorder entries the way JavaScript iterates object keys: array-index-like
/// keys ascending first, then the rest in insertion order.
///
/// The JS lanes build their tables from plain objects, so `Object.keys` has
/// already applied this rule before any table exists — a config declaring
/// `{ pad: …, '2': … }` iterates as `['2', 'pad']` there. Without this mirror
/// the native engine kept source order and emitted the same classes in a
/// different sequence, which a `build.parser` flip must never do.
fn js_object_key_order<T>(entries: Vec<(String, T)>) -> Vec<(String, T)> {
    let mut indexed: Vec<(String, T)> = Vec::new();
    let mut rest: Vec<(String, T)> = Vec::new();
    for entry in entries {
        if is_array_index_like(&entry.0) {
            indexed.push(entry);
        } else {
            rest.push(entry);
        }
    }
    indexed.sort_by_key(|(key, _)| key.parse::<u64>().unwrap_or(u64::MAX));
    indexed.extend(rest);
    indexed
}

/// Extract and validate a config from the szv argument's static object.
///
/// Mirrors `qualifyStaticSzvConfig` shape rules: only
/// `base`/`variants`/`defaultVariants` keys, records of records of objects for
/// the variants, string/boolean/safe-integer defaults. Overlap is checked
/// separately so the two failure modes stay distinguishable in tests.
pub(crate) fn static_szv_config_from_object(object: &StaticSzObject) -> Option<StaticSzvConfig> {
    let mut base: Option<StaticSzObject> = None;
    let mut variants: Vec<(String, Vec<(String, StaticSzObject)>)> = Vec::new();
    let mut defaults: Option<Vec<(String, String)>> = None;
    for property in &object.properties {
        match property.key.as_str() {
            "base" => match &property.value {
                StaticSzValue::Object(value) => base = Some(value.clone()),
                _ => return None,
            },
            "variants" => {
                let StaticSzValue::Object(dimensions) = &property.value else {
                    return None;
                };
                for dimension in &dimensions.properties {
                    let StaticSzValue::Object(values) = &dimension.value else {
                        return None;
                    };
                    let mut leaves: Vec<(String, StaticSzObject)> = Vec::new();
                    for value in &values.properties {
                        let StaticSzValue::Object(leaf) = &value.value else {
                            return None;
                        };
                        leaves.push((value.key.clone(), leaf.clone()));
                    }
                    variants.push((dimension.key.clone(), leaves));
                }
            }
            "defaultVariants" => {
                let StaticSzValue::Object(entries) = &property.value else {
                    return None;
                };
                let mut normalized: Vec<(String, String)> = Vec::new();
                for entry in &entries.properties {
                    let text = parity_safe_scalar_string(&entry.value)?;
                    normalized.push((entry.key.clone(), text));
                }
                defaults = Some(normalized);
            }
            _ => return None,
        }
    }
    Some(StaticSzvConfig {
        base,
        variants: js_object_key_order(
            variants
                .into_iter()
                .map(|(dimension, leaves)| (dimension, js_object_key_order(leaves)))
                .collect(),
        ),
        defaults: defaults.map(js_object_key_order),
    })
}

/// `String(value)` for the tri-lane static contract: strings and booleans as
/// is, numbers only when they are safe integers (float formatting differs
/// between languages, so anything else disqualifies on every lane).
pub(crate) fn parity_safe_scalar_string(value: &StaticSzValue) -> Option<String> {
    match value {
        StaticSzValue::String(text) => Some(text.clone()),
        StaticSzValue::Boolean(flag) => Some(flag.to_string()),
        StaticSzValue::Number(number) => {
            if number.fract() == 0.0 && number.abs() <= 9_007_199_254_740_991.0 {
                #[allow(clippy::cast_possible_truncation)]
                Some(format!("{}", *number as i64))
            } else {
                None
            }
        }
        StaticSzValue::Object(_) => None,
    }
}

/// Canonical name for one sz key — fusion families collapse to a shared
/// token, everything else stands for its own NAME: deep merge collapses by
/// key name, so a prefix-based canon would only manufacture false conflicts
/// (`flexDir` and `flexWrap` both emit `flex-*` yet never collapse).
/// Mirrors `canonicalSzKey`.
fn canonical_sz_key(key: &str) -> &str {
    match key {
        "text" | "leading" | "lineHeight" => "text\u{0}leading",
        _ => key,
    }
}

/// Collect every canonical LEAF path of one branch, `' '`-joined.
fn collect_canonical_leaf_paths(branch: &StaticSzObject, prefix: &str, out: &mut Vec<String>) {
    for property in &branch.properties {
        let canon = canonical_sz_key(&property.key);
        let path = if prefix.is_empty() {
            canon.to_string()
        } else {
            format!("{prefix}\u{0}{canon}")
        };
        match &property.value {
            // A nested object under a PROPERTY key is a fusion unit (the
            // color-opacity form lowers to ONE composite class): fold the
            // subtree to the parent path. Variant keys keep composing.
            StaticSzValue::Object(nested) => {
                if property_prefix(&property.key).is_some() {
                    out.push(path);
                } else {
                    collect_canonical_leaf_paths(nested, &path, out);
                }
            }
            _ => out.push(path),
        }
    }
}

/// Whether `long` extends `short` by at least one NUL-joined segment — the
/// allocation-free form of `long.starts_with(&format!("{short}\u{0}"))`, which
/// built two heap Strings per pair inside the overlap detector's innermost
/// loop.
fn extends_leaf_path(long: &str, short: &str) -> bool {
    long.len() > short.len() && long.as_bytes()[short.len()] == 0 && long.starts_with(short)
}

/// Whether two branches conflict under deep merge (equal paths, or one leaf
/// path prefixing the other). Mirrors `leafPathsConflict`.
fn leaf_paths_conflict(a: &[String], b: &[String]) -> bool {
    for path_a in a {
        for path_b in b {
            if path_a == path_b
                || extends_leaf_path(path_a, path_b)
                || extends_leaf_path(path_b, path_a)
            {
                return true;
            }
        }
    }
    false
}

/// Whether every key in a branch is canonicalizable — a property-map entry or
/// a known variant. Mirrors `branchKeysCanonicalizable`: anything else (a
/// special-cased property like `lineHeight`, a flag utility, a custom theme
/// variant) could alias another key's target invisibly, so its config bails.
/// Special-cased property keys outside the property map, verified
/// fusion-free. Mirrors `SPECIAL_ALLOWED_SZ_KEYS`.
const SPECIAL_ALLOWED_SZ_KEYS: [&str; 4] =
    ["alignContent", "snapType", "snapAlign", "snapStrictness"];

fn branch_keys_canonicalizable(branch: &StaticSzObject) -> bool {
    for property in &branch.properties {
        // `op` fuses into whichever color-bearing key it meets at lowering;
        // per-key compilation cannot represent that.
        if property.key == "op" {
            return false;
        }
        // The `css` escape hatch is a NAMESPACE: each child is an arbitrary
        // CSS property emitting its own class. One level only. Mirrors the
        // TypeScript walk.
        if property.key == "css" {
            if let StaticSzValue::Object(declarations) = &property.value {
                if declarations
                    .properties
                    .iter()
                    .any(|declaration| matches!(declaration.value, StaticSzValue::Object(_)))
                {
                    return false;
                }
                continue;
            }
        }
        if property_prefix(&property.key).is_none()
            && !is_known_variant(&property.key)
            && !SPECIAL_ALLOWED_SZ_KEYS.contains(&property.key.as_str())
        {
            return false;
        }
        if let StaticSzValue::Object(nested) = &property.value {
            if !branch_keys_canonicalizable(nested) {
                return false;
            }
        }
    }
    true
}

/// Whether the config's co-occurring branches are free of canonical overlap.
/// Mirrors `szvConfigFreeOfOverlap`.
pub(crate) fn szv_config_free_of_overlap(config: &StaticSzvConfig) -> bool {
    if let Some(base) = &config.base {
        if !branch_keys_canonicalizable(base) {
            return false;
        }
    }
    for (_, leaves) in &config.variants {
        for (_, leaf) in leaves {
            if !branch_keys_canonicalizable(leaf) {
                return false;
            }
        }
    }
    let mut base_paths: Vec<String> = Vec::new();
    if let Some(base) = &config.base {
        collect_canonical_leaf_paths(base, "", &mut base_paths);
    }
    let per_dimension: Vec<Vec<Vec<String>>> = config
        .variants
        .iter()
        .map(|(_, leaves)| {
            leaves
                .iter()
                .map(|(_, leaf)| {
                    let mut paths = Vec::new();
                    collect_canonical_leaf_paths(leaf, "", &mut paths);
                    paths
                })
                .collect()
        })
        .collect();

    for dimension in &per_dimension {
        for leaf in dimension {
            if leaf_paths_conflict(&base_paths, leaf) {
                return false;
            }
        }
    }
    for i in 0..per_dimension.len() {
        for j in (i + 1)..per_dimension.len() {
            for leaf_a in &per_dimension[i] {
                for leaf_b in &per_dimension[j] {
                    if leaf_paths_conflict(leaf_a, leaf_b) {
                        return false;
                    }
                }
            }
        }
    }
    true
}

/// Compile a validated, overlap-free config into its table.
pub(crate) fn compile_szv_table(config: &StaticSzvConfig) -> SzvTable {
    let base = config
        .base
        .as_ref()
        .map(|object| lower_static_sz_object(object).join(" "))
        .unwrap_or_default();
    let dimensions = config
        .variants
        .iter()
        .map(|(dimension, leaves)| {
            (
                dimension.clone(),
                leaves
                    .iter()
                    .map(|(value, leaf)| (value.clone(), lower_static_sz_object(leaf).join(" ")))
                    .collect(),
            )
        })
        .collect();
    SzvTable {
        base,
        dimensions,
        defaults: config.defaults.clone(),
    }
}

/// One static selection entry (string/boolean/safe-integer, pre-stringified).
pub(crate) type StaticSelection = Vec<(String, String)>;

/// What `__szvPick(table, selection)` returns for a static selection.
/// Mirrors `computeStaticSzvPick` (with the tri-lane restriction, a selection
/// value can no longer be nullish, so the default only fills ABSENT keys).
pub(crate) fn compute_static_szv_pick(
    table: &SzvTable,
    selection: Option<&StaticSelection>,
) -> String {
    let mut result = table.base.clone();
    for (dimension, values) in &table.dimensions {
        let selected = selection
            .and_then(|entries| entries.iter().find(|(key, _)| key == dimension))
            .map(|(_, value)| value.clone());
        let value = selected.or_else(|| {
            table.defaults.as_ref().and_then(|defaults| {
                defaults
                    .iter()
                    .find(|(key, _)| key == dimension)
                    .map(|(_, value)| value.clone())
            })
        });
        let Some(value) = value else { continue };
        let Some((_, classes)) = values.iter().find(|(key, _)| key == &value) else {
            continue;
        };
        if !classes.is_empty() {
            if result.is_empty() {
                result.clone_from(classes);
            } else {
                result.push(' ');
                result.push_str(classes);
            }
        }
    }
    result
}

/// Escape one string for a JSON literal, byte-compatible with
/// `JSON.stringify` (control characters escaped, unicode kept raw).
fn json_escape_into(out: &mut String, text: &str) {
    out.push('"');
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => {
                use std::fmt::Write as _;
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// A JSON string literal for one value — the replacement text for a static
/// pick, matching `JSON.stringify(value)` in the JS lanes.
pub(crate) fn json_string_literal(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    json_escape_into(&mut out, text);
    out
}

/// Serialize the emitted table constant, mirroring `serializeSzvTable`
/// (`JSON.stringify` of `{base, d, defaults?}` in declaration order).
pub(crate) fn serialize_szv_table(table: &SzvTable) -> String {
    let mut out = String::from("{\"base\":");
    json_escape_into(&mut out, &table.base);
    out.push_str(",\"d\":{");
    for (index, (dimension, values)) in table.dimensions.iter().enumerate() {
        if index > 0 {
            out.push(',');
        }
        json_escape_into(&mut out, dimension);
        out.push_str(":{");
        for (value_index, (value, classes)) in values.iter().enumerate() {
            if value_index > 0 {
                out.push(',');
            }
            json_escape_into(&mut out, value);
            out.push(':');
            json_escape_into(&mut out, classes);
        }
        out.push('}');
    }
    out.push('}');
    if let Some(defaults) = &table.defaults {
        if !defaults.is_empty() {
            out.push_str(",\"defaults\":{");
            for (index, (dimension, value)) in defaults.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                json_escape_into(&mut out, dimension);
                out.push(':');
                json_escape_into(&mut out, value);
            }
            out.push('}');
        }
    }
    out.push('}');
    out
}

/// Count word-boundary occurrences of an identifier in raw source, mirroring
/// `countWordOccurrences` (ASCII identifier boundaries; non-ASCII neighbours
/// count, which overcounts and can only suppress a rewrite).
pub(crate) fn count_word_occurrences(source: &str, word: &str) -> usize {
    if word.is_empty() {
        return 0;
    }
    let bytes = source.as_bytes();
    let needle = word.as_bytes();
    let mut count = 0;
    let mut at = 0;
    while at + needle.len() <= bytes.len() {
        if &bytes[at..at + needle.len()] == needle {
            let before_ok = at == 0 || !is_identifier_byte(bytes[at - 1]);
            let after_end = at + needle.len();
            let after_ok = after_end == bytes.len() || !is_identifier_byte(bytes[after_end]);
            if before_ok && after_ok {
                count += 1;
            }
            at += needle.len();
        } else {
            at += 1;
        }
    }
    count
}

/// True when the byte continues an ASCII identifier.
const fn is_identifier_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$'
}

/// One decoded cross-module registry: specifier → (exported name → config).
pub(crate) type CrossModuleStatics = Vec<(String, Vec<(String, StaticSzObject)>)>;

/// Decode the ordered cross-module payload the bundler serialized.
///
/// The transport is generic ordered pairs — arrays survive every JSON library
/// with order intact, where a map would be re-sorted. Anything malformed
/// decodes to nothing: a missing registry entry only costs the optimization.
pub(crate) fn decode_cross_module_statics(json: &str) -> CrossModuleStatics {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(json) else {
        return Vec::new();
    };
    let Some(specifiers) = value.as_array() else {
        return Vec::new();
    };
    let mut out: CrossModuleStatics = Vec::new();
    for specifier_entry in specifiers {
        let Some([specifier, names]) = specifier_entry.as_array().map(Vec::as_slice) else {
            continue;
        };
        let (Some(specifier), Some(names)) = (specifier.as_str(), names.as_array()) else {
            continue;
        };
        let mut decoded_names: Vec<(String, StaticSzObject)> = Vec::new();
        for name_entry in names {
            let Some([name, config]) = name_entry.as_array().map(Vec::as_slice) else {
                continue;
            };
            let (Some(name), Some(config)) = (name.as_str(), decode_ordered_object(config)) else {
                continue;
            };
            decoded_names.push((name.to_string(), config));
        }
        if !decoded_names.is_empty() {
            out.push((specifier.to_string(), decoded_names));
        }
    }
    out
}

/// Decode one ordered object: an array of `[key, value]` pairs.
fn decode_ordered_object(value: &serde_json::Value) -> Option<StaticSzObject> {
    let pairs = value.as_array()?;
    let mut properties = Vec::with_capacity(pairs.len());
    for pair in pairs {
        let Some([key, entry_value]) = pair.as_array().map(Vec::as_slice) else {
            return None;
        };
        let key = key.as_str()?;
        let decoded = decode_ordered_value(entry_value)?;
        properties.push(super::ir::StaticSzProperty {
            key: key.to_string(),
            value: decoded,
            span: super::TextSpan { start: 0, end: 0 },
        });
    }
    Some(StaticSzObject { properties })
}

/// Decode one ordered value: scalar, or a nested ordered object.
fn decode_ordered_value(value: &serde_json::Value) -> Option<StaticSzValue> {
    match value {
        serde_json::Value::String(text) => Some(StaticSzValue::String(text.clone())),
        serde_json::Value::Bool(flag) => Some(StaticSzValue::Boolean(*flag)),
        serde_json::Value::Number(number) => number.as_f64().map(StaticSzValue::Number),
        serde_json::Value::Array(_) => decode_ordered_object(value).map(StaticSzValue::Object),
        _ => None,
    }
}

/// Name of the emitted table constant, mirroring `szvTableIdentifier`.
pub(crate) fn szv_table_identifier(factory_name: &str) -> String {
    format!("__szvT_{factory_name}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transform::ir::StaticSzProperty;
    use crate::transform::TextSpan;

    fn entry(key: &str, value: StaticSzValue) -> StaticSzProperty {
        StaticSzProperty {
            key: key.to_string(),
            value,
            span: TextSpan { start: 0, end: 0 },
        }
    }

    fn object(entries: Vec<StaticSzProperty>) -> StaticSzObject {
        StaticSzObject {
            properties: entries,
        }
    }

    fn text(value: &str) -> StaticSzValue {
        StaticSzValue::String(value.to_string())
    }

    fn number(value: f64) -> StaticSzValue {
        StaticSzValue::Number(value)
    }

    fn nested(entries: Vec<StaticSzProperty>) -> StaticSzValue {
        StaticSzValue::Object(object(entries))
    }

    /// Qualify through the same entry point the parser uses, so every unit
    /// below exercises the productized path, not a hand-built config.
    fn config_from(entries: Vec<StaticSzProperty>) -> Option<StaticSzvConfig> {
        static_szv_config_from_object(&object(entries))
    }

    fn paths_of(branch: &StaticSzObject) -> Vec<String> {
        let mut out = Vec::new();
        collect_canonical_leaf_paths(branch, "", &mut out);
        out
    }

    #[test]
    fn collects_canonical_leaf_paths_through_nesting() {
        let branch = object(vec![
            entry("md", nested(vec![entry("p", number(4.0))])),
            entry("bg", text("red-500")),
        ]);
        assert_eq!(paths_of(&branch), ["md\u{0}p", "bg"]);
    }

    #[test]
    fn property_key_subtrees_fold_to_the_parent_path() {
        let branch = object(vec![entry(
            "bg",
            nested(vec![
                entry("color", text("red-500")),
                entry("op", number(50.0)),
            ]),
        )]);
        assert_eq!(paths_of(&branch), ["bg"]);
    }

    #[test]
    fn flags_equal_prefix_and_suffix_conflicts_only() {
        let path = |value: &str| vec![value.to_string()];
        assert!(leaf_paths_conflict(&path("p"), &path("p")));
        assert!(leaf_paths_conflict(&path("md"), &path("md\u{0}p")));
        assert!(leaf_paths_conflict(&path("md\u{0}p"), &path("md")));
        assert!(!leaf_paths_conflict(&path("md\u{0}p"), &path("md\u{0}m")));
        assert!(!leaf_paths_conflict(&path("p"), &path("md\u{0}p")));
    }

    #[test]
    fn same_dimension_leaves_never_conflict() {
        let config = config_from(vec![entry(
            "variants",
            nested(vec![entry(
                "pad",
                nested(vec![
                    entry("sm", nested(vec![entry("p", number(2.0))])),
                    entry("lg", nested(vec![entry("p", number(8.0))])),
                ]),
            )]),
        )])
        .expect("well-shaped config qualifies");
        assert!(szv_config_free_of_overlap(&config));
    }

    #[test]
    fn cross_dimension_overlap_disqualifies() {
        let config = config_from(vec![entry(
            "variants",
            nested(vec![
                entry(
                    "pad",
                    nested(vec![entry("sm", nested(vec![entry("p", number(2.0))]))]),
                ),
                entry(
                    "space",
                    nested(vec![entry("a", nested(vec![entry("p", number(4.0))]))]),
                ),
            ]),
        )])
        .expect("well-shaped config qualifies");
        assert!(!szv_config_free_of_overlap(&config));

        let base_overlap = config_from(vec![
            entry("base", nested(vec![entry("p", number(1.0))])),
            entry(
                "variants",
                nested(vec![entry(
                    "pad",
                    nested(vec![entry("sm", nested(vec![entry("p", number(2.0))]))]),
                )]),
            ),
        ])
        .expect("well-shaped config qualifies");
        assert!(!szv_config_free_of_overlap(&base_overlap));
    }

    #[test]
    fn qualification_rejects_unknown_keys_and_non_record_shapes() {
        assert!(config_from(vec![entry("base", text("p-2"))]).is_none());
        assert!(config_from(vec![entry("variants", text("invalid"))]).is_none());
        assert!(config_from(vec![entry(
            "variants",
            nested(vec![entry("pad", text("invalid"))]),
        )])
        .is_none());
        assert!(config_from(vec![
            entry("variants", nested(Vec::new())),
            entry("compoundVariants", text("unsupported")),
        ])
        .is_none());
        assert!(config_from(vec![entry(
            "variants",
            nested(vec![entry("pad", nested(vec![entry("sm", text("p-2"))]))]),
        )])
        .is_none());
        assert!(config_from(vec![entry(
            "defaultVariants",
            nested(vec![entry("pad", number(2.5))]),
        )])
        .is_none());
        assert!(config_from(vec![entry("defaultVariants", text("invalid"))]).is_none());
        assert!(parity_safe_scalar_string(&nested(Vec::new())).is_none());
    }

    #[test]
    fn op_modifier_disqualifies_any_branch() {
        let config = config_from(vec![entry(
            "variants",
            nested(vec![entry(
                "tone",
                nested(vec![entry("a", nested(vec![entry("op", number(50.0))]))]),
            )]),
        )])
        .expect("shape qualifies; overlap is the separate verdict");
        assert!(!szv_config_free_of_overlap(&config));
    }

    #[test]
    fn css_namespace_allows_one_level_and_rejects_deeper_nesting() {
        let flat = config_from(vec![entry(
            "base",
            nested(vec![entry("css", nested(vec![entry("--x", text("1px"))]))]),
        )])
        .expect("shape qualifies");
        assert!(szv_config_free_of_overlap(&flat));

        let deep = config_from(vec![entry(
            "base",
            nested(vec![entry(
                "css",
                nested(vec![entry(
                    "sel",
                    nested(vec![entry("color", text("red"))]),
                )]),
            )]),
        )])
        .expect("shape qualifies");
        assert!(!szv_config_free_of_overlap(&deep));

        let scalar_css = config_from(vec![entry(
            "base",
            nested(vec![entry("css", text("invalid"))]),
        )])
        .expect("shape qualifies");
        assert!(!szv_config_free_of_overlap(&scalar_css));
    }

    #[test]
    fn fusion_family_conflicts_across_dimensions() {
        let config = config_from(vec![entry(
            "variants",
            nested(vec![
                entry(
                    "size",
                    nested(vec![entry("a", nested(vec![entry("text", text("lg"))]))]),
                ),
                entry(
                    "line",
                    nested(vec![entry("b", nested(vec![entry("leading", text("7"))]))]),
                ),
            ]),
        )])
        .expect("well-shaped config qualifies");
        assert!(!szv_config_free_of_overlap(&config));
    }

    #[test]
    fn parity_safe_scalars_stringify_like_the_js_lanes() {
        assert_eq!(
            parity_safe_scalar_string(&text("primary")).as_deref(),
            Some("primary")
        );
        assert_eq!(
            parity_safe_scalar_string(&StaticSzValue::Boolean(true)).as_deref(),
            Some("true")
        );
        assert_eq!(
            parity_safe_scalar_string(&number(4.0)).as_deref(),
            Some("4")
        );
        assert_eq!(
            parity_safe_scalar_string(&number(-3.0)).as_deref(),
            Some("-3")
        );
        assert_eq!(parity_safe_scalar_string(&number(2.5)), None);
        assert_eq!(
            parity_safe_scalar_string(&number(9_007_199_254_740_992.0)),
            None
        );
    }

    #[test]
    fn integer_like_keys_follow_js_iteration_order() {
        assert!(is_array_index_like("0"));
        assert!(is_array_index_like("4294967294"));
        assert!(!is_array_index_like("4294967295"));
        assert!(!is_array_index_like("01"));
        assert!(!is_array_index_like(""));

        let config = config_from(vec![entry(
            "variants",
            nested(vec![
                entry(
                    "pad",
                    nested(vec![entry("sm", nested(vec![entry("p", number(2.0))]))]),
                ),
                entry(
                    "10",
                    nested(vec![entry("a", nested(vec![entry("m", number(1.0))]))]),
                ),
                entry(
                    "2",
                    nested(vec![entry("b", nested(vec![entry("gap", number(2.0))]))]),
                ),
            ]),
        )])
        .expect("well-shaped config qualifies");
        let dimensions: Vec<&str> = config
            .variants
            .iter()
            .map(|(dimension, _)| dimension.as_str())
            .collect();
        assert_eq!(dimensions, ["2", "10", "pad"]);
    }

    fn compiled_tone_table() -> SzvTable {
        let config = config_from(vec![
            entry("base", nested(vec![entry("p", number(2.0))])),
            entry(
                "variants",
                nested(vec![entry(
                    "tone",
                    nested(vec![entry(
                        "primary",
                        nested(vec![entry("bg", text("blue-500"))]),
                    )]),
                )]),
            ),
            entry(
                "defaultVariants",
                nested(vec![entry("tone", text("primary"))]),
            ),
        ])
        .expect("well-shaped config qualifies");
        compile_szv_table(&config)
    }

    #[test]
    fn static_pick_fills_absent_keys_and_skips_unknown_values() {
        let table = compiled_tone_table();
        assert_eq!(compute_static_szv_pick(&table, None), "p-2 bg-blue-500");
        let explicit: StaticSelection = vec![("tone".to_string(), "primary".to_string())];
        assert_eq!(
            compute_static_szv_pick(&table, Some(&explicit)),
            "p-2 bg-blue-500"
        );
        // A present key with an unknown value neither matches nor falls back
        // to the default: the entry is simply skipped.
        let unknown: StaticSelection = vec![("tone".to_string(), "nope".to_string())];
        assert_eq!(compute_static_szv_pick(&table, Some(&unknown)), "p-2");

        let table = SzvTable {
            base: String::new(),
            dimensions: vec![
                ("a".into(), vec![("on".into(), "p-2".into())]),
                ("b".into(), vec![("off".into(), String::new())]),
            ],
            defaults: None,
        };
        let selection = vec![("a".into(), "on".into()), ("b".into(), "off".into())];
        assert_eq!(compute_static_szv_pick(&table, Some(&selection)), "p-2");
    }

    #[test]
    fn serialized_table_matches_json_stringify() {
        assert_eq!(
            serialize_szv_table(&compiled_tone_table()),
            r#"{"base":"p-2","d":{"tone":{"primary":"bg-blue-500"}},"defaults":{"tone":"primary"}}"#
        );
        assert_eq!(json_string_literal("a\u{0}b\n"), r#""a\u0000b\n""#);
        assert_eq!(
            json_string_literal("\"\\\r\t\u{8}\u{c}\u{1}"),
            r#""\"\\\r\t\b\f\u0001""#
        );
        let table = SzvTable {
            base: String::new(),
            dimensions: Vec::new(),
            defaults: Some(vec![("a".into(), "1".into()), ("b".into(), "2".into())]),
        };
        assert_eq!(
            serialize_szv_table(&table),
            r#"{"base":"","d":{},"defaults":{"a":"1","b":"2"}}"#
        );
        let no_defaults = SzvTable {
            defaults: Some(Vec::new()),
            ..table
        };
        assert_eq!(serialize_szv_table(&no_defaults), r#"{"base":"","d":{}}"#);
    }

    #[test]
    fn cross_module_decode_tolerates_malformed_payloads() {
        assert!(decode_cross_module_statics("not json").is_empty());
        assert!(decode_cross_module_statics("{}").is_empty());
        assert!(decode_cross_module_statics(r#"[["./styles",[["cardSz","scalar"]]]]"#).is_empty());
        for malformed in [
            r#"["bad-entry"]"#,
            r"[[1,[]]]",
            r#"[["./styles",["bad-name-entry"]]]"#,
            r#"[["./styles",[[1,[]]]]]"#,
            r#"[["./styles",[["cardSz",[[1,true]]]]]]"#,
            r#"[["./styles",[["cardSz",[["base",null]]]]]]"#,
            r#"[["./styles",[["cardSz",[["base",["bad-pair"]]]]]]]"#,
        ] {
            assert!(
                decode_cross_module_statics(malformed).is_empty(),
                "{malformed}"
            );
        }

        let decoded =
            decode_cross_module_statics(r#"[["./styles",[["cardSz",[["base",[["p",4]]]]]]]]"#);
        assert_eq!(decoded.len(), 1);
        assert_eq!(decoded[0].0, "./styles");
        assert_eq!(decoded[0].1[0].0, "cardSz");
        assert_eq!(decoded[0].1[0].1.properties[0].key, "base");
        let boolean = decode_cross_module_statics(
            r#"[["./styles",[["cardSz",[["base",[["flex",true]]]]]]]]"#,
        );
        assert_eq!(
            boolean[0].1[0].1.properties[0].value,
            nested(vec![entry("flex", StaticSzValue::Boolean(true))])
        );
    }

    #[test]
    fn counts_words_at_identifier_boundaries() {
        assert_eq!(
            count_word_occurrences("cardSz(cardSz2); myCardSz; \"cardSz\"", "cardSz"),
            2
        );
        assert_eq!(count_word_occurrences("", "cardSz"), 0);
        assert_eq!(count_word_occurrences("x", ""), 0);
    }
}
