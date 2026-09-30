//! One Tailwind utility class to one sz prop and value.
//!
//! The order of attempts is the TypeScript's: the container and group markers,
//! the fixed prop-and-value classes, the gradient grammar, then the longest
//! known prefix whose value the rules accept, and last an arbitrary custom
//! property declaration. A class that none of them recognises is `None`, and
//! the caller keeps it in `className`.

use super::class_rules::{
    self, decode_arbitrary_spaces, is_fraction, is_valid_spacing_value, wrapped, Shape,
    SHADOW_SIZE_PROPS,
};
use super::value::{js_number, js_number_to_string, Extra, ParsedClass, SzObject, SzValue};
use crate::transform::generated::migrate_tables as tables;
use crate::transform::generated::reverse_tables::reverse_property_key;

/// Parse a single Tailwind utility, without variants, into an sz prop and
/// value. `None` when the class is not one migrate recognises.
pub fn parse_class(class: &str) -> Option<ParsedClass> {
    let important = class.ends_with('!');
    let input = if important {
        &class[..class.len() - 1]
    } else {
        class
    };
    let negative = input.starts_with('-');
    let source = if negative { &input[1..] } else { input };

    if let Some(container) = parse_container_marker(input) {
        return Some(container);
    }
    if let Some(mask) = parse_mask(input) {
        return Some(apply_important(mask, important));
    }
    // A layer-shaped class the layers do not read stays in `className`: on the
    // prefix path it became `mask: 'linear-…'`, a value the engine drops.
    if is_mask_layer_class(input) {
        return None;
    }
    if let Some(boolean) = try_boolean_match(input) {
        return Some(apply_important(boolean, important));
    }
    if let Some(gradient) = try_gradient(source, negative) {
        return Some(apply_important(gradient, important));
    }
    if let Some(utility) = parse_longest_prefix(source, negative) {
        return Some(apply_important(utility, important));
    }
    parse_custom_property_declaration(input)
        .map(|declaration| apply_important(declaration, important))
}

/// A mask utility, on the key that owns its CSS variable (ADR 0013).
///
/// `mask` holds a direct mask-image only. The gradient layers are
/// `maskLinear` / `maskRadial` / `maskConic`, with the angle, the sides and
/// the stops as members, and the keyword utilities belong to `maskSize`,
/// `maskPos`, `maskMode` and `maskComposite`. Anything this does not read —
/// `mask-none`, an arbitrary image, `mask-clip-*` — takes the prefix path.
fn parse_mask(input: &str) -> Option<ParsedClass> {
    let negative = input.starts_with('-');
    let body = input
        .strip_prefix('-')
        .unwrap_or(input)
        .strip_prefix("mask-")?;
    for (family, slot) in [
        ("linear", "maskLinear"),
        ("radial", "maskRadial"),
        ("conic", "maskConic"),
    ] {
        let Some(rest) = body
            .strip_prefix(family)
            .and_then(|rest| rest.strip_prefix('-'))
        else {
            continue;
        };
        if let Some((edge, value)) = stop_parts(rest) {
            return (!negative).then(|| ParsedClass::new(slot, member(edge, mask_stop(value))));
        }
        if family == "radial" {
            return parse_radial_member(rest, negative);
        }
        return mask_angle(rest, negative)
            .map(|angle| ParsedClass::new(slot, member("angle", angle)));
    }
    if negative {
        return None;
    }
    for side in ["t", "r", "b", "l", "x", "y"] {
        let Some(rest) = body
            .strip_prefix(side)
            .and_then(|rest| rest.strip_prefix('-'))
        else {
            continue;
        };
        if let Some((edge, value)) = stop_parts(rest) {
            return Some(ParsedClass::new(
                "maskLinear",
                member(side, member(edge, mask_stop(value))),
            ));
        }
    }
    let (prop, value) = match body {
        "circle" | "ellipse" => {
            return Some(ParsedClass::new(
                "maskRadial",
                member("shape", SzValue::from(body)),
            ))
        }
        "add" | "subtract" | "intersect" | "exclude" => ("maskComposite", body),
        "alpha" | "luminance" => ("maskMode", body),
        "match" => ("maskMode", "match-source"),
        "no-clip" => ("maskClip", body),
        "repeat" | "no-repeat" | "repeat-x" | "repeat-y" => ("maskRepeat", body),
        "repeat-space" => ("maskRepeat", "space"),
        "repeat-round" => ("maskRepeat", "round"),
        "type-alpha" => ("maskType", "alpha"),
        "type-luminance" => ("maskType", "luminance"),
        "auto" | "cover" | "contain" => ("maskSize", body),
        "center" | "top" | "bottom" | "left" | "right" | "top-left" | "top-right"
        | "bottom-left" | "bottom-right" => ("maskPos", body),
        _ => return None,
    };
    Some(ParsedClass::new(prop, value))
}

