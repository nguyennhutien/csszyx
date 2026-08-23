//! How a value's shape decides which of a shared prefix's keys a class means.
//!
//! `text-sm`, `text-center` and `text-red-500` share a prefix and mean three
//! sz keys. The TypeScript decides with one hand-written function per prefix;
//! here that knowledge is data. One reader takes the shape of a value — is it
//! a number, a bracket, a known keyword — and one table per prefix lists, in
//! order, which shape goes to which key and how its value is spelled. The
//! parity test holds every row to the TypeScript's answer, and the
//! reachability test refuses a row no class in the corpus reaches: a rule
//! nobody can hit is a rule nobody can check.

use super::value::{js_number, SzValue};
use crate::transform::generated::migrate_tables as tables;
use crate::transform::generated::reverse_tables::reverse_property_key;

/// The facts about a value the rules decide on, read once per class.
pub struct Shape<'a> {
    pub value: &'a str,
    /// What JavaScript's `Number()` makes of the value.
    pub number: Option<f64>,
    /// The inside of a `[...]` arbitrary value.
    pub bracket: Option<&'a str>,
    /// The inside of a `(...)` custom-property reference.
    pub paren: Option<&'a str>,
}

impl<'a> Shape<'a> {
    pub fn read(value: &'a str) -> Self {
        Self {
            value,
            number: js_number(value),
            bracket: wrapped(value, '[', ']'),
            paren: wrapped(value, '(', ')'),
        }
    }

    /// `Number.isInteger(Number(value))`.
    fn is_integer(&self) -> bool {
        self.number
            .is_some_and(|number| number.is_finite() && number.fract() == 0.0)
    }
}

/// The inside of a value wrapped in `open`…`close`.
///
/// Follows `value.slice(1, -1)` exactly: a lone `[` both starts and ends with
/// its bracket in JavaScript, and its inside is the empty string.
pub fn wrapped(value: &str, open: char, close: char) -> Option<&str> {
    if !(value.starts_with(open) && value.ends_with(close)) {
        return None;
    }
    Some(if value.len() >= 2 {
        &value[1..value.len() - 1]
    } else {
        ""
    })
}

