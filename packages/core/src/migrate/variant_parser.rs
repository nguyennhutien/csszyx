//! A whole `className` to one sz object.
//!
//! Each token splits into its variant chain and base class; the base class
//! goes through the class parser, the variants become the keys the value
//! nests under. Two classes that set the same CSS property in the same
//! variant scope — `block flex` — cannot both be right, so the conversion
//! refuses both and leaves them in `className` rather than picking one. A
//! migration-resolution map, when given, answers for a token before the
//! parser is asked.

use std::collections::{HashMap, HashSet};

use super::class_parser::{find_top_level_slash, parse_class};
use super::class_rules::wrapped;
use super::value::{is_js_whitespace, SzObject, SzValue};
use crate::transform::generated::migrate_tables::reverse_variant;

/// What a `className` converts to.
///
/// Serialised because the class-level question crosses both engine
/// boundaries: the corpus round-trip, the per-key matrix and the sz golden
/// ask what a class becomes, and read the answer as JSON.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversion {
    /// The merged sz object.
    pub sz_object: SzObject,
    /// Tokens migrate could not convert, to stay in `className`.
    pub unrecognized: Vec<String>,
    /// Tokens the resolution map said to keep in `className`.
    pub keep_in_class_name: Vec<String>,
}

/// Keep the token in `className`, acknowledged.
pub const TODO_KEEP: &str = "sz:keep";
/// Omit the token from the output entirely.
pub const TODO_REMOVE: &str = "sz:remove";
/// Not decided yet; the token stays unrecognised.
pub const TODO_PENDING: &str = "sz:todo";

/// The class tokens of a `className`, split on JavaScript's whitespace.
pub fn tokenize(class_name: &str) -> Vec<&str> {
    class_name
        .split(is_js_whitespace)
        .filter(|token| !token.is_empty())
        .collect()
}

/// A token's variant chain and base class: `group-hover/sidebar:md:text-white`
/// is `[group-hover/sidebar, md]` and `text-white`. A colon inside brackets
/// or parens does not split.
pub fn extract_variants(token: &str) -> (Vec<&str>, &str) {
    let mut parts = Vec::new();
    let mut depth = 0_i32;
    let mut start = 0;
    for (index, character) in token.char_indices() {
        match character {
            '[' | '(' => depth += 1,
            ']' | ')' => depth -= 1,
            ':' if depth == 0 => {
                parts.push(&token[start..index]);
                start = index + 1;
            }
            _ => {}
        }
    }
    (parts, &token[start..])
}

/// The sz keys a variant nests under.
///
/// `hover` is `[hover]`; `group-hover/sidebar` is `[group, sidebar, hover]`;
/// `has-[:checked]` is `[has, checked]`; `@min-[475px]` is `[@min, 475px]`.
pub fn map_variant(variant: &str) -> Vec<String> {
    if variant.starts_with('@') {
        return map_container_variant(variant);
    }
    if variant.starts_with("group-") || variant.starts_with("peer-") {
        return map_group_peer_variant(variant);
    }
    if let Some(rest) = variant.strip_prefix("has-") {
        return map_has_variant(rest);
    }
    if let Some(rest) = variant.strip_prefix("not-") {
        return map_not_variant(rest);
    }
    for attribute in ["data", "aria", "supports", "min", "max"] {
        if let Some(rest) = variant
            .strip_prefix(attribute)
            .and_then(|rest| rest.strip_prefix('-'))
        {
            return vec![attribute.to_string(), unwrap_brackets(rest).to_string()];
        }
    }
    if wrapped(variant, '[', ']').is_some() {
        return vec![variant.to_string()];
    }
    vec![normalize_variant_key(variant)]
}

/// `@container`, `@md/sidebar`, `@min-[475px]`, `@max-md`.
fn map_container_variant(variant: &str) -> Vec<String> {
    if variant == "@container" {
        return vec!["@container".to_string()];
    }
    if let Some((query, name)) = variant.split_once('/') {
        return vec![normalize_variant_key(query), name.to_string()];
    }
    for range in ["@min", "@max"] {
        if let Some(inner) = variant
            .strip_prefix(range)
            .and_then(|rest| rest.strip_prefix("-["))
            .and_then(|rest| rest.strip_suffix(']'))
            .filter(|inner| !inner.is_empty())
        {
            return vec![range.to_string(), inner.to_string()];
        }
    }
    vec![normalize_variant_key(variant)]
}