/// A signed mask class, or one naming a gradient layer.
fn is_mask_layer_class(input: &str) -> bool {
    input.starts_with("-mask-")
        || input.strip_prefix("mask-").is_some_and(|body| {
            ["linear-", "radial-", "conic-"]
                .iter()
                .any(|family| body.starts_with(family))
        })
}

/// `from-<value>` or `to-<value>`, split into the stop and its value.
fn stop_parts(rest: &str) -> Option<(&'static str, &str)> {
    if let Some(value) = rest.strip_prefix("from-") {
        return Some(("from", value));
    }
    rest.strip_prefix("to-").map(|value| ("to", value))
}

/// The radial layer's own members: `at-<position>` and the size keywords.
fn parse_radial_member(rest: &str, negative: bool) -> Option<ParsedClass> {
    if negative {
        return None;
    }
    if let Some(at) = rest.strip_prefix("at-") {
        return Some(ParsedClass::new(
            "maskRadial",
            member("at", SzValue::from(at)),
        ));
    }
    matches!(
        rest,
        "closest-side" | "closest-corner" | "farthest-side" | "farthest-corner"
    )
    .then(|| ParsedClass::new("maskRadial", member("size", SzValue::from(rest))))
}

/// A layer angle: a number of degrees, signed by the class's own `-`, or a
/// CSS variable.
fn mask_angle(rest: &str, negative: bool) -> Option<SzValue> {
    if let Some(inner) = wrapped(rest, '(', ')') {
        return (!negative && inner.starts_with("--")).then(|| SzValue::from(inner));
    }
    if !rest.bytes().all(|byte| byte.is_ascii_digit()) || rest.is_empty() {
        return None;
    }
    let degrees = js_number(rest)?;
    Some(SzValue::Number(if negative { -degrees } else { degrees }))
}

/// A stop's value. Position and colour are separate variables: a number, a
/// percentage or an arbitrary value is a position, `(--x)` is a position
/// variable, `(color:--x)` a colour variable, and a word is a colour, with
/// its `/opacity` as `op`.
fn mask_stop(value: &str) -> SzValue {
    if let Some(inner) = wrapped(value, '(', ')') {
        return inner.strip_prefix("color:").map_or_else(
            || member("at", SzValue::from(inner)),
            |colour| member("color", SzValue::from(colour)),
        );
    }
    if value.starts_with('[') {
        return SzValue::from(value);
    }
    if let Some(number) =
        js_number(value).filter(|_| value.bytes().all(|b| b.is_ascii_digit() || b == b'.'))
    {
        return SzValue::Number(number);
    }
    if value.strip_suffix('%').is_some_and(|number| {
        !number.is_empty() && number.bytes().all(|b| b.is_ascii_digit() || b == b'.')
    }) {
        return SzValue::from(value);
    }
    let mut colour = SzObject::new();
    match value.split_once('/') {
        Some((name, opacity)) => {
            colour.insert("color".to_string(), SzValue::from(name));
            colour.insert(
                "op".to_string(),
                js_number(opacity).map_or_else(|| SzValue::from(opacity), SzValue::Number),
            );
        }
        None => {
            colour.insert("color".to_string(), SzValue::from(value));
        }
    }
    SzValue::Object(colour)
}

