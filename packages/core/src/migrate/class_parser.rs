//! One Tailwind utility class to one sz prop and value.
//!
//! The order of attempts is the TypeScript's: the container and group markers,
//! the fixed prop-and-value classes, the gradient grammar, then the longest
//! known prefix whose value the rules accept, and last an arbitrary custom
//! property declaration. A class that none of them recognises is `None`, and
//! the caller keeps it in `className`.

use super::class_rules::{
    self, decode_arbitrary_spaces, is_fraction, is_valid_spacing_value, signed_string, wrapped,
    Shape, SHADOW_SIZE_PROPS,
};
use super::value::{js_number, js_number_to_string, Extra, ParsedClass, SzObject, SzValue};
use super::verdict::{lowered_class, lowers_back_to, Judge};
use crate::transform::generated::migrate_tables as tables;
use crate::transform::generated::reverse_tables::reverse_property_key;

/// Parse a single Tailwind utility, without variants, into an sz prop and
/// value. `None` when the class is not one migrate recognises.
pub fn parse_class(class: &str) -> Option<ParsedClass> {
    parse_class_judged(class, Judge::default())
}

/// [`parse_class`], with the project's Tailwind answering where a table would.
pub fn parse_class_judged(class: &str, judge: Judge<'_>) -> Option<ParsedClass> {
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
    if let Some(utility) = parse_longest_prefix(source, negative, judge) {
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

/// The class read by the longest known prefix its text starts with.
///
/// A class that is exactly a prefix and refused by it still falls to a
/// shorter one. A class with a value does not: the longest prefix `P` that
/// matches `P-<value>` owns it, and its refusal is the answer. Every shorter
/// prefix that matches is a strict prefix `Q` of `P` (`P = Q-…`), which would
/// read `P`'s own segment as its value — `translate` taking `-z-1/2` that
/// `translate-z` refused, as `{ color: '-z-1', op: 2 }`. `SORTED_PREFIXES`
/// runs longest first, so the first valued match is that `P`.
fn parse_longest_prefix(source: &str, negative: bool, judge: Judge<'_>) -> Option<ParsedClass> {
    for prefix in tables::SORTED_PREFIXES {
        if source == *prefix {
            if let Some(exact) = parse_exact_prefix(prefix, negative) {
                return Some(exact);
            }
            continue;
        }
        if valued_by(source, prefix) {
            return parse_valued_prefix(source, prefix, negative, judge);
        }
    }
    None
}

/// Whether `source` is `prefix`, a `-`, and something after it.
fn valued_by(source: &str, prefix: &str) -> bool {
    source
        .strip_prefix(prefix)
        .and_then(|rest| rest.strip_prefix('-'))
        .is_some_and(|value| !value.is_empty())
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
///
/// Where one of migrate's tables decides the class, the judge has the last
/// word (see `verdict.rs`): the project's Tailwind when the caller asked it,
/// the table otherwise. A class the project serves and the table refused
/// migrates only to a reading that lowers back to it.
fn parse_valued_prefix(
    source: &str,
    prefix: &'static str,
    negative: bool,
    judge: Judge<'_>,
) -> Option<ParsedClass> {
    let raw_value = source.strip_prefix(prefix)?.strip_prefix('-')?;
    if raw_value.is_empty() || (negative && !tables::negative_allowed(prefix)) {
        return None;
    }
    if tables::spacing_props(prefix) && !is_valid_spacing_value(raw_value) {
        return None;
    }
    let reading = read_value(prefix, raw_value, negative);
    let Some(table) = reading.table else {
        return reading.parsed;
    };
    let class = if negative {
        format!("-{source}")
    } else {
        source.to_string()
    };
    if !judge.served(&class, table) {
        return None;
    }
    if table {
        return reading.parsed;
    }
    reading
        .parsed
        .or_else(|| {
            is_fraction(raw_value).then(|| {
                let prop = reverse_property_key(prefix).unwrap_or(prefix);
                ParsedClass::new(prop, signed_string(raw_value, negative))
            })
        })
        .filter(|parsed| lowers_back_to(parsed, &class))
}

/// A value read by its prefix's rules, and the table's verdict when one of
/// migrate's tables decided whether the class is served.
struct Reading {
    /// The reading, as if every table had said yes; `None` when the rules
    /// have none.
    parsed: Option<ParsedClass>,
    /// `Some(false)` when a table refused the class, `Some(true)` when a
    /// table let it through, `None` when no table was asked.
    table: Option<bool>,
}

fn read_value(prefix: &str, raw_value: &str, negative: bool) -> Reading {
    // A keyword Tailwind serves no negative of: `-z-auto`, `-scale-none`.
    let unsigned_keyword = negative && unsigned_keyword_value(raw_value);
    let (parsed, not_colour) = match disambiguate_and_parse(prefix, raw_value, negative) {
        Ok(parsed) => (Some(parsed), false),
        Err(Unread::NotColour) => (None, true),
        Err(Unread::NoRule) => (None, false),
    };
    let fraction = is_fraction(raw_value).then(|| {
        parsed.as_ref().is_some_and(|parsed| {
            takes_fractions(&parsed.prop) && (!negative || signs_fractions(&parsed.prop))
        })
    });
    let table = if unsigned_keyword || not_colour {
        Some(false)
    } else {
        fraction
    };
    Reading { parsed, table }
}

/// Whether the sz key `prop` has a fraction utility (`w-1/2`).
///
/// The lowering's own list answers it. `m-1/2`, which Tailwind serves nothing
/// for, read as `m-1` with an opacity modifier and lost the modifier; a key
/// with no fraction is not one a fraction migrates to.
fn takes_fractions(prop: &str) -> bool {
    crate::transform::generated::tables::is_fraction_supported_prop(prop)
}

/// Whether Tailwind serves a sign on a fraction for the sz key `prop`.
///
/// The capability table the lowering reads answers it, so `-m-1/2` — which
/// Tailwind serves nothing for, and which read as `-m-1` with an opacity
/// modifier dropped — stays in `className` while `-inset-1/2` migrates.
fn signs_fractions(prop: &str) -> bool {
    use crate::transform::generated::tables::{sz_capabilities, SZ_CAP_SIGN_FRACTION};
    sz_capabilities(prop) & SZ_CAP_SIGN_FRACTION != 0
}

/// Whether `value` ends in a keyword no negative sign applies to.
///
/// The keyword is read off the value's last segment, so a shorter prefix
/// cannot take the axis in as part of its value: with `scale-x` refused,
/// `-scale-x-none` would otherwise read as `scale` of `-x-none`.
fn unsigned_keyword_value(value: &str) -> bool {
    tables::unsigned_keywords(value.rsplit('-').next().unwrap_or(value))
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

/// Why a value with an optional `/modifier` has no reading.
enum Unread {
    /// A modifier on a value that is not a colour.
    NotColour,
    /// The prefix's rules do not read the value.
    NoRule,
}

/// Split off a `/modifier`, read the value by the prefix's rules, then put
/// the modifier back as the form the key takes: a line-height companion for
/// `text`, the verbatim class for a shadow size, `{ color, op }` otherwise.
fn disambiguate_and_parse(
    prefix: &str,
    raw_value: &str,
    negative: bool,
) -> Result<ParsedClass, Unread> {
    let (value, opacity) = extract_opacity(prefix, raw_value);
    let result = disambiguate(prefix, value, negative).ok_or(Unread::NoRule)?;
    let Some(opacity) = opacity else {
        return Ok(result);
    };
    // A modifier is an opacity only on a colour, and no number is a colour:
    // `m-2/50` keeping `{ m: 2 }` dropped the `/50` it could not place.
    let SzValue::String(text) = &result.value else {
        return Err(Unread::NotColour);
    };

    if result.prop == "text" {
        let slash = find_top_level_slash(raw_value).map_or(0, |index| index + 1);
        return Ok(ParsedClass {
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
        return Ok(ParsedClass::new(&result.prop, raw_value));
    }
    let mut colour = SzObject::new();
    colour.insert("color".to_string(), SzValue::from(text.as_str()));
    colour.insert("op".to_string(), opacity);
    Ok(ParsedClass::new(&result.prop, SzValue::Object(colour)))
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
    if is_bracketed_fraction_utility(prefix, &shape) {
        return None;
    }
    let (_, rule) = class_rules::select(class_rules::rules_for(prefix), &shape)?;
    let parsed = ParsedClass::new(
        &class_rules::prop_name(rule, prefix),
        class_rules::emit(rule, prefix, &shape, negative)?,
    );
    if names_untyped_variable_of_another_type(prefix, &shape, &parsed.prop) {
        return None;
    }
    let nested = shape.paren.is_some_and(|inner| inner.contains('('));
    (lowers_as_reference(&parsed, nested) && lowers_without_spaces(&parsed)).then_some(parsed)
}

/// Whether the class names a custom property with no type (`(--v)`,
/// `(--v,1px)`, `[var(--v)]`) on its key's own prefix, for a key whose
/// lowering writes the variable with a type.
///
/// Tailwind gives an untyped variable to the prefix's default utility:
/// `border-s-(--v)` is the inline-start border COLOUR. A key with a type hint
/// is one that sets something else on that prefix (`borderS` is the width,
/// lowered to `border-s-(length:--v)`), so the reading would change what the
/// element sets; the class stays in `className` unless a rule read it onto the
/// default's own key first. A class on another prefix (`bg-size-(--v)`) is
/// already typed by its prefix.
fn names_untyped_variable_of_another_type(prefix: &str, shape: &Shape<'_>, prop: &str) -> bool {
    use crate::transform::generated::tables::{css_var_type_hint, property_prefix};
    let untyped = shape.paren.is_some_and(|inner| inner.starts_with("--"))
        || shape.bracket.is_some_and(|inner| inner.starts_with("var("));
    untyped && css_var_type_hint(prop).is_some() && property_prefix(prop) == Some(prefix)
}

/// Whether a value with a space in it — an arbitrary value's underscores,
/// read as spaces — lowers to one class with none.
///
/// A class cannot hold a space: `brightness: 'calc(1px + 2px)'` lowered to
/// `brightness-[calc(1px + 2px)]`, which the page reads as two classes. Where
/// the lowering writes the underscores back, the value migrates.
fn lowers_without_spaces(parsed: &ParsedClass) -> bool {
    let SzValue::String(value) = &parsed.value else {
        return true;
    };
    !value.contains(' ')
        || lowered_class(parsed).is_some_and(|class| !class.contains(char::is_whitespace))
}

/// Whether a reading written as a `(…)` reference — signed, `-(--v)`, or
/// type-hinted, `(length:--v)` — lowers to one class that ends in that same
/// reference, signed the same way.
///
/// The lowering hoists the sign of a reference for most keys and writes
/// `-m-(--v)`; for a key it does not (`scale-[-(--v)]`) the class keeps no
/// meaning, so the class stays in `className` instead. Asking the lowering
/// itself, rather than listing the keys, keeps the answer right for both
/// artifacts as the lowering changes. A bare `--v` is the spelling every key
/// writes back as `(--v)`, and is asked only when the class's reference holds
/// parens of its own (`nested`): `m: '--v,calc(1px*2)'` lowered to
/// `m-[--v,calc(1px*2)]`, the word, not the property.
fn lowers_as_reference(parsed: &ParsedClass, nested: bool) -> bool {
    let SzValue::String(value) = &parsed.value else {
        return true;
    };
    let (signed, reference) = match value.strip_prefix('-') {
        Some(rest) if rest.starts_with('(') => (true, rest.to_string()),
        _ if value.starts_with('(') => (false, value.clone()),
        _ if nested && value.starts_with("--") => (false, format!("({value})")),
        _ => return true,
    };
    lowered_class(parsed).is_some_and(|class| {
        class.starts_with('-') == signed && class.ends_with(&format!("-{reference}"))
    })
}

/// `w-[1/2]`: a bracketed fraction on a prefix whose bare fraction is a
/// different utility.
///
/// The bracket is the literal `width: 1/2`; the value `1/2` lowers to
/// `w-1/2`, which is `calc(1/2 * 100%)`, and no sz value writes the bracket
/// back. `aspect` is the exception: its fraction utility is the ratio itself,
/// so `aspect-[16/9]` and `aspect-16/9` set the same `aspect-ratio`.
fn is_bracketed_fraction_utility(prefix: &str, shape: &Shape<'_>) -> bool {
    prefix != "aspect"
        && tables::fraction_supported(prefix)
        && shape.bracket.is_some_and(is_fraction)
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;
    use crate::migrate::class_rules::{prop_name, rules_for, select, RULE_TABLES};

    #[test]
    fn a_sign_on_a_fraction_migrates_only_for_a_key_the_table_signs_fractions_for() {
        // `inset` reads `-inset-1/2`; `m` has a signed number but no signed
        // fraction, so `-m-1/2` stays a class.
        assert!(signs_fractions("inset"));
        assert!(!signs_fractions("m"));
        assert!(!signs_fractions("not-an-sz-key"));
    }

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
            if valued_by(source, prefix) {
                parse_valued_prefix(source, prefix, negative, Judge::default())?;
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

    /// One parsed class as `prop=value`, for a compact expectation.
    fn prop_value(class: &str) -> String {
        parse_class(class).map_or_else(
            || "null".to_string(),
            |parsed| {
                let value = serde_json::to_string(&parsed.value).expect("a value serialises");
                format!("{}={value}", parsed.prop)
            },
        )
    }

    #[test]
    fn a_logical_size_fraction_keeps_its_fraction() {
        // `block-1/2` is half the containing block. Read as an opacity
        // modifier it became `blockSize: 1`, a quarter-rem, with no warning.
        for (class, expected) in [
            ("block-1/2", r#"blockSize="1/2""#),
            ("inline-1/3", r#"inlineSize="1/3""#),
            ("min-block-1/2", r#"minBlockSize="1/2""#),
            ("max-block-2/3", r#"maxBlockSize="2/3""#),
            ("min-inline-1/4", r#"minInlineSize="1/4""#),
            ("max-inline-3/4", r#"maxInlineSize="3/4""#),
            ("block-4", "blockSize=4"),
        ] {
            assert_eq!(prop_value(class), expected, "{class}");
        }
    }

    #[test]
    fn a_negative_keyword_is_not_read_as_a_value() {
        // Tailwind serves `scale-none` and `order-first` as fixed classes and
        // no negative of them, so `-scale-none` styles nothing. Migrated, it
        // became `scale: '-none'` and left the report saying every class was
        // understood; unrecognized is the answer that keeps it visible.
        for class in [
            "-scale-none",
            "-scale-3d",
            "-scale-x-none",
            "-outline-offset-none",
            "-rotate-none",
            "-translate-none",
            "-order-first",
            "-order-last",
            // `auto` and `screen` had their sign dropped instead, which wrote
            // `{ z: 'auto' }` — a served class — for an input with no CSS.
            "-m-auto",
            "-mx-auto",
            "-z-auto",
            "-underline-offset-auto",
            "-inset-x-auto",
            "-start-auto",
            "-scroll-m-auto",
            "-translate-x-auto",
            "-translate-y-screen",
        ] {
            assert_eq!(prop_value(class), "null", "{class}");
        }
        // A number, a fraction, an arbitrary value and a theme token keep
        // their sign: Tailwind serves each of these.
        for (class, expected) in [
            ("-scale-50", "scale=-50"),
            ("-outline-offset-2", "outlineOffset=-2"),
            ("-m-px", r#"m="-px""#),
            ("-translate-x-full", r#"translateX="-full""#),
            ("-inset-y-full", r#"insetY="-full""#),
            ("-translate-x-px", r#"translateX="-px""#),
            ("-indent-px", r#"indent="-px""#),
            ("-top-1/2", r#"top="-1/2""#),
            ("-mt-[5px]", r#"mt="-5px""#),
            ("-tracking-tight", r#"tracking="-tight""#),
        ] {
            assert_eq!(prop_value(class), expected, "{class}");
        }
    }

    #[test]
    fn a_sign_on_a_fraction_needs_the_signed_fraction_column() {
        // Tailwind serves no `-m-1/2`: margin takes no fraction. Read as an
        // opacity modifier on `1`, the `/2` was dropped and the class migrated
        // to `{ m: -1 }`, a quarter-rem the source never asked for.
        for class in ["-m-1/2", "-mx-1/3", "-mt-2/3", "-scroll-m-1/2"] {
            assert_eq!(prop_value(class), "null", "{class}");
        }
        // The keys whose row carries the signed-fraction column keep it.
        for (class, expected) in [
            ("-inset-1/2", r#"inset="-1/2""#),
            ("-inset-x-1/3", r#"insetX="-1/3""#),
            ("-top-1/2", r#"top="-1/2""#),
            ("-translate-x-1/2", r#"translateX="-1/2""#),
            ("-translate-y-1/4", r#"translateY="-1/4""#),
        ] {
            assert_eq!(prop_value(class), expected, "{class}");
        }
    }

    #[test]
    fn an_opacity_modifier_needs_a_colour_value() {
        // Tailwind serves no `m-1/2`: margin takes no fraction. Read as an
        // opacity modifier on `1`, the `/2` was dropped because the value is a
        // number, and the class migrated to `{ m: 1 }` — a quarter-rem the
        // source never asked for. A number is never a colour, so a modifier on
        // one is not an opacity, and a fraction on a key with no fraction
        // utility is not a value.
        for class in [
            "m-1/2",
            "mx-1/3",
            "p-1/2",
            "gap-1/2",
            "m-2/50",
            "border-2/50",
            "ring-2/50",
            "z-1/2",
            "bg-1/2",
            "text-1/2",
        ] {
            assert_eq!(prop_value(class), "null", "{class}");
        }
        // A colour keeps its modifier, a fraction utility its fraction, and
        // the size-and-line-height and shadow modifiers are their own forms.
        for (class, expected) in [
            ("bg-red-500/50", r#"bg={"color":"red-500","op":50}"#),
            ("text-brand/25", r#"color={"color":"brand","op":25}"#),
            ("w-1/2", r#"w="1/2""#),
            ("aspect-3/2", r#"aspect="3/2""#),
            ("flex-1/2", r#"flex="1/2""#),
            ("shadow-lg/50", r#"shadow="lg/50""#),
        ] {
            assert_eq!(prop_value(class), expected, "{class}");
        }
        assert_eq!(
            parse_class("text-sm/6").map(|parsed| parsed.prop),
            Some("text".to_string())
        );
    }

    #[test]
    fn a_shorter_prefix_does_not_take_a_longer_ones_class() {
        // `translate-z` refused `-1/2` (no fraction), and `translate`, a
        // strict prefix of it, then read `-z-1/2` as a colour with an opacity:
        // `translate: { color: '-z-1', op: 2 }`.
        for class in [
            "-translate-z-1/2",
            "translate-z-1/2",
            "-scale-x-none",
            "-scale-z-none",
        ] {
            assert_eq!(prop_value(class), "null", "{class}");
        }
        assert_eq!(prop_value("-translate-z-2"), "translateZ=-2");
        assert_eq!(prop_value("translate-z-px"), r#"translateZ="px""#);
    }

    /// The longest known prefix the class text starts with, followed by a
    /// `-` and a value.
    fn longest_textual_prefix(source: &str) -> Option<&'static str> {
        tables::SORTED_PREFIXES.iter().copied().find(|prefix| {
            source
                .strip_prefix(prefix)
                .and_then(|rest| rest.strip_prefix('-'))
                .is_some_and(|value| !value.is_empty())
        })
    }

    /// Every sz key a class read by `prefix` can write.
    fn keys_of_prefix(prefix: &str) -> Vec<String> {
        let mut keys: Vec<String> = rules_for(prefix)
            .iter()
            .map(|rule| prop_name(rule, prefix))
            .collect();
        keys.extend(tables::reverse_boolean(prefix).map(str::to_string));
        keys.push(reverse_property_key(prefix).unwrap_or(prefix).to_string());
        keys
    }

    #[test]
    fn the_longest_matching_prefix_decides_every_class() {
        // Property over the whole prefix table: for every prefix P, every
        // value shape and either sign, a class `P-<value>` is read by the
        // longest prefix its text starts with, or not at all. A strict prefix
        // Q of P (P = `Q-…`) taking it reads P's own segment as Q's value —
        // `translate` of `-z-1/2`, `scale` of `-x-none` — which no Tailwind
        // class means.
        const VALUES: &[&str] = &[
            "2",
            "1/2",
            "0.5",
            "px",
            "full",
            "auto",
            "none",
            "red-500",
            "red-500/50",
            "brand/25",
            "[3px]",
            "[50%]",
            "(--v)",
            "x-2",
            "y-1/2",
            "z-1/2",
            "s-4",
            "inherit",
        ];
        let mut checked = 0_usize;
        let mut shadowed = Vec::new();
        for prefix in tables::SORTED_PREFIXES {
            let classes = VALUES.iter().map(|value| format!("{prefix}-{value}"));
            for class in classes {
                for signed in [class.clone(), format!("-{class}")] {
                    checked += 1;
                    let (negative, source) = signed
                        .strip_prefix('-')
                        .map_or((false, signed.as_str()), |source| (true, source));
                    let earlier = parse_container_marker(&signed).is_some()
                        || parse_mask(&signed).is_some()
                        || is_mask_layer_class(&signed)
                        || try_boolean_match(&signed).is_some()
                        || try_gradient(source, negative).is_some();
                    let (Some(parsed), Some(longest), false) = (
                        parse_class(&signed),
                        longest_textual_prefix(source),
                        earlier,
                    ) else {
                        continue;
                    };
                    if !keys_of_prefix(longest).contains(&parsed.prop) {
                        shadowed.push(format!("{signed} -> {} (not {longest})", parsed.prop));
                    }
                }
            }
        }
        assert!(checked > 5_000, "checked only {checked}");
        assert!(
            shadowed.is_empty(),
            "read by a shorter prefix: {shadowed:?}"
        );
    }

    #[test]
    fn every_align_content_keyword_is_align_content() {
        // `content-center-safe` is `align-content: safe center`; read as the
        // `content` property it lowered to `content-[center-safe]`.
        for keyword in [
            "normal",
            "center",
            "center-safe",
            "start",
            "end",
            "end-safe",
            "between",
            "around",
            "evenly",
            "baseline",
            "stretch",
        ] {
            assert_eq!(
                prop_value(&format!("content-{keyword}")),
                format!(r#"alignContent="{keyword}""#),
                "content-{keyword}"
            );
        }
    }

    /// One parsed mask class as JSON, for a compact expectation.
    #[test]
    fn a_sign_on_a_custom_property_stays_outside_the_reference() {
        // `-m-(--v)` is `calc(var(--v) * -1)`. Written into the reference it
        // became `m: '---v'`, which lowers to `m-(---v)` and reads a property
        // named `---v` that nothing sets.
        for (class, expected) in [
            ("-m-(--v)", r#"m="-(--v)""#),
            ("-mt-(--gap)", r#"mt="-(--gap)""#),
            ("-z-(--layer)", r#"z="-(--layer)""#),
            ("-inset-x-(--v)", r#"insetX="-(--v)""#),
            ("-space-x-(--v)", r#"spaceX="-(--v)""#),
            ("-outline-offset-(--v)", r#"outlineOffset="-(--v)""#),
            ("-translate-x-(--v,2px)", r#"translateX="-(--v,2px)""#),
            // Unsigned, the reference is the value.
            ("m-(--v)", r#"m="--v""#),
        ] {
            assert_eq!(prop_value(class), expected, "{class}");
        }
    }

    #[test]
    fn a_sign_on_an_arbitrary_value_needs_a_form_that_carries_it() {
        // A length takes the sign inside the bracket: `m-[-10px]` is the
        // margin `-[10px]` asked for.
        assert_eq!(prop_value("-m-[10px]"), r#"m="-10px""#);
        assert_eq!(prop_value("-rotate-[45deg]"), r#"rotate="-45deg""#);
        assert_eq!(prop_value("-m-[.5rem]"), r#"m="-.5rem""#);
        // A variable does not: `-var(--v)` is not CSS, so `m-[-var(--v)]`
        // styled nothing. The reference form carries the sign outside.
        assert_eq!(prop_value("-m-[var(--v)]"), r#"m="-(--v)""#);
        assert_eq!(prop_value("-z-[var(--v,1)]"), r#"z="-(--v,1)""#);
        // A `var()` with a nested fallback is still one call.
        // A fallback with parens of its own is one call too, but the lowering
        // brackets it (`m-[-(--v,calc(1px*2))]`), so it stays in `className`,
        // signed or not.
        assert_eq!(prop_value("-m-[var(--v,calc(1px*2))]"), "null");
        assert_eq!(prop_value("m-(--v,calc(1px*2))"), "null");
        // Nothing else has a signed form the lowering writes back: not a
        // call that does not name a custom property, not two calls.
        for class in [
            "-m-[var(x)]",
            "-m-[var(--a)_+_var(--b)]",
            "-m-[calc(1px+2px)]",
            "-m-[theme(spacing.4)]",
            "-z-[var(--a)_+_1]",
        ] {
            assert_eq!(prop_value(class), "null", "{class}");
        }
    }

    #[test]
    fn a_bracketed_fraction_is_not_read_as_a_fraction_utility() {
        // `w-[1/2]` is the literal `width: 1/2`; as `w: '1/2'` it lowered to
        // `w-1/2`, which is `calc(1/2 * 100%)`. No sz value writes the
        // bracket back, so the class stays in `className`.
        for class in [
            "w-[1/2]",
            "translate-x-[1/2]",
            "flex-[1/2]",
            "-top-[1/2]",
            "-z-[1/2]",
        ] {
            assert_eq!(prop_value(class), "null", "{class}");
        }
        assert_eq!(prop_value("aspect-[16/9]"), r#"aspect="16/9""#);
    }

    #[test]
    fn a_custom_property_keeps_the_meaning_tailwind_gives_it() {
        // `perspective-origin-(--v)` is `perspective-origin: var(--v)`; the
        // bare name lowered to `perspective-origin-[--v]`, the word `--v`.
        assert_eq!(
            prop_value("perspective-origin-(--v)"),
            r#"perspectiveOrigin="var(--v)""#
        );
        // `font-(--v)` is a font weight. Read as a family it lowered to
        // `font-(family-name:--v)` and changed what the element set.
        assert_eq!(prop_value("font-(--v)"), r#"weight="(--v)""#);
        // The hint keeps its parens: `fontFamily: 'family-name:--v'` lowered
        // to `font-family-name:--v`, no class at all.
        assert_eq!(
            prop_value("font-(family-name:--v)"),
            r#"fontFamily="(family-name:--v)""#
        );
    }

    #[test]
    fn a_type_hinted_reference_keeps_its_parens() {
        // `p-length:--v` and `bg-color:--c` are not classes; the parens are.
        for (class, expected) in [
            ("p-(length:--v)", r#"p="(length:--v)""#),
            ("bg-(color:--c)", r#"bg="(color:--c)""#),
            (
                "backdrop-hue-rotate-(length:--v)",
                r#"backdropHueRotate="(length:--v)""#,
            ),
            // `(--v,1px)` is a fallback, not a hint.
            ("p-(--v,1px)", r#"p="--v,1px""#),
        ] {
            assert_eq!(prop_value(class), expected, "{class}");
        }
    }

    #[test]
    fn a_type_hint_on_bg_names_the_key_it_sets() {
        // `bg-[length:…]` is background-size and `bg-[position:…]` is
        // background-position: the lowering writes `bgSize` and `bgPos` that
        // way, since `bg-size-*` and `bg-position-*` exist from Tailwind 4.1
        // only. Read as `bg`, the colour key held a size.
        for (class, expected) in [
            ("bg-[length:auto_100px]", r#"bgSize="auto 100px""#),
            ("bg-[length:var(--x)]", r#"bgSize="var(--x)""#),
            ("bg-(length:--x)", r#"bgSize="--x""#),
            ("bg-[position:10px_20px]", r#"bgPos="10px 20px""#),
            ("bg-(position:--x)", r#"bgPos="--x""#),
            ("bg-(length:--my_size)", r#"bgSize="--my_size""#),
            // The 4.1+ spellings stay readable.
            ("bg-size-[auto_100px]", r#"bgSize="auto 100px""#),
            ("bg-size-(--x)", r#"bgSize="--x""#),
            // Other hints keep their reading.
            ("bg-(color:--c)", r#"bg="(color:--c)""#),
        ] {
            assert_eq!(prop_value(class), expected, "{class}");
        }
    }

    #[test]
    fn a_reference_the_lowering_cannot_write_back_stays_in_class_name() {
        // `scale: '-(--v)'` lowers to `scale-[-(--v)]`, and a signed hint to
        // `m-[-(length:--v)]`: neither is the class, so neither migrates.
        for class in ["-scale-(--v)", "-scale-[var(--v)]", "-m-(length:--v)"] {
            assert_eq!(prop_value(class), "null", "{class}");
        }
        // `perspectiveOrigin: '(length:--v)'` lowers to a bracket around it.
        assert_eq!(prop_value("perspective-origin-(length:--v)"), "null");
    }

    #[test]
    fn a_value_the_lowering_writes_with_a_space_stays_in_class_name() {
        // `brightness-[calc(1px + 2px)]` is two classes on the page.
        assert_eq!(prop_value("brightness-[calc(1px_+_2px)]"), "null");
        // Where the lowering writes the underscores back, the value migrates.
        assert_eq!(prop_value("p-[calc(1px_+_2px)]"), r#"p="calc(1px + 2px)""#);
        assert_eq!(prop_value("grid-cols-[1fr_2fr]"), r#"gridCols="1fr 2fr""#);
    }

    /// One class read with the given answers: `prop=value` or `null`, and
    /// the classes left to the table, as `class:served`.
    fn judged(class: &str, answers: &[(&str, bool)]) -> (String, Vec<String>) {
        use crate::migrate::verdict::{ServedAnswers, TableVerdicts};
        let answers: ServedAnswers = answers
            .iter()
            .map(|(class, served)| ((*class).to_string(), *served))
            .collect();
        let asked = TableVerdicts::default();
        let read = parse_class_judged(class, Judge::new(Some(&answers), Some(&asked))).map_or_else(
            || "null".to_string(),
            |parsed| {
                let value = serde_json::to_string(&parsed.value).expect("a value serialises");
                format!("{}={value}", parsed.prop)
            },
        );
        let asked = asked
            .into_sorted()
            .into_iter()
            .map(|verdict| format!("{}:{}", verdict.class, verdict.served))
            .collect();
        (read, asked)
    }

    #[test]
    fn a_class_a_table_decides_is_written_down_with_the_tables_verdict() {
        for (class, read, asked) in [
            ("-m-1/2", "null", "-m-1/2:false"),
            ("-scroll-m-1/2", "null", "-scroll-m-1/2:false"),
            ("m-1/2", "null", "m-1/2:false"),
            ("m-2/50", "null", "m-2/50:false"),
            ("-z-auto", "null", "-z-auto:false"),
            ("-order-first", "null", "-order-first:false"),
            ("-inset-1/2", r#"inset="-1/2""#, "-inset-1/2:true"),
            ("w-1/2", r#"w="1/2""#, "w-1/2:true"),
        ] {
            let expected = (
                read.to_string(),
                asked
                    .split(' ')
                    .filter(|entry| !entry.is_empty())
                    .map(str::to_string)
                    .collect::<Vec<_>>(),
            );
            assert_eq!(judged(class, &[]), expected, "{class}");
        }
        // No table decides these: nothing to ask.
        for class in [
            "-m-4",
            "bg-red-500/50",
            "p-4",
            "-translate-x-full",
            "text-sm/6",
        ] {
            assert_eq!(judged(class, &[]).1, Vec::<String>::new(), "{class}");
        }
    }

    #[test]
    fn the_projects_answer_wins_over_the_table() {
        // Served by the table, not by this project: stays in `className`.
        assert_eq!(judged("-inset-1/2", &[("-inset-1/2", false)]).0, "null");
        assert_eq!(judged("w-1/2", &[("w-1/2", false)]).0, "null");
        // An answered class is not asked about again.
        assert_eq!(
            judged("w-1/2", &[("w-1/2", true)]),
            (r#"w="1/2""#.to_string(), Vec::new())
        );
        // Refused by the table, served by this project: migrates to the sz
        // value that lowers back to the class.
        for (class, expected) in [
            ("-z-auto", r#"z="-auto""#),
            ("-m-auto", r#"m="-auto""#),
            ("-order-first", r#"order="-first""#),
            ("-m-1/2", r#"m="-1/2""#),
        ] {
            assert_eq!(judged(class, &[(class, true)]).0, expected, "{class}");
        }
        // Served, but no sz value lowers back to it: stays in `className`.
        // `scale: '-none'` lowers to `scale-[-none]`, `m: '1/2'` to `m-[1/2]`.
        assert_eq!(judged("-scale-none", &[("-scale-none", true)]).0, "null");
        assert_eq!(judged("m-1/2", &[("m-1/2", true)]).0, "null");
        assert_eq!(judged("m-2/[50]", &[("m-2/[50]", true)]).0, "null");
        // Not served, and the table refused it too.
        assert_eq!(judged("-m-1/2", &[("-m-1/2", false)]).0, "null");
    }

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
            "mask-linear-",
        ] {
            assert_eq!(mask_json(class), "null", "{class}");
        }
        // A `%` needs a number before it to be a position; anything else is
        // read as a colour name.
        assert_eq!(
            mask_json("mask-linear-from-x%"),
            r#"{"prop":"maskLinear","value":{"from":{"color":"x%"}}}"#
        );
        assert_eq!(
            mask_json("mask-linear-to-%"),
            r#"{"prop":"maskLinear","value":{"to":{"color":"%"}}}"#
        );
        // Not a layer or keyword: left to the prefix path.
        assert_eq!(mask_json("mask-b-20"), r#"{"prop":"mask","value":"b-20"}"#);
        assert_eq!(mask_json("mask-none"), r#"{"prop":"mask","value":"none"}"#);
    }
}