/// `has-[img]`, `has-[:checked]`, `has-checked`: brackets and a leading
/// pseudo-selector colon are dropped.
fn map_has_variant(rest: &str) -> Vec<String> {
    let Some(selector) = wrapped(rest, '[', ']') else {
        return vec!["has".to_string(), rest.to_string()];
    };
    vec![
        "has".to_string(),
        selector.strip_prefix(':').unwrap_or(selector).to_string(),
    ]
}

/// `not-hover`, `not-supports-[display:grid]`.
fn map_not_variant(rest: &str) -> Vec<String> {
    if let Some(condition) = rest
        .strip_prefix("supports-[")
        .and_then(|condition| condition.strip_suffix(']'))
    {
        return vec![
            "not".to_string(),
            "supports".to_string(),
            condition.to_string(),
        ];
    }
    vec!["not".to_string(), normalize_variant_key(rest)]
}

/// `group-hover`, `group-hover/sidebar`, `group-[.is-published]`,
/// `group-has-[a]`, `peer-checked/draft`: the type, the name when given,
/// then the state.
fn map_group_peer_variant(variant: &str) -> Vec<String> {
    let kind = if variant.starts_with("group-") {
        "group"
    } else {
        "peer"
    };
    let mut rest = &variant[kind.len() + 1..];
    let mut keys = vec![kind.to_string()];
    if let Some(slash) = find_top_level_slash(rest) {
        let name = &rest[slash + 1..];
        rest = &rest[..slash];
        if !name.is_empty() {
            keys.push(name.to_string());
        }
    }
    keys.extend(map_group_peer_state(rest));
    keys
}

/// The state part of a group or peer variant.
fn map_group_peer_state(state: &str) -> Vec<String> {
    if let Some(inner) = wrapped_state(state) {
        return vec![inner.to_string()];
    }
    for attribute in ["has", "data", "aria"] {
        if let Some(rest) = state
            .strip_prefix(attribute)
            .and_then(|rest| rest.strip_prefix('-'))
        {
            return vec![
                attribute.to_string(),
                wrapped_state(rest).unwrap_or(rest).to_string(),
            ];
        }
    }
    vec![normalize_variant_key(state)]
}

/// The inside of `[...]` or `(...)`.
fn wrapped_state(state: &str) -> Option<&str> {
    wrapped(state, '[', ']').or_else(|| wrapped(state, '(', ')'))
}

/// The inside of `[...]`, or the value itself when it is not bracketed.
fn unwrap_brackets(value: &str) -> &str {
    wrapped(value, '[', ']').unwrap_or(value)
}

/// The sz spelling of a variant: the reverse variant map's camelCase where
/// the spellings differ, the variant itself otherwise.
fn normalize_variant_key(variant: &str) -> String {
    reverse_variant(variant).unwrap_or(variant).to_string()
}

/// A parsed token: where it nests and what it sets.
struct ParsedToken {
    key_path: Vec<String>,
    prop: String,
    value: SzValue,
    css_property: Option<String>,
    extra: Option<(String, SzValue)>,
}

impl ParsedToken {
    /// The variant scope a CSS-property conflict is judged in.
    fn scope(&self) -> String {
        self.key_path.join("\0")
    }
}

fn parse_class_token(token: &str) -> Option<ParsedToken> {
    let (variants, base_class) = extract_variants(token);
    let parsed = parse_class(base_class)?;
    Some(ParsedToken {
        key_path: variants.into_iter().flat_map(map_variant).collect(),
        prop: parsed.prop,
        value: parsed.value,
        css_property: parsed.css_property,
        extra: parsed.extra.map(|extra| (extra.prop, extra.value)),
    })
}

/// The conversion in progress.
#[derive(Default)]
struct State {
    conversion: Conversion,
    /// Per variant scope, the token that set each CSS property.
    seen: HashMap<String, HashMap<String, String>>,
    /// Per variant scope, the CSS properties two tokens fought over.
    conflicted: HashMap<String, HashSet<String>>,
}

/// Convert a whole `className` into one merged sz object, with the tokens
/// that stay in `className` and the ones the resolution map keeps there.
#[must_use]
pub fn class_name_to_sz_object(class_name: &str, custom_map: Option<&SzObject>) -> Conversion {
    let mut state = State::default();
    for token in tokenize(class_name) {
        if apply_custom_map_token(token, custom_map, &mut state) {
            continue;
        }
        apply_parsed_token(token, &mut state);
    }
    state.conversion
}

/// What a resolution-map entry asks for a token.
enum Action {
    /// Merge this object; the cascade is what a Tailwind entry could not
    /// convert and goes back to the caller as unrecognised.
    Sz(SzObject, Vec<String>),
    Keep,
    Remove,
    Unresolved,
}