/// `{ name: value }`.
fn member(name: &str, value: SzValue) -> SzValue {
    let mut object = SzObject::new();
    object.insert(name.to_string(), value);
    SzValue::Object(object)
}

/// `@container`, `@container/name`, `group/name`, `peer/name`: the slash
/// names the marker, it is not an opacity.
fn parse_container_marker(input: &str) -> Option<ParsedClass> {
    if input == "@container" {
        return Some(ParsedClass::new("@container", true));
    }
    for (marker, prop) in [
        ("@container/", "@container"),
        ("group/", "group"),
        ("peer/", "peer"),
    ] {
        if let Some(name) = input.strip_prefix(marker) {
            return Some(ParsedClass::new(prop, name));
        }
    }
    None
}

/// The fixed prop-and-value classes, then the true boolean shorthands.
fn try_boolean_match(class: &str) -> Option<ParsedClass> {
    if let Some(entry) = tables::boolean_value(class) {
        let mut parsed = ParsedClass::new(entry.prop, entry.value);
        parsed.css_property = entry.css_property.map(str::to_string);
        return Some(parsed);
    }
    tables::reverse_boolean(class).map(|prop| ParsedClass::new(prop, true))
}

/// `bg-linear-to-r`, `bg-radial-[at_50%_75%]/oklab`, `bg-conic-90`: the
/// gradient kind, an optional direction, an optional interpolation space.
fn try_gradient(class: &str, negative: bool) -> Option<ParsedClass> {
    let (kind, suffix) = ["linear", "radial", "conic"].iter().find_map(|kind| {
        class
            .strip_prefix("bg-")
            .and_then(|rest| rest.strip_prefix(kind))
            .map(|suffix| (*kind, suffix))
    })?;

    let (input, interpolation) = find_top_level_slash(suffix).map_or((suffix, None), |slash| {
        (&suffix[..slash], Some(&suffix[slash + 1..]))
    });

    let mut gradient = SzObject::new();
    gradient.insert("gradient".to_string(), SzValue::from(kind));
    if let Some(direction) = parse_gradient_direction(input, negative) {
        gradient.insert("dir".to_string(), direction);
    }
    if let Some(interpolation) = interpolation.filter(|text| !text.is_empty()) {
        gradient.insert("in".to_string(), SzValue::from(interpolation));
    }
    Some(ParsedClass::new("bgImg", SzValue::Object(gradient)))
}

/// The gradient's direction: `to-r`, an angle, an arbitrary value or a custom
/// property. Absent when the suffix carries none.
fn parse_gradient_direction(input: &str, negative: bool) -> Option<SzValue> {
    let direction = input.strip_prefix('-')?;
    if let Some(inner) = wrapped(direction, '[', ']') {
        return Some(SzValue::from(decode_arbitrary_spaces(inner)));
    }
    if let Some(inner) = wrapped(direction, '(', ')') {
        return Some(SzValue::from(inner));
    }
    if !direction.is_empty() && direction.bytes().all(|byte| byte.is_ascii_digit()) {
        let angle = js_number(direction).unwrap_or(f64::NAN);
        return Some(SzValue::Number(if negative { -angle } else { angle }));
    }
    Some(SzValue::from(direction))
}

/// The first `/` outside brackets and parens.
pub fn find_top_level_slash(text: &str) -> Option<usize> {
    let mut depth = 0_i32;
    for (index, byte) in text.bytes().enumerate() {
        match byte {
            b'[' | b'(' => depth += 1,
            b']' | b')' => depth -= 1,
            b'/' if depth == 0 => return Some(index),
            _ => {}
        }
    }
    None
}

/// The longest known prefix the value after it satisfies. A prefix that
/// matches the text but refuses the value is skipped, not a failure: `p-red`
/// is not a padding, but `p` still is not the only prefix `p-red` could
/// start with.
fn parse_longest_prefix(source: &str, negative: bool) -> Option<ParsedClass> {
    for prefix in tables::SORTED_PREFIXES {
        if source == *prefix {
            if let Some(exact) = parse_exact_prefix(prefix, negative) {
                return Some(exact);
            }
            continue;
        }
        if let Some(parsed) = parse_valued_prefix(source, prefix, negative) {
            return Some(parsed);
        }
    }
    None
}