/// The shape a rule asks for.
pub enum Test {
    Always,
    /// The value is in one of migrate's keyword sets.
    Keyword(fn(&str) -> bool),
    Is(&'static str),
    OneOf(&'static [&'static str]),
    /// Exactly three ASCII digits: a numeric font weight.
    ThreeDigits,
    /// `Number(value)` is a finite integer.
    Integer,
    /// ASCII digits only.
    Digits,
    /// `12%` or `12.5%`.
    Percent,
    /// A bracketed CSS length, such as `[1.5px]`.
    ArbitraryDimension,
    Bracket,
    Paren,
    /// `(color:--c)`: the custom property names the colour, not the value.
    ParenColor,
    ParenOrArbitraryDimension,
    /// The value begins with a fixed marker.
    StartsWith(&'static str),
    /// `[center_top_1rem]`: several tokens led by a position keyword.
    BracketPositionList,
}

/// How the matched rule spells the value.
pub enum Emit {
    Verbatim,
    Literal(&'static str),
    /// Brackets and parens stripped, underscores read as spaces.
    Unwrapped,
    /// The integer the value reads as.
    Number,
    /// The integer, negated when the class was.
    SignedNumber,
    ParenInner,
    ParenColorInner,
    /// The bracket's inside with underscores read as spaces.
    BracketInner,
    /// The general value reading, sign applied.
    ParseValue,
    /// The general value reading, the class's sign ignored.
    ParseValueUnsigned,
}

/// Which sz key the matched rule writes.
pub enum Prop {
    Key(&'static str),
    /// The prefix itself: `from-red-500` is `from`.
    Prefix,
    /// The prefix's position key: `from-4%` is `fromPos`.
    PrefixPos,
    /// The reverse map's key for the prefix, or the prefix when it has none.
    Reverse,
}

pub struct Rule {
    pub when: Test,
    pub prop: Prop,
    pub emit: Emit,
}

/// A rule row. A macro rather than a `const fn` so the table is literals
/// and carries no function that only ever runs at compile time.
macro_rules! rule {
    ($when:expr, $prop:expr, $emit:expr $(,)?) => {
        Rule {
            when: $when,
            prop: $prop,
            emit: $emit,
        }
    };
}

use Emit::{
    BracketInner, Literal, Number, ParenColorInner, ParenInner, ParseValue, ParseValueUnsigned,
    SignedNumber, Unwrapped, Verbatim,
};
use Prop::{Key, Prefix, PrefixPos, Reverse};
use Test::{
    Always, ArbitraryDimension, Bracket, BracketPositionList, Digits, Integer, Is, Keyword, OneOf,
    Paren, ParenColor, ParenOrArbitraryDimension, Percent, StartsWith, ThreeDigits,
};

/// Prefixes where the `/` modifier is the utility's own opacity, not a colour.
pub const SHADOW_SIZE_PROPS: &[&str] = &["shadow", "insetShadow", "textShadow", "dropShadow"];

/// The rules for a prefix with no entry below: the reverse map's key, the
/// general value reading.
const DEFAULT_RULES: &[Rule] = &[rule!(Always, Reverse, ParseValue)];

/// The shadow-family split shared by `text-shadow`, `drop-shadow` and the
/// tail of `inset-shadow`: named sizes, brackets and bare custom properties
/// describe the shadow; `(color:--c)` and anything else describe its colour.
macro_rules! shadow_family {
    ($size:literal, $color:literal) => {
        [
            rule!(Keyword(tables::shadow_size_keywords), Key($size), Verbatim),
            rule!(ParenColor, Key($color), ParenColorInner),
            rule!(Paren, Key($size), ParenInner),
            rule!(Bracket, Key($size), Unwrapped),
            rule!(Always, Key($color), Unwrapped),
        ]
    };
}

/// Every prefix whose value shape picks the key, with its rules in order.
pub const RULE_TABLES: &[(&str, &[Rule])] = &[
    (
        "text",
        &[
            rule!(Keyword(tables::text_size_keywords), Key("text"), Verbatim),
            rule!(
                Keyword(tables::text_align_keywords),
                Key("textAlign"),
                Verbatim,
            ),
            rule!(
                Keyword(tables::text_wrap_keywords),
                Key("textWrap"),
                Verbatim,
            ),
            rule!(
                Keyword(tables::text_overflow_keywords),
                Key("textOverflow"),
                Verbatim,
            ),
            rule!(ArbitraryDimension, Key("text"), Unwrapped),
            rule!(Always, Key("color"), Unwrapped),
        ],
    ),
    (
        "font",
        &[
            rule!(
                Keyword(tables::font_weight_keywords),
                Key("weight"),
                Verbatim,
            ),
            rule!(ThreeDigits, Key("weight"), Number),
            rule!(
                Keyword(tables::font_family_keywords),
                Key("fontFamily"),
                Verbatim,
            ),
            // No CLASS reaches this: `font-stretch` is a longer prefix and
            // wins the longest-prefix match. The sz KEY path does — the
            // normaliser resolves a legacy `font: 'stretch-condensed'`
            // through this same table — so the rule is live, and a
            // reachability gate that walks only classes calls it dead.
            //
            // That caller reads the KEY and keeps the value it already had,
            // so the emit below is never evaluated; it names what the key
            // path leaves behind rather than what a class would want, which
            // is `condensed` without the marker. Migrating the value is a
            // behaviour change the TypeScript has not made either — today it
            // writes `fontStretch: 'stretch-condensed'`, which compiles to
            // `font-stretch-[stretch-condensed]` and generates no useful CSS.
            rule!(StartsWith("stretch-"), Key("fontStretch"), Unwrapped),
            // `font-condensed` is not a Tailwind class, so a bare keyword is
            // a family like any other word.
            rule!(Always, Key("fontFamily"), Unwrapped),
        ],
    ),
    (
        "border",
        &[
            rule!(
                Keyword(tables::border_width_keywords),
                Key("border"),
                Number
            ),
            rule!(Is("px"), Key("border"), Verbatim),
            rule!(
                Keyword(tables::border_style_keywords),
                Key("borderStyle"),
                Verbatim,
            ),
            rule!(ArbitraryDimension, Key("border"), Unwrapped),
            rule!(Always, Key("borderColor"), Unwrapped),
        ],
    ),
    (
        "bg",
        &[
            rule!(
                Keyword(tables::bg_position_keywords),
                Key("bgPos"),
                Verbatim,
            ),
            rule!(Keyword(tables::bg_size_keywords), Key("bgSize"), Verbatim),
            rule!(
                Keyword(tables::bg_repeat_keywords),
                Key("bgRepeat"),
                Verbatim,
            ),
            rule!(
                Keyword(tables::bg_attachment_keywords),
                Key("bgAttach"),
                Verbatim,
            ),
            rule!(BracketPositionList, Key("bgPos"), BracketInner),
            rule!(Is("none"), Key("bgImg"), Verbatim),
            rule!(Always, Key("bg"), Unwrapped),
        ],
    ),
    (
        "object",
        &[
            rule!(
                Keyword(tables::object_fit_keywords),
                Key("objectFit"),
                Verbatim,
            ),
            rule!(
                Keyword(tables::object_position_keywords),
                Key("objectPos"),
                Verbatim,
            ),
            rule!(Always, Key("objectPos"), Unwrapped),
        ],
    ),
    (
        "shadow",
        &[
            rule!(
                Keyword(tables::shadow_size_keywords),
                Key("shadow"),
                Verbatim,
            ),
            rule!(ParenColor, Key("shadowColor"), ParenColorInner),
            rule!(Paren, Key("shadow"), ParenInner),
            rule!(Always, Key("shadowColor"), Unwrapped),
        ],
    ),
    (
        "outline",
        &[
            rule!(
                Keyword(tables::outline_style_keywords),
                Key("outlineStyle"),
                Verbatim,
            ),
            rule!(Integer, Key("outline"), Number),
            rule!(ArbitraryDimension, Key("outline"), Unwrapped),
            rule!(Always, Key("outlineColor"), Unwrapped),
        ],
    ),
    (
        "decoration",
        &[
            rule!(
                Keyword(tables::decoration_style_keywords),
                Key("decorationStyle"),
                Verbatim,
            ),
            rule!(
                Keyword(tables::decoration_thickness_keywords),
                Key("decorationThickness"),
                Verbatim,
            ),
            rule!(
                ParenOrArbitraryDimension,
                Key("decorationThickness"),
                Unwrapped,
            ),
            rule!(Always, Key("decorationColor"), Unwrapped),
        ],
    ),
    (
        "transition",
        &[
            rule!(
                Keyword(tables::transition_property_keywords),
                Key("transition"),
                Verbatim,
            ),
            rule!(Always, Key("transition"), Unwrapped),
        ],
    ),
    (
        "ring",
        &[
            rule!(Integer, Key("ring"), SignedNumber),
            rule!(ArbitraryDimension, Key("ring"), Unwrapped),
            rule!(Always, Key("ringColor"), Unwrapped),
        ],
    ),
    (
        "ring-offset",
        &[
            rule!(Integer, Key("ringOffset"), Number),
            rule!(Always, Key("ringOffsetColor"), Unwrapped),
        ],
    ),
    (
        "inset-ring",
        &[
            rule!(Integer, Key("insetRing"), SignedNumber),
            rule!(ArbitraryDimension, Key("insetRing"), Unwrapped),
            rule!(Always, Key("insetRingColor"), Unwrapped),
        ],
    ),
    (
        "inset-shadow",
        &[
            rule!(ArbitraryDimension, Key("insetShadow"), Unwrapped),
            rule!(
                Keyword(tables::shadow_size_keywords),
                Key("insetShadow"),
                Verbatim,
            ),
            rule!(ParenColor, Key("insetShadowColor"), ParenColorInner),
            rule!(Paren, Key("insetShadow"), ParenInner),
            rule!(Bracket, Key("insetShadow"), Unwrapped),
            rule!(Always, Key("insetShadowColor"), Unwrapped),
        ],
    ),
    (
        "text-shadow",
        &shadow_family!("textShadow", "textShadowColor"),
    ),
    (
        "drop-shadow",
        &shadow_family!("dropShadow", "dropShadowColor"),
    ),
    (
        "stroke",
        &[
            rule!(Integer, Key("strokeWidth"), Number),
            rule!(ArbitraryDimension, Key("strokeWidth"), Unwrapped),
            rule!(Always, Key("stroke"), Unwrapped),
        ],
    ),
    ("from", GRADIENT_STOP_RULES),
    ("via", GRADIENT_STOP_RULES),
    ("to", GRADIENT_STOP_RULES),
    (
        "list",
        &[
            rule!(OneOf(&["inside", "outside"]), Key("listPos"), Verbatim),
            rule!(Always, Key("list"), Unwrapped),
        ],
    ),
    ("ease", &[rule!(Always, Key("ease"), ParseValue)]),
    // `snap-*` classes are all fixed prop-and-value classes and never reach
    // the prefix rules; a value that does is not one Tailwind has.
    ("snap", &[]),
    (
        "content",
        &[
            rule!(
                Keyword(tables::align_content_keywords),
                Key("alignContent"),
                Verbatim,
            ),
            rule!(Always, Key("content"), ParseValueUnsigned),
        ],
    ),
    (
        "flex",
        &[
            rule!(
                OneOf(&["row", "col", "row-reverse", "col-reverse"]),
                Key("flexDir"),
                Verbatim,
            ),
            rule!(
                OneOf(&["wrap", "nowrap", "wrap-reverse"]),
                Key("flexWrap"),
                Verbatim,
            ),
            rule!(Always, Key("flex"), Unwrapped),
        ],
    ),
    (
        "table",
        &[rule!(
            OneOf(&["auto", "fixed"]),
            Key("tableLayout"),
            Verbatim,
        )],
    ),
    ("divide", &[rule!(Always, Key("divideColor"), Unwrapped)]),
    (
        "break",
        &[
            // `break-words` is overflow-wrap, not word-break.
            rule!(Is("words"), Key("wrap"), Literal("break-word")),
            rule!(Always, Key("break"), Verbatim),
        ],
    ),
    ("wrap", &[rule!(Always, Key("wrap"), Verbatim)]),
];

/// A percentage, a bare number or an arbitrary length is a colour-stop
/// position; anything else is the stop's colour.
const GRADIENT_STOP_RULES: &[Rule] = &[
    rule!(Percent, PrefixPos, Unwrapped),
    rule!(Digits, PrefixPos, Unwrapped),
    rule!(ArbitraryDimension, PrefixPos, Unwrapped),
    rule!(Always, Prefix, Unwrapped),
];

/// The rules a prefix is read with.
pub fn rules_for(prefix: &str) -> &'static [Rule] {
    RULE_TABLES
        .iter()
        .find(|(candidate, _)| *candidate == prefix)
        .map_or(DEFAULT_RULES, |(_, rules)| rules)
}

/// The first rule for the prefix whose shape the value has, with its index.
pub fn select<'r>(rules: &'r [Rule], shape: &Shape<'_>) -> Option<(usize, &'r Rule)> {
    rules
        .iter()
        .enumerate()
        .find(|(_, rule)| matches(&rule.when, shape))
}

fn matches(test: &Test, shape: &Shape<'_>) -> bool {
    let value = shape.value;
    match test {
        Always => true,
        Keyword(in_set) => in_set(value),
        Is(expected) => value == *expected,
        OneOf(choices) => choices.contains(&value),
        ThreeDigits => value.len() == 3 && all_digits(value),
        Integer => shape.is_integer(),
        Digits => all_digits(value),
        Percent => value.strip_suffix('%').is_some_and(is_decimal_digits),
        ArbitraryDimension => is_arbitrary_dimension(value),
        Bracket => shape.bracket.is_some(),
        Paren => shape.paren.is_some(),
        ParenColor => shape.paren.is_some_and(|inner| inner.starts_with("color:")),
        ParenOrArbitraryDimension => shape.paren.is_some() || is_arbitrary_dimension(value),
        StartsWith(marker) => value.starts_with(marker),
        BracketPositionList => shape.bracket.is_some_and(|inner| {
            let inner = decode_arbitrary_spaces(inner);
            inner.contains(' ')
                && tables::bg_position_keywords(inner.split(' ').next().unwrap_or_default())
        }),
    }
}

/// The value a matched rule writes.
pub fn emit(rule: &Rule, prefix: &str, shape: &Shape<'_>, negative: bool) -> SzValue {
    let value = shape.value;
    match &rule.emit {
        Verbatim => SzValue::from(value),
        Literal(literal) => SzValue::from(*literal),
        Unwrapped => SzValue::from(parse_string_value(value)),
        Number => SzValue::Number(shape.number.unwrap_or(f64::NAN)),
        SignedNumber => {
            let number = shape.number.unwrap_or(f64::NAN);
            SzValue::Number(if negative { -number } else { number })
        }
        ParenInner => SzValue::from(shape.paren.unwrap_or_default()),
        ParenColorInner => SzValue::from(
            shape
                .paren
                .and_then(|inner| inner.strip_prefix("color:"))
                .unwrap_or_default(),
        ),
        BracketInner => SzValue::from(decode_arbitrary_spaces(shape.bracket.unwrap_or_default())),
        ParseValue => parse_value(prefix, value, negative),
        ParseValueUnsigned => parse_value(prefix, value, false),
    }
}

/// The sz key a matched rule writes.
pub fn prop_name(rule: &Rule, prefix: &str) -> String {
    match rule.prop {
        Key(key) => key.to_string(),
        Prefix => prefix.to_string(),
        PrefixPos => format!("{prefix}Pos"),
        Reverse => reverse_property_key(prefix).unwrap_or(prefix).to_string(),
    }
}

fn all_digits(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
}

/// `\d+(\.\d+)?`
fn is_decimal_digits(value: &str) -> bool {
    match value.split_once('.') {
        Some((whole, fraction)) => all_digits(whole) && all_digits(fraction),
        None => all_digits(value),
    }
}

/// `\d+/\d+`
pub fn is_fraction(value: &str) -> bool {
    value
        .split_once('/')
        .is_some_and(|(numerator, denominator)| all_digits(numerator) && all_digits(denominator))
}

/// Tailwind spells spaces inside arbitrary values as underscores.
pub fn decode_arbitrary_spaces(value: &str) -> String {
    value.replace('_', " ")
}

/// The value with its arbitrary brackets or custom-property parens removed.
pub fn parse_string_value(value: &str) -> String {
    if let Some(inner) = wrapped(value, '[', ']') {
        return decode_arbitrary_spaces(inner);
    }
    if let Some(inner) = wrapped(value, '(', ')') {
        return inner.to_string();
    }
    value.to_string()
}

/// CSS length and dimension units, so `[1.5px]` reads as a size and not a
/// colour.
const CSS_DIMENSION_UNITS: &[&str] = &[
    "vmin", "vmax", "rem", "svh", "svw", "dvh", "dvw", "lvh", "lvw", "cqw", "cqh", "cqi", "cqb",
    "turn", "grad", "px", "em", "ex", "ch", "vw", "vh", "%", "fr", "deg", "rad", "ms", "s", "pt",
    "pc", "cm", "mm", "in",
];

/// Whether a value is a bracketed CSS dimension, such as `[1.5px]`.
pub fn is_arbitrary_dimension(value: &str) -> bool {
    let Some(dimension) = wrapped(value, '[', ']') else {
        return false;
    };
    CSS_DIMENSION_UNITS.iter().any(|unit| {
        dimension.strip_suffix(unit).is_some_and(|magnitude| {
            let magnitude = magnitude.strip_prefix('-').unwrap_or(magnitude);
            !magnitude.is_empty()
                && magnitude
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || byte == b'.')
        })
    })
}