/// Property names every JavaScript object answers `in` for, through its
/// prototype. A token spelled like one is found in any map, whatever the
/// map holds.
const OBJECT_PROTOTYPE_KEYS: &[&str] = &[
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "toString",
    "valueOf",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
];

/// The action a map holds for a token, if it holds one.
fn resolve_custom_map_entry(token: &str, custom_map: &SzObject) -> Option<Action> {
    let Some(value) = custom_map.get(token) else {
        // `__proto__` is an object — `Object.prototype` — with nothing
        // enumerable to merge; the other inherited names are functions.
        if token == "__proto__" {
            return Some(Action::Sz(SzObject::new(), Vec::new()));
        }
        return OBJECT_PROTOTYPE_KEYS
            .contains(&token)
            .then_some(Action::Unresolved);
    };
    Some(match value {
        SzValue::Object(object) => Action::Sz(object.clone(), Vec::new()),
        SzValue::String(text) => match text.as_str() {
            TODO_KEEP => Action::Keep,
            TODO_REMOVE => Action::Remove,
            TODO_PENDING => Action::Unresolved,
            tailwind => resolve_custom_map_string(tailwind),
        },
        _ => Action::Unresolved,
    })
}

/// A Tailwind class string in the map converts on its own, without the map,
/// and counts only if something in it converted.
fn resolve_custom_map_string(tailwind: &str) -> Action {
    let inner = class_name_to_sz_object(tailwind, None);
    if inner.sz_object.is_empty() {
        return Action::Unresolved;
    }
    Action::Sz(inner.sz_object, inner.unrecognized)
}

/// Apply the map's answer for a token; `false` when the map has none.
fn apply_custom_map_token(token: &str, custom_map: Option<&SzObject>, state: &mut State) -> bool {
    let Some(action) = custom_map.and_then(|map| resolve_custom_map_entry(token, map)) else {
        return false;
    };
    match action {
        Action::Sz(object, cascade) => {
            // `Object.assign`: the map's keys in JavaScript's order, each
            // replacing what the sz object already had under it.
            for (key, value) in object.js_ordered() {
                state
                    .conversion
                    .sz_object
                    .insert(key.clone(), value.clone());
            }
            state.conversion.unrecognized.extend(cascade);
        }
        Action::Keep => state.conversion.keep_in_class_name.push(token.to_string()),
        Action::Remove => {}
        Action::Unresolved => state.conversion.unrecognized.push(token.to_string()),
    }
    true
}

/// Parse one token and place it, unless it fights an earlier token over a
/// CSS property in the same scope, in which case both stay in `className`.
fn apply_parsed_token(token: &str, state: &mut State) {
    let Some(parsed) = parse_class_token(token) else {
        state.conversion.unrecognized.push(token.to_string());
        return;
    };
    let scope = parsed.scope();

    if let Some(css_property) = &parsed.css_property {
        if state
            .conflicted
            .get(&scope)
            .is_some_and(|properties| properties.contains(css_property))
        {
            state.conversion.unrecognized.push(token.to_string());
            return;
        }
        let previous = state
            .seen
            .get(&scope)
            .and_then(|properties| properties.get(css_property))
            .filter(|previous| previous.as_str() != token)
            .cloned();
        if let Some(previous) = previous {
            state
                .conflicted
                .entry(scope)
                .or_default()
                .insert(css_property.clone());
            state.conversion.unrecognized.push(previous);
            state.conversion.unrecognized.push(token.to_string());
            remove_nested(
                &mut state.conversion.sz_object,
                &parsed.key_path,
                &parsed.prop,
            );
            return;
        }
        state
            .seen
            .entry(scope)
            .or_default()
            .insert(css_property.clone(), token.to_string());
    }

    set_nested(
        &mut state.conversion.sz_object,
        &parsed.key_path,
        &parsed.prop,
        parsed.value,
    );
    if let Some((prop, value)) = parsed.extra {
        set_nested(
            &mut state.conversion.sz_object,
            &parsed.key_path,
            &prop,
            value,
        );
    }
}