/// A class that is exactly a prefix: the boolean it implies, if any.
fn parse_exact_prefix(prefix: &'static str, negative: bool) -> Option<ParsedClass> {
    if negative && tables::negative_allowed(prefix) {
        return None;
    }
    if let Some(prop) = tables::reverse_boolean(prefix) {
        return Some(ParsedClass::new(prop, true));
    }
    let prop = reverse_property_key(prefix).unwrap_or(prefix);
    if prefix == "divide-x" || prefix == "divide-y" || prefix == "border" {
        return Some(ParsedClass::new(prop, true));
    }
    // Named rather than searched. A substring test would also accept a
    // two-letter suffix that happens to sit next to itself in the list, such
    // as "tr" or "se", and only the length test beside it was keeping those
    // out — a pairing that holds today because no such prefix exists yet.
    let border_side = prefix
        .strip_prefix("border-")
        .is_some_and(|side| matches!(side, "t" | "r" | "b" | "l" | "x" | "y" | "s" | "e"));
    border_side.then(|| ParsedClass::new(prop, true))
}

/// A prefix followed by `-` and a value the prefix accepts.
fn parse_valued_prefix(source: &str, prefix: &'static str, negative: bool) -> Option<ParsedClass> {
    let raw_value = source.strip_prefix(prefix)?.strip_prefix('-')?;
    if raw_value.is_empty() || (negative && !tables::negative_allowed(prefix)) {
        return None;
    }
    if tables::spacing_props(prefix) && !is_valid_spacing_value(raw_value) {
        return None;
    }
    disambiguate_and_parse(prefix, raw_value, negative)
}

/// `[--name:value]`: an arbitrary custom property declaration.
fn parse_custom_property_declaration(input: &str) -> Option<ParsedClass> {
    if !input.contains(':') {
        return None;
    }
    let inner = wrapped(input, '[', ']')?;
    if !inner.starts_with("--") {
        return None;
    }
    let (prop, value) = inner.split_once(':')?;
    Some(ParsedClass::new(prop, value))
}

/// `!` on a class becomes `!` on its value; a boolean becomes the bare
/// marker. A companion prop does not survive, as in the TypeScript.
fn apply_important(result: ParsedClass, important: bool) -> ParsedClass {
    if !important {
        return result;
    }
    let value = match &result.value {
        SzValue::String(text) => format!("{text}!"),
        SzValue::Bool(_) => "!".to_string(),
        SzValue::Number(number) => format!("{}!", js_number_to_string(*number)),
        // Only an object reaches here from the parser; the map-only kinds
        // share the arm so the match stays total.
        SzValue::Object(_) | SzValue::Array(_) | SzValue::Null => return result,
    };
    ParsedClass {
        prop: result.prop,
        value: SzValue::from(value),
        css_property: result.css_property,
        extra: None,
    }
}

/// Split off a `/modifier`, read the value by the prefix's rules, then put
/// the modifier back as the form the key takes: a line-height companion for
/// `text`, the verbatim class for a shadow size, `{ color, op }` otherwise.
fn disambiguate_and_parse(prefix: &str, raw_value: &str, negative: bool) -> Option<ParsedClass> {
    let (value, opacity) = extract_opacity(prefix, raw_value);
    let result = disambiguate(prefix, value, negative)?;
    let Some(opacity) = opacity else {
        return Some(result);
    };
    let SzValue::String(text) = &result.value else {
        return Some(result);
    };

    if result.prop == "text" {
        let slash = find_top_level_slash(raw_value).map_or(0, |index| index + 1);
        return Some(ParsedClass {
            prop: "text".to_string(),
            value: result.value.clone(),
            css_property: None,
            extra: Some(Extra {
                prop: "leading".to_string(),
                value: parse_leading_modifier(&raw_value[slash..]),
            }),
        });
    }
    if SHADOW_SIZE_PROPS.contains(&result.prop.as_str()) {
        return Some(ParsedClass::new(&result.prop, raw_value));
    }
    let mut colour = SzObject::new();
    colour.insert("color".to_string(), SzValue::from(text.as_str()));
    colour.insert("op".to_string(), opacity);
    Some(ParsedClass::new(&result.prop, SzValue::Object(colour)))
}

