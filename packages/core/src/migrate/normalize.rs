//! Legacy sz keys inside an existing `sz={{ … }}` rewritten to the single
//! canonical form: `{ flex: true }` to `{ display: 'flex' }`, `{ padding: 4 }`
//! to `{ p: 4 }`, the ambiguous `font` resolved by its value. Driven by the
//! compiler's own tables, so a key the compiler renamed is rewritten and a
//! key it does not know is left alone.

use oxc_ast::ast::{Expression, ObjectExpression, ObjectPropertyKind, PropertyKey, PropertyKind};
use oxc_span::GetSpan;

use super::class_rules::{self, Shape};
use super::source::Replacement;
use super::sz_codegen::quoted;
use super::value::{js_number_to_string, SzValue};
use crate::transform::generated::tables::{key_suggestion, removed_boolean_sugar_replacement};

/// Rewrite every legacy key in the object, recursing into nested variant
/// objects, and return how many keys were rewritten.
pub fn normalize_sz_object(
    object: &ObjectExpression<'_>,
    replacements: &mut Vec<Replacement>,
) -> u32 {
    let mut count = 0;
    for property in &object.properties {
        let ObjectPropertyKind::ObjectProperty(property) = property else {
            continue;
        };
        // A method or an accessor is not a property to the TypeScript's
        // Babel walk, and a computed key has no static name.
        if property.computed || property.method || property.kind != PropertyKind::Init {
            continue;
        }
        let Some((key_name, key_span, quoted)) = static_key_info(&property.key) else {
            continue;
        };
        let key = KeySite {
            span: key_span,
            quoted,
        };

        if normalize_removed_boolean_sugar(property, key_name, replacements) {
            count += 1;
            continue;
        }
        if normalize_ambiguous_font(property, key_name, key, replacements) {
            count += 1;
            continue;
        }
        if normalize_canonical_key(key_name, key, replacements) {
            count += 1;
        }
        if let Expression::ObjectExpression(nested) = &property.value {
            count += normalize_sz_object(nested, replacements);
        }
    }
    count
}

/// Where a key sits and whether it was quoted, so a rewrite keeps its form.
#[derive(Clone, Copy)]
struct KeySite {
    span: oxc_span::Span,
    quoted: bool,
}

/// An identifier or string-literal key's name, span and quoting. Any other
/// key shape has no static name.
fn static_key_info<'a>(key: &'a PropertyKey<'a>) -> Option<(&'a str, oxc_span::Span, bool)> {
    match key {
        PropertyKey::StaticIdentifier(identifier) => {
            Some((identifier.name.as_str(), identifier.span, false))
        }
        PropertyKey::StringLiteral(literal) => Some((literal.value.as_str(), literal.span, true)),
        _ => None,
    }
}

/// An identifier or string-literal key's name.
pub fn static_key<'a>(key: &'a PropertyKey<'a>) -> Option<&'a str> {
    static_key_info(key).map(|(name, _, _)| name)
}

/// `{ flex: true }` becomes `{ display: 'flex' }`: the whole property is
/// replaced, because the key and the value change together.
fn normalize_removed_boolean_sugar(
    property: &oxc_ast::ast::ObjectProperty<'_>,
    key_name: &str,
    replacements: &mut Vec<Replacement>,
) -> bool {
    let Some((key, value)) = removed_boolean_sugar_replacement(key_name) else {
        return false;
    };
    let Expression::BooleanLiteral(literal) = &property.value else {
        return false;
    };
    if !literal.value {
        return false;
    }
    replacements.push(Replacement {
        start: property.span.start as usize,
        end: property.span.end as usize,
        text: format!("{key}: '{value}'"),
    });
    true
}

/// The legacy `font` key resolved the way `font-*` classes are: a weight
/// keyword or number is `weight`, a family keyword is `fontFamily`.
fn normalize_ambiguous_font(
    property: &oxc_ast::ast::ObjectProperty<'_>,
    key_name: &str,
    key: KeySite,
    replacements: &mut Vec<Replacement>,
) -> bool {
    if key_name != "font" {
        return false;
    }
    let value = match &property.value {
        Expression::StringLiteral(literal) => literal.value.to_string(),
        Expression::NumericLiteral(literal) => js_number_to_string(literal.value),
        _ => return false,
    };
    // The font table ends in a catch-all rule, so a value always resolves,
    // and never to `font` itself.
    let shape = Shape::read(&value);
    let (_, rule) = class_rules::select(class_rules::rules_for("font"), &shape)
        .expect("the font rule table ends in a catch-all rule");
    push_key_replacement(key, &class_rules::prop_name(rule, "font"), replacements);
    push_resolved_value(
        property,
        &value,
        &class_rules::emit(rule, "font", &shape, false),
        replacements,
    );
    true
}

/// Rewrite the value too when resolving the key changed it.
///
/// A stretch value carries a marker the new key already says:
/// `font: 'stretch-condensed'` means `fontStretch: 'condensed'`, and keeping
/// the marker compiles to an arbitrary value that sets font-stretch to a word
/// CSS does not know — the class is emitted and the style is silently lost.
///
/// Only a string replaces a string, and only when it differs. A weight
/// resolves to a NUMBER, and the two spellings are different classes
/// (`weight: '700'` is `font-700`, `weight: 700` is `font-[700]`), so
/// anything but a different non-empty string leaves the author's value alone.
fn push_resolved_value(
    property: &oxc_ast::ast::ObjectProperty<'_>,
    original: &str,
    resolved: &SzValue,
    replacements: &mut Vec<Replacement>,
) {
    let SzValue::String(resolved) = resolved else {
        return;
    };
    if resolved.is_empty() || resolved == original {
        return;
    }
    // Only a string literal reaches here. A numeric one resolves either to a
    // number, which the guard above returned on, or to its own text through
    // the catch-all, which the equality returned on — so the span below is
    // always a quoted value being replaced by a quoted value.
    let span = property.value.span();
    replacements.push(Replacement {
        start: span.start as usize,
        end: span.end as usize,
        text: quoted(resolved),
    });
}

/// A key the compiler's suggestion table renames to one bare canonical key.
/// Prose suggestions naming several keys cannot be applied mechanically.
fn normalize_canonical_key(
    key_name: &str,
    key: KeySite,
    replacements: &mut Vec<Replacement>,
) -> bool {
    let Some(suggestion) = key_suggestion(key_name) else {
        return false;
    };
    if !is_clean_canonical_target(suggestion) || suggestion == key_name {
        return false;
    }
    push_key_replacement(key, suggestion, replacements);
    true
}

/// `^[a-z][a-z0-9]*$`, case-insensitive.
fn is_clean_canonical_target(target: &str) -> bool {
    let mut bytes = target.bytes();
    bytes
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic())
        && bytes.all(|byte| byte.is_ascii_alphanumeric())
}

/// The key's text replaced, quoted the way the original was.
fn push_key_replacement(key: KeySite, replacement: &str, replacements: &mut Vec<Replacement>) {
    let text = if key.quoted {
        format!("'{replacement}'")
    } else {
        replacement.to_string()
    };
    replacements.push(Replacement {
        start: key.span.start as usize,
        end: key.span.end as usize,
        text,
    });
}