/// Set `prop` under the variant path, creating objects on the way and
/// replacing anything that is not an object. An array on the path swallows
/// the write, as a JavaScript array would hold a property JSON never prints.
fn set_nested(object: &mut SzObject, key_path: &[String], prop: &str, value: SzValue) {
    let mut current = object;
    for key in key_path {
        let slot = current
            .entry(key.clone())
            .or_insert_with(|| SzValue::Object(SzObject::new()));
        if matches!(slot, SzValue::Array(_)) {
            return;
        }
        if !matches!(slot, SzValue::Object(_)) {
            *slot = SzValue::Object(SzObject::new());
        }
        let SzValue::Object(next) = slot else { return };
        current = next;
    }
    current.insert(prop.to_string(), value);
}

/// Remove `prop` under the variant path, then every object the removal
/// left empty. A path that does not lead through objects removes nothing.
fn remove_nested(object: &mut SzObject, key_path: &[String], prop: &str) {
    let Some((key, rest)) = key_path.split_first() else {
        object.shift_remove(prop);
        return;
    };
    let Some(SzValue::Object(child)) = object.get_mut(key) else {
        return;
    };
    remove_nested(child, rest, prop);
    if child.is_empty() {
        object.shift_remove(key);
    }
}

#[cfg(test)]
mod tests {
    use super::{extract_variants, map_variant, tokenize};

    /// `map_variant` answers owned strings; compare against literals.
    fn mapped(variant: &str) -> Vec<String> {
        map_variant(variant)
    }

    #[test]
    fn tokenize_splits_on_javascript_whitespace_and_drops_the_gaps() {
        assert_eq!(
            tokenize("p-4 bg-blue-500 flex"),
            ["p-4", "bg-blue-500", "flex"]
        );
        assert_eq!(tokenize("  p-4   bg-blue-500  "), ["p-4", "bg-blue-500"]);
        assert_eq!(tokenize("p-4"), ["p-4"]);
        assert!(tokenize("").is_empty());
        assert!(tokenize("   ").is_empty());
    }

    #[test]
    fn extract_variants_splits_on_colons_outside_brackets() {
        assert_eq!(extract_variants("p-4"), (vec![], "p-4"));
        assert_eq!(
            extract_variants("hover:bg-blue-500"),
            (vec!["hover"], "bg-blue-500")
        );
        assert_eq!(
            extract_variants("md:hover:bg-blue-500"),
            (vec!["md", "hover"], "bg-blue-500")
        );
    }

    #[test]
    fn extract_variants_keeps_a_bracketed_colon_inside_its_variant() {
        // A colon inside brackets belongs to the variant's own syntax, so
        // splitting on it would tear `supports-[display:grid]` in half.
        assert_eq!(
            extract_variants("supports-[display:grid]:grid"),
            (vec!["supports-[display:grid]"], "grid")
        );
        assert_eq!(
            extract_variants("aria-[current=page]:font-bold"),
            (vec!["aria-[current=page]"], "font-bold")
        );
        assert_eq!(
            extract_variants("not-supports-[display:grid]:flex"),
            (vec!["not-supports-[display:grid]"], "flex")
        );
    }