/// The `leading` value a `text-*/modifier` carries: a bare number rides the
/// spacing scale, a bracket's inside is the unitless ratio, a paren's inside
/// is the custom property.
fn parse_leading_modifier(raw: &str) -> SzValue {
    if is_leading_number(raw) {
        return SzValue::Number(js_number(raw).unwrap_or(f64::NAN));
    }
    if let Some(inner) = wrapped(raw, '(', ')').or_else(|| wrapped(raw, '[', ']')) {
        return SzValue::from(inner);
    }
    SzValue::from(raw)
}

/// `\d+(\.\d+)?`
fn is_leading_number(raw: &str) -> bool {
    let digits = |part: &str| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit());
    match raw.split_once('.') {
        Some((whole, fraction)) => digits(whole) && digits(fraction),
        None => digits(raw),
    }
}

/// The value before a top-level `/` and the modifier after it, unless the
/// slash is a fraction on a prefix that takes fractions.
fn extract_opacity<'a>(prefix: &str, raw_value: &'a str) -> (&'a str, Option<SzValue>) {
    let Some(slash) = find_top_level_slash(raw_value) else {
        return (raw_value, None);
    };
    if tables::fraction_supported(prefix) && is_fraction(raw_value) {
        return (raw_value, None);
    }
    (
        &raw_value[..slash],
        Some(parse_opacity(&raw_value[slash + 1..])),
    )
}

/// `50`, `[50%]`, `[0.5]`, `(--op)`: a number where the text is one, the
/// text otherwise.
fn parse_opacity(raw: &str) -> SzValue {
    if let Some(inner) = wrapped(raw, '[', ']') {
        if inner.contains('%') {
            return SzValue::from(inner);
        }
        return numeric_opacity(inner);
    }
    if let Some(inner) = wrapped(raw, '(', ')') {
        return SzValue::from(inner);
    }
    numeric_opacity(raw)
}

fn numeric_opacity(value: &str) -> SzValue {
    js_number(value).map_or_else(|| SzValue::from(value), SzValue::Number)
}

