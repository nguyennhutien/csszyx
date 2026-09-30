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
///
/// Two passes: each property first says what it becomes, then a property
/// whose key a later one in the same object now shares is deleted. Renaming
/// `{ liningNums: true, oldstyleNums: true }` key by key gives two `numFigure`
/// keys, which tsc refuses (TS1117) while JavaScript keeps the later; deleting
/// the earlier keeps what the object meant and compiles. Only a collision a
/// rename created is resolved — duplicates the author wrote are theirs.
pub fn normalize_sz_object(
    object: &ObjectExpression<'_>,
    replacements: &mut Vec<Replacement>,
) -> u32 {
    let plans: Vec<Option<Plan<'_>>> = object.properties.iter().map(plan_property).collect();
    let mut count = 0;
    for (index, plan) in plans.iter().enumerate() {
        let Some(plan) = plan else {
            continue;
        };
        let shadowed = plans[index + 1..]
            .iter()
            .flatten()
            .any(|later| later.key == plan.key && (later.renamed || plan.renamed));
        if shadowed {
            // A later property exists, so this one is never the last: delete
            // up to where the next element starts, taking its comma with it.
            replacements.push(Replacement {
                start: plan.span.start as usize,
                end: object.properties[index + 1].span().start as usize,
                text: String::new(),
            });
            count += 1;
            continue;
        }
        if plan.renamed {
            count += 1;
        }
        replacements.extend(plan.edits.iter().cloned());
        if let Some(nested) = plan.nested {
            count += normalize_sz_object(nested, replacements);
        }
    }
    count
}

/// What one property becomes: its edits, the key it ends on, whether that key
/// is a rename, and the variant object to descend into.
struct Plan<'a> {
    span: oxc_span::Span,
    key: String,
    renamed: bool,
    edits: Vec<Replacement>,
    nested: Option<&'a ObjectExpression<'a>>,
}