/// Keywords spacing and sizing props accept besides numbers and fractions.
const SPACING_KEYWORDS: &[&str] = &[
    "auto",
    "full",
    "screen",
    "px",
    "min",
    "max",
    "fit",
    "none",
    "dvh",
    "dvw",
    "svh",
    "svw",
    "lvh",
    "lvw",
    "3xs",
    "2xs",
    "xs",
    "sm",
    "md",
    "lg",
    "xl",
    "2xl",
    "3xl",
    "4xl",
    "5xl",
    "6xl",
    "7xl",
    "prose",
    "screen-sm",
    "screen-md",
    "screen-lg",
    "screen-xl",
    "screen-2xl",
    "content",
];

/// Whether a value can follow a spacing prefix at all. `p-red-500` is not a
/// padding, so the prefix match must move on rather than invent one.
pub fn is_valid_spacing_value(value: &str) -> bool {
    wrapped(value, '[', ']').is_some()
        || wrapped(value, '(', ')').is_some()
        || js_number(value).is_some()
        || is_fraction(value)
        || SPACING_KEYWORDS.contains(&value)
        // A colour with an opacity, on a prefix that is also a border.
        || value.contains('/')
}

/// The general reading of a prefix's value.
pub fn parse_value(prefix: &str, value: &str, negative: bool) -> SzValue {
    if let Some(inner) = wrapped(value, '[', ']') {
        return SzValue::from(parse_arbitrary_value(
            prefix,
            &decode_arbitrary_spaces(inner),
            negative,
        ));
    }
    if let Some(inner) = wrapped(value, '(', ')') {
        return SzValue::from(signed_string(inner, negative));
    }
    if tables::fraction_supported(prefix) && is_fraction(value) {
        return SzValue::from(signed_string(value, negative));
    }
    if value == "px" || value == "full" {
        return SzValue::from(signed_string(value, negative));
    }
    if value == "auto" || value == "screen" {
        return SzValue::from(value);
    }
    if let Some(number) = js_number(value) {
        return SzValue::Number(if negative { -number } else { number });
    }
    SzValue::from(signed_string(value, negative))
}

/// An arbitrary value's inside, with a `content` string's quotes normalised
/// to double quotes so the compiler writes it back unchanged.
fn parse_arbitrary_value(prefix: &str, inner: &str, negative: bool) -> String {
    if negative {
        return format!("-{inner}");
    }
    if prefix == "content" {
        if let Some(body) = wrapped(inner, '\'', '\'').or_else(|| wrapped(inner, '"', '"')) {
            return format!("\"{body}\"");
        }
    }
    inner.to_string()
}

pub fn signed_string(value: &str, negative: bool) -> String {
    if negative {
        format!("-{value}")
    } else {
        value.to_string()
    }
}