/// Pick the prefix's key by the value's shape and spell the value.
fn disambiguate(prefix: &str, value: &str, negative: bool) -> Option<ParsedClass> {
    if class_rules::keeps_in_class_name(prefix, value) {
        return None;
    }
    let shape = Shape::read(value);
    let (_, rule) = class_rules::select(class_rules::rules_for(prefix), &shape)?;
    Some(ParsedClass::new(
        &class_rules::prop_name(rule, prefix),
        class_rules::emit(rule, prefix, &shape, negative),
    ))
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;
    use crate::migrate::class_rules::{rules_for, select, RULE_TABLES};

    /// Read a corpus at run time rather than `include_str!`.
    ///
    /// These files are megabytes. Embedding them puts the whole text in the
    /// test binary as a literal, which rustc carries through codegen with full
    /// debug info — several test binaries compile at once, and on a 16 GB
    /// machine that was enough to push the whole `cargo test` compile into
    /// swap. Reading the file costs a syscall and keeps the binary small.
    fn read_corpus(name: &str) -> String {
        let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
        std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("reading {path}: {error}"))
    }

    #[derive(serde::Deserialize)]
    struct Corpus {
        entries: Vec<Entry>,
    }

    #[derive(serde::Deserialize)]
    struct Entry {
        c: String,
    }

    /// The prefix and rule index that decided a class, found the way
    /// `parse_longest_prefix` finds them. The loop is repeated here rather
    /// than threaded through the parser, so production code carries no
    /// tracing; the parity test keeps the two loops honest.
    fn decided_by(class: &str) -> Option<(&'static str, usize)> {
        let input = class.strip_suffix('!').unwrap_or(class);
        let (negative, source) = input
            .strip_prefix('-')
            .map_or((false, input), |source| (true, source));
        if parse_container_marker(input).is_some()
            || try_boolean_match(input).is_some()
            || try_gradient(source, negative).is_some()
        {
            return None;
        }
        for prefix in tables::SORTED_PREFIXES {
            if source == *prefix {
                if parse_exact_prefix(prefix, negative).is_some() {
                    return None;
                }
                continue;
            }
            if parse_valued_prefix(source, prefix, negative).is_some() {
                let raw_value = source.strip_prefix(prefix)?.strip_prefix('-')?;
                let (value, _) = extract_opacity(prefix, raw_value);
                let (index, _) = select(rules_for(prefix), &Shape::read(value))?;
                return Some((prefix, index));
            }
        }
        None
    }

    /// Every `font: '…'` value the source corpus holds inside an sz object.
    ///
    /// The rule tables have two callers, not one: a class, and the legacy
    /// sz-key normaliser, which resolves `font` through the same table. A
    /// gate that walks only the class path calls the sz-key rule dead — it
    /// did, the rule was deleted on its word, and `font: 'stretch-condensed'`
    /// migrated to a font FAMILY on one engine and a stretch on the other
    /// until the divergence was found by hand. Both callers are walked here.
    fn sz_key_font_values() -> Vec<String> {
        let corpus = read_corpus("migrate-source-parity-corpus.json");
        let mut values = Vec::new();
        let mut rest = corpus.as_str();
        // An sz value is single-quoted in the source, and JSON leaves a
        // single quote alone, so it reads here exactly as it was written.
        while let Some(found) = rest.find("font: '") {
            rest = &rest[found + "font: '".len()..];
            if let Some(end) = rest.find('\'') {
                values.push(rest[..end].to_string());
            }
        }
        assert!(values.len() > 3, "parsed only {} font values", values.len());
        values
    }

    /// A rule no caller in the corpora reaches is a rule the parity tests
    /// cannot check, so it is refused rather than carried as dead weight.
    #[test]
    fn every_rule_is_reached_by_some_caller() {
        let corpus: Corpus = serde_json::from_str(&read_corpus("migrate-parity-corpus.json"))
            .expect("the migrate parity corpus is JSON");
        let mut hits: HashSet<(&str, usize)> = corpus
            .entries
            .iter()
            .filter_map(|entry| decided_by(&entry.c))
            .collect();
        for value in sz_key_font_values() {
            if let Some((index, _)) = select(rules_for("font"), &Shape::read(&value)) {
                hits.insert(("font", index));
            }
        }

        let unreached: Vec<String> = RULE_TABLES
            .iter()
            .flat_map(|(prefix, rules)| {
                (0..rules.len())
                    .filter(|index| !hits.contains(&(*prefix, *index)))
                    .map(move |index| format!("{prefix}[{index}]"))
            })
            .collect();
        assert!(
            unreached.is_empty(),
            "rules no corpus class reaches: {}",
            unreached.join(", ")
        );
    }

    #[test]
    fn ring_inset_stays_in_class_name_and_the_ring_width_still_migrates() {
        // `ring` holds the width too, so `ring-1 ring-inset` on one element
        // would keep only the later class.
        assert!(parse_class("ring-inset").is_none());
        assert!(parse_class("ring-inset!").is_none());
        let width = parse_class("ring-2").expect("a ring width migrates");
        assert_eq!(width.prop, "ring");
        let colour = parse_class("ring-blue-500").expect("a ring colour migrates");
        assert_eq!(colour.prop, "ringColor");
    }

    /// One parsed mask class as JSON, for a compact expectation.
    fn mask_json(class: &str) -> String {
        parse_class(class).map_or_else(
            || "null".to_string(),
            |parsed| serde_json::to_string(&parsed).expect("a parsed class serialises"),
        )
    }

    #[test]
    fn mask_utilities_land_on_the_key_that_owns_their_variable() {
        for (class, expected) in [
            (
                "mask-linear-45",
                r#"{"prop":"maskLinear","value":{"angle":45}}"#,
            ),
            (
                "-mask-conic-90",
                r#"{"prop":"maskConic","value":{"angle":-90}}"#,
            ),
            (
                "mask-linear-(--a)",
                r#"{"prop":"maskLinear","value":{"angle":"--a"}}"#,
            ),
            (
                "mask-linear-from-20%",
                r#"{"prop":"maskLinear","value":{"from":"20%"}}"#,
            ),
            (
                "mask-conic-to-1.5",
                r#"{"prop":"maskConic","value":{"to":1.5}}"#,
            ),
            (
                "mask-radial-from-[3rem]",
                r#"{"prop":"maskRadial","value":{"from":"[3rem]"}}"#,
            ),
            (
                "mask-b-from-(--p)",
                r#"{"prop":"maskLinear","value":{"b":{"from":{"at":"--p"}}}}"#,
            ),
            (
                "mask-t-to-(color:--c)",
                r#"{"prop":"maskLinear","value":{"t":{"to":{"color":"--c"}}}}"#,
            ),
            (
                "mask-x-from-red-500/30",
                r#"{"prop":"maskLinear","value":{"x":{"from":{"color":"red-500","op":30}}}}"#,
            ),
            (
                "mask-y-to-black/[.5]",
                r#"{"prop":"maskLinear","value":{"y":{"to":{"color":"black","op":"[.5]"}}}}"#,
            ),
            (
                "mask-l-from-white",
                r#"{"prop":"maskLinear","value":{"l":{"from":{"color":"white"}}}}"#,
            ),
            (
                "mask-radial-at-top",
                r#"{"prop":"maskRadial","value":{"at":"top"}}"#,
            ),
            (
                "mask-radial-farthest-corner",
                r#"{"prop":"maskRadial","value":{"size":"farthest-corner"}}"#,
            ),
            (
                "mask-ellipse",
                r#"{"prop":"maskRadial","value":{"shape":"ellipse"}}"#,
            ),
            (
                "mask-subtract",
                r#"{"prop":"maskComposite","value":"subtract"}"#,
            ),
            (
                "mask-luminance",
                r#"{"prop":"maskMode","value":"luminance"}"#,
            ),
            (
                "mask-match",
                r#"{"prop":"maskMode","value":"match-source"}"#,
            ),
            ("mask-cover", r#"{"prop":"maskSize","value":"cover"}"#),
            (
                "mask-top-right",
                r#"{"prop":"maskPos","value":"top-right"}"#,
            ),
            ("mask-no-clip", r#"{"prop":"maskClip","value":"no-clip"}"#),
            (
                "mask-repeat-space",
                r#"{"prop":"maskRepeat","value":"space"}"#,
            ),
            (
                "mask-repeat-round",
                r#"{"prop":"maskRepeat","value":"round"}"#,
            ),
            (
                "mask-no-repeat",
                r#"{"prop":"maskRepeat","value":"no-repeat"}"#,
            ),
            ("mask-type-alpha", r#"{"prop":"maskType","value":"alpha"}"#),
            (
                "mask-type-luminance",
                r#"{"prop":"maskType","value":"luminance"}"#,
            ),
        ] {
            assert_eq!(mask_json(class), expected, "{class}");
        }
    }

    #[test]
    fn a_mask_shape_the_layers_do_not_have_is_not_read_as_one() {
        // A sign only on an angle; no radial angle; no named angle; no radial
        // member outside at/size; a side with no stop.
        for class in [
            "-mask-linear-from-20%",
            "-mask-linear-(--a)",
            "-mask-radial-at-top",
            "mask-linear-top",
            "mask-radial-nowhere",
            "-mask-b-from-20%",
            "-mask-add",
        ] {
            assert_eq!(mask_json(class), "null", "{class}");
        }
        // Not a layer or keyword: left to the prefix path.
        assert_eq!(mask_json("mask-b-20"), r#"{"prop":"mask","value":"b-20"}"#);
        assert_eq!(mask_json("mask-none"), r#"{"prop":"mask","value":"none"}"#);
    }
}