fn plan_property<'a>(property: &'a ObjectPropertyKind<'a>) -> Option<Plan<'a>> {
    let ObjectPropertyKind::ObjectProperty(property) = property else {
        return None;
    };
    // A method or an accessor is not a property to the TypeScript's Babel
    // walk, and a computed key has no static name.
    if property.computed || property.method || property.kind != PropertyKind::Init {
        return None;
    }
    let (key_name, key_span, quoted) = static_key_info(&property.key)?;
    let key = KeySite {
        span: key_span,
        quoted,
    };
    let mut edits = Vec::new();
    let renamed = normalize_removed_boolean_sugar(property, key_name, &mut edits)
        .or_else(|| normalize_font_variant(property, key_name, &mut edits))
        .or_else(|| normalize_ambiguous_font(property, key_name, key, &mut edits))
        .or_else(|| normalize_canonical_key(key_name, key, &mut edits));
    // Only a plain key rename can carry an object: every other rewrite
    // replaced a scalar or a ternary.
    let nested = match &property.value {
        Expression::ObjectExpression(nested) => Some(&**nested),
        _ => None,
    };
    Some(Plan {
        span: property.span,
        renamed: renamed.is_some(),
        key: renamed.unwrap_or_else(|| key_name.to_string()),
        edits,
        nested,
    })
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
/// replaced, because the key and the value change together. A ternary whose
/// every branch is a literal keeps its test: `c ? true : false` becomes
/// `c ? 'flex' : undefined`. Any other branch is runtime data the codemod
/// cannot spell, so the property is left for the build to report.
fn normalize_removed_boolean_sugar(
    property: &oxc_ast::ast::ObjectProperty<'_>,
    key_name: &str,
    edits: &mut Vec<Replacement>,
) -> Option<String> {
    let (key, value) = removed_boolean_sugar_replacement(key_name)?;
    match &property.value {
        Expression::BooleanLiteral(literal) if literal.value => {
            edits.push(Replacement {
                start: property.span.start as usize,
                end: property.span.end as usize,
                text: format!("{key}: '{value}'"),
            });
            Some(key.to_string())
        }
        Expression::ConditionalExpression(_) => {
            let mut leaves = Vec::new();
            if !literal_branch_edits(&property.value, value, &mut leaves) {
                return None;
            }
            let (_, key_span, quoted) = static_key_info(&property.key)?;
            push_key_replacement(
                KeySite {
                    span: key_span,
                    quoted,
                },
                key,
                edits,
            );
            edits.extend(leaves);
            Some(key.to_string())
        }
        _ => None,
    }
}

/// Respell every leaf of a ternary for a valued key: `true` becomes the
/// value, `false` becomes `undefined`, `undefined` and `null` stay. False when
/// a leaf is anything else.
fn literal_branch_edits(
    expression: &Expression<'_>,
    value: &str,
    out: &mut Vec<Replacement>,
) -> bool {
    match expression {
        Expression::ConditionalExpression(conditional) => {
            literal_branch_edits(&conditional.consequent, value, out)
                && literal_branch_edits(&conditional.alternate, value, out)
        }
        Expression::BooleanLiteral(literal) => {
            out.push(Replacement {
                start: literal.span.start as usize,
                end: literal.span.end as usize,
                text: if literal.value {
                    quoted(value)
                } else {
                    "undefined".to_string()
                },
            });
            true
        }
        Expression::NullLiteral(_) => true,
        Expression::Identifier(identifier) => identifier.name == "undefined",
        _ => false,
    }
}

/// `fontVariant: 'tabular-nums'` named a class, so the class says which key
/// replaces it: the migrate parser reads it as it reads any `className`.
fn normalize_font_variant(
    property: &oxc_ast::ast::ObjectProperty<'_>,
    key_name: &str,
    edits: &mut Vec<Replacement>,
) -> Option<String> {
    if key_name != "fontVariant" {
        return None;
    }
    let Expression::StringLiteral(literal) = &property.value else {
        return None;
    };
    let parsed = super::class_parser::parse_class(&literal.value)?;
    let value = match &parsed.value {
        SzValue::String(text) => quoted(text),
        SzValue::Bool(flag) => flag.to_string(),
        _ => return None,
    };
    edits.push(Replacement {
        start: property.span.start as usize,
        end: property.span.end as usize,
        text: format!("{}: {value}", parsed.prop),
    });
    Some(parsed.prop)
}

/// The legacy `font` key resolved the way `font-*` classes are: a weight
/// keyword or number is `weight`, a family keyword is `fontFamily`.
fn normalize_ambiguous_font(
    property: &oxc_ast::ast::ObjectProperty<'_>,
    key_name: &str,
    key: KeySite,
    replacements: &mut Vec<Replacement>,
) -> Option<String> {
    if key_name != "font" {
        return None;
    }
    let value = match &property.value {
        Expression::StringLiteral(literal) => literal.value.to_string(),
        Expression::NumericLiteral(literal) => js_number_to_string(literal.value),
        _ => return None,
    };
    // The font table ends in a catch-all rule, so a value always resolves,
    // and never to `font` itself.
    let shape = Shape::read(&value);
    let (_, rule) = class_rules::select(class_rules::rules_for("font"), &shape)
        .expect("the font rule table ends in a catch-all rule");
    let canonical = class_rules::prop_name(rule, "font");
    push_key_replacement(key, &canonical, replacements);
    push_resolved_value(
        property,
        &value,
        &class_rules::emit(rule, "font", &shape, false),
        replacements,
    );
    Some(canonical)
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
) -> Option<String> {
    let suggestion = key_suggestion(key_name)?;
    if !is_clean_canonical_target(suggestion) || suggestion == key_name {
        return None;
    }
    push_key_replacement(key, suggestion, replacements);
    Some(suggestion.to_string())
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

#[cfg(test)]
mod tests {
    use crate::migrate::source::{transform_source, TransformOptions};

    fn keys_only(sz: &str) -> String {
        let source = format!("const A = ({{ c, v }}) => <p sz={{{sz}}} />;");
        let options = TransformOptions {
            keys_only: true,
            ..TransformOptions::default()
        };
        let code = transform_source(&source, "a.tsx", &options).code;
        let start = code.find("sz={").expect("an sz attribute") + 4;
        code[start..code.rfind("} />").expect("the element end")].to_string()
    }

    #[test]
    fn a_ternary_of_literals_keeps_its_test_and_respells_each_leaf() {
        assert_eq!(
            keys_only("{ tabularNums: c ? (v ? true : null) : false }"),
            "{ numSpacing: c ? (v ? 'tabular' : null) : undefined }"
        );
        assert_eq!(
            keys_only("{ 'tabularNums': c ? true : undefined }"),
            "{ 'numSpacing': c ? 'tabular' : undefined }"
        );
    }

    #[test]
    fn a_ternary_with_runtime_data_or_a_false_literal_is_left_alone() {
        assert_eq!(
            keys_only("{ tabularNums: c ? true : v }"),
            "{ tabularNums: c ? true : v }"
        );
        assert_eq!(
            keys_only("{ tabularNums: c ? true : other }"),
            "{ tabularNums: c ? true : other }"
        );
        assert_eq!(
            keys_only("{ tabularNums: false }"),
            "{ tabularNums: false }"
        );
        assert_eq!(keys_only("{ tabularNums: v }"), "{ tabularNums: v }");
        assert_eq!(
            keys_only("{ tabularNums: c ? true : 1 }"),
            "{ tabularNums: c ? true : 1 }"
        );
    }

    #[test]
    fn font_variant_reads_its_value_as_the_class_it_named() {
        assert_eq!(
            keys_only("{ fontVariant: 'stacked-fractions' }"),
            "{ numFraction: 'stacked' }"
        );
        assert_eq!(
            keys_only("{ fontVariant: 'slashed-zero' }"),
            "{ numSlashedZero: true }"
        );
        // Not a class the parser knows, or not a literal: left for the build
        // to report.
        assert_eq!(
            keys_only("{ fontVariant: 'bogus value' }"),
            "{ fontVariant: 'bogus value' }"
        );
        assert_eq!(keys_only("{ fontVariant: v }"), "{ fontVariant: v }");
        // A class the parser reads as a number is no numeric-glyph key.
        assert_eq!(
            keys_only("{ fontVariant: 'p-4' }"),
            "{ fontVariant: 'p-4' }"
        );
    }

    #[test]
    fn two_keys_a_rename_merged_keep_the_later_and_author_duplicates_stay() {
        assert_eq!(
            keys_only("{ liningNums: true, ...v, oldstyleNums: true }"),
            "{ ...v, numFigure: 'oldstyle' }"
        );
        assert_eq!(
            keys_only("{ block: true, md: { hidden: true, flex: true } }"),
            "{ display: 'block', md: { display: 'flex' } }"
        );
        // One side renamed is enough: the author's `display` loses to the
        // sugar that became `display` after it.
        assert_eq!(
            keys_only("{ display: 'block', flex: true }"),
            "{ display: 'flex' }"
        );
        // The same key twice with no rename is the author's own, untouched.
        assert_eq!(keys_only("{ p: 1, p: 2 }"), "{ p: 1, p: 2 }");
    }
}