    #[test]
    fn extract_variants_walks_bytes_without_cutting_a_character() {
        // The scan is byte-indexed; a multi-byte character inside a variant
        // must not be split, and the base class keeps its own.
        assert_eq!(
            extract_variants(r#"data-[icon=🧭:active]:content-["🚀"]"#),
            (vec!["data-[icon=🧭:active]"], r#"content-["🚀"]"#)
        );
    }

    #[test]
    fn extract_variants_reads_named_groups_data_attributes_and_container_queries() {
        assert_eq!(
            extract_variants("group-hover/sidebar:text-white"),
            (vec!["group-hover/sidebar"], "text-white")
        );
        assert_eq!(
            extract_variants("data-[active]:bg-blue-500"),
            (vec!["data-[active]"], "bg-blue-500")
        );
        assert_eq!(
            extract_variants("min-[320px]:text-center"),
            (vec!["min-[320px]"], "text-center")
        );
        assert_eq!(extract_variants("@md:flex"), (vec!["@md"], "flex"));
        assert_eq!(
            extract_variants("@md/sidebar:block"),
            (vec!["@md/sidebar"], "block")
        );
        assert_eq!(
            extract_variants("@min-[475px]:flex"),
            (vec!["@min-[475px]"], "flex")
        );
    }

    #[test]
    fn map_variant_passes_a_single_word_variant_through() {
        for variant in [
            "hover",
            "focus",
            "active",
            "disabled",
            "first",
            "last",
            "odd",
            "even",
            "before",
            "after",
            "placeholder",
            "dark",
            "light",
            "sm",
            "md",
            "lg",
            "xl",
            "2xl",
        ] {
            assert_eq!(mapped(variant), [variant], "{variant}");
        }
    }

    #[test]
    fn map_variant_camel_cases_a_multi_word_variant() {
        // The sz key is a JavaScript identifier, so the hyphenated Tailwind
        // spelling cannot survive as-is.
        for (variant, key) in [
            ("focus-within", "focusWithin"),
            ("focus-visible", "focusVisible"),
            ("first-of-type", "firstOfType"),
            ("last-of-type", "lastOfType"),
            ("motion-reduce", "motionReduce"),
            ("motion-safe", "motionSafe"),
            ("placeholder-shown", "placeholderShown"),
            ("read-only", "readOnly"),
        ] {
            assert_eq!(mapped(variant), [key], "{variant}");
        }
    }

    #[test]
    fn map_variant_nests_group_and_peer_and_puts_the_name_before_the_state() {
        for (variant, keys) in [
            ("group-hover", vec!["group", "hover"]),
            ("group-hover/sidebar", vec!["group", "sidebar", "hover"]),
            ("peer-checked", vec!["peer", "checked"]),
            ("peer-checked/draft", vec!["peer", "draft", "checked"]),
            ("group-[.is-published]", vec!["group", ".is-published"]),
            ("group-has-[a]", vec!["group", "has", "a"]),
            ("group-focus-within", vec!["group", "focusWithin"]),
            (
                "peer-focus-visible/label",
                vec!["peer", "label", "focusVisible"],
            ),
        ] {
            assert_eq!(mapped(variant), keys, "{variant}");
        }
    }

    #[test]
    fn map_variant_reads_a_data_or_aria_attribute_with_or_without_brackets() {
        // Tailwind v4 allows dropping the brackets for a bare attribute name,
        // so both spellings have to land on the same sz key path.
        for (variant, keys) in [
            ("group-data-[active]", vec!["group", "data", "active"]),
            ("group-data-active", vec!["group", "data", "active"]),
            ("group-data-open", vec!["group", "data", "open"]),
            ("group-data-closed", vec!["group", "data", "closed"]),
            ("group-data-disabled", vec!["group", "data", "disabled"]),
            ("group-data-[open]", vec!["group", "data", "open"]),
            (
                "group-data-[state=open]",
                vec!["group", "data", "state=open"],
            ),
            (
                "group-data-[active='true']",
                vec!["group", "data", "active='true'"],
            ),
            (
                "group-data-[orientation=horizontal]",
                vec!["group", "data", "orientation=horizontal"],
            ),
            ("group-aria-checked", vec!["group", "aria", "checked"]),
            ("group-aria-expanded", vec!["group", "aria", "expanded"]),
            (
                "group-aria-[current=page]",
                vec!["group", "aria", "current=page"],
            ),
            ("peer-data-[active]", vec!["peer", "data", "active"]),
            ("peer-data-active", vec!["peer", "data", "active"]),
            ("peer-data-[state=open]", vec!["peer", "data", "state=open"]),
            ("data-[active]", vec!["data", "active"]),
            ("data-[state=open]", vec!["data", "state=open"]),
            ("aria-checked", vec!["aria", "checked"]),
            ("aria-[current=page]", vec!["aria", "current=page"]),
        ] {
            assert_eq!(mapped(variant), keys, "{variant}");
        }
    }

    #[test]
    fn map_variant_unwraps_has_not_supports_and_the_breakpoint_forms() {
        for (variant, keys) in [
            ("has-[img]", vec!["has", "img"]),
            ("has-[:checked]", vec!["has", "checked"]),
            ("not-hover", vec!["not", "hover"]),
            ("not-first", vec!["not", "first"]),
            (
                "not-supports-[display:grid]",
                vec!["not", "supports", "display:grid"],
            ),
            ("supports-[display:grid]", vec!["supports", "display:grid"]),
            ("min-[320px]", vec!["min", "320px"]),
            ("max-[600px]", vec!["max", "600px"]),
            ("min-md", vec!["min", "md"]),
        ] {
            assert_eq!(mapped(variant), keys, "{variant}");
        }
    }

    #[test]
    fn map_variant_keeps_a_container_query_and_an_arbitrary_selector_whole() {
        for (variant, keys) in [
            ("@md", vec!["@md"]),
            ("@md/sidebar", vec!["@md", "sidebar"]),
            ("@min-[475px]", vec!["@min", "475px"]),
            ("@container", vec!["@container"]),
            ("[&>span]", vec!["[&>span]"]),
        ] {
            assert_eq!(mapped(variant), keys, "{variant}");
        }
    }
}
