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

/// Canonical name for one sz key — aliases collapse through the property
/// table, everything else stands for itself. Mirrors `canonicalSzKey`.
fn canonical_sz_key(key: &str) -> &str {
    property_prefix(key).unwrap_or(key)
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
            StaticSzValue::Object(nested) => collect_canonical_leaf_paths(nested, &path, out),
            _ => out.push(path),
        }
    }
}

/// Whether two branches conflict under deep merge (equal paths, or one leaf
/// path prefixing the other). Mirrors `leafPathsConflict`.
fn leaf_paths_conflict(a: &[String], b: &[String]) -> bool {
    for path_a in a {
        for path_b in b {
            if path_a == path_b
                || path_a.starts_with(&format!("{path_b}\u{0}"))
                || path_b.starts_with(&format!("{path_a}\u{0}"))
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
fn branch_keys_canonicalizable(branch: &StaticSzObject) -> bool {
    for property in &branch.properties {
        if property_prefix(&property.key).is_none() && !is_known_variant(&property.key) {
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
