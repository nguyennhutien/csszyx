//! Legacy sz keys inside an existing `sz={{ … }}` rewritten to the single
//! canonical form: `{ flex: true }` to `{ display: 'flex' }`, `{ padding: 4 }`
//! to `{ p: 4 }`, the ambiguous `font` resolved by its value. Driven by the
//! compiler's own tables, so a key the compiler renamed is rewritten and a
//! key it does not know is left alone.

use oxc_ast::ast::{
    Expression, ObjectExpression, ObjectPropertyKind, PropertyKey, PropertyKind, StringLiteral,
};
use oxc_span::GetSpan;

use super::class_rules::{self, Shape};
use super::source::Replacement;
use super::stylesheet_order::{rank, static_class};
use super::sz_codegen::quoted;
use super::value::{js_number_to_string, SzValue};
use crate::transform::generated::tables::{
    closed_enum_value_move, global_keyword_for_group, key_suggestion,
    removed_boolean_sugar_replacement,
};

/// Rewrite every sz object an sz value can evaluate to: the object itself,
/// each branch of a ternary, either side of `&&`, `||` or `??`. Each is a
/// whole sz object on its own, so each is normalised on its own. Any other
/// shape (an array, a call, a spread of runtime data) is left as it is.
pub fn normalize_sz_expression(
    source: &str,
    expression: &Expression<'_>,
    replacements: &mut Vec<Replacement>,
) -> u32 {
    match expression {
        Expression::ObjectExpression(object) => normalize_sz_object(source, object, replacements),
        Expression::ConditionalExpression(conditional) => {
            normalize_sz_expression(source, &conditional.consequent, replacements)
                + normalize_sz_expression(source, &conditional.alternate, replacements)
        }
        Expression::LogicalExpression(logical) => {
            normalize_sz_expression(source, &logical.left, replacements)
                + normalize_sz_expression(source, &logical.right, replacements)
        }
        _ => 0,
    }
}

/// Rewrite every legacy key in the object, recursing into nested variant
/// objects, and return how many keys were rewritten.
///
/// Two passes: each property first says what it becomes, then a property
/// that loses to another in the same object is deleted. Renaming
/// `{ liningNums: true, oldstyleNums: true }` key by key gives two `numFigure`
/// keys, which tsc refuses (TS1117). Before 0.18 both classes shipped and
/// Tailwind's stylesheet decided which rendered, so the one whose class the
/// stylesheet puts later is kept (`stylesheet_order`); when either value is
/// only known at runtime, the later property is kept, as JavaScript would.
/// A stand-alone keyword beside its old group keys (`fontVariant:
/// 'normal-nums'` beside `tabularNums`) sorted after all of them, so it
/// rendered and the group keys go. Only a collision a rename created is
/// resolved — duplicates the author wrote are theirs.
pub fn normalize_sz_object(
    source: &str,
    object: &ObjectExpression<'_>,
    replacements: &mut Vec<Replacement>,
) -> u32 {
    let plans: Vec<Option<Plan<'_>>> = object
        .properties
        .iter()
        .map(|property| plan_property(source, property))
        .collect();
    let deleted: Vec<bool> = plans
        .iter()
        .enumerate()
        .map(|(index, plan)| plan.as_ref().is_some_and(|plan| loses(index, plan, &plans)))
        .collect();
    let mut count = 0;
    let mut index = 0;
    while index < plans.len() {
        if deleted[index] {
            let run_start = index;
            while index < plans.len() && deleted[index] {
                index += 1;
                count += 1;
            }
            push_deletion(&object.properties, run_start, index, replacements);
            continue;
        }
        if let Some(plan) = &plans[index] {
            if plan.renamed {
                count += 1;
            }
            replacements.extend(plan.edits.iter().cloned());
            count += normalize_sz_expression(source, plan.value, replacements);
        }
        index += 1;
    }
    count
}

/// Delete the properties `start..end`, all of which lose. A run with a
/// property after it goes up to where that one starts, taking its comma;
/// a run that ends the object goes back to the end of the property before
/// it. A run always has one before it then: whatever beat its last
/// property in a run that ends the object came earlier in the object.
fn push_deletion(
    properties: &[ObjectPropertyKind<'_>],
    start: usize,
    end: usize,
    replacements: &mut Vec<Replacement>,
) {
    let (from, to) = properties.get(end).map_or_else(
        || {
            (
                properties[start - 1].span().end,
                properties[end - 1].span().end,
            )
        },
        |next| (properties[start].span().start, next.span().start),
    );
    replacements.push(Replacement {
        start: from as usize,
        end: to as usize,
        text: String::new(),
    });
}

/// Whether another property in the object beats this one. Only a rename on
/// either side makes a collision the codemod's to resolve.
fn loses(index: usize, plan: &Plan<'_>, plans: &[Option<Plan<'_>>]) -> bool {
    plans.iter().enumerate().any(|(other_index, other)| {
        let Some(other) = other else {
            return false;
        };
        if other_index == index || !(plan.renamed || other.renamed) {
            return false;
        }
        let [other_key] = other.keys.as_slice() else {
            return false;
        };
        // A stand-alone keyword with a static value beats every key of its
        // groups, whatever their values: every stand-alone class sorts after
        // every group class (pinned in `stylesheet_order`).
        if other.class.is_some()
            && plan
                .keys
                .iter()
                .all(|key| global_keyword_for_group(key) == Some(other_key.as_str()))
        {
            return true;
        }
        let [key] = plan.keys.as_slice() else {
            return false;
        };
        if key != other_key {
            return false;
        }
        match (plan.class.and_then(rank), other.class.and_then(rank)) {
            (Some(mine), Some(theirs)) if mine != theirs => theirs > mine,
            _ => other_index > index,
        }
    })
}

/// What one property becomes: its edits, the keys it ends on, whether those
/// are a rename, the class its static value emits, and the value to descend
/// into for nested sz objects.
struct Plan<'a> {
    keys: Vec<String>,
    renamed: bool,
    class: Option<&'static str>,
    edits: Vec<Replacement>,
    value: &'a Expression<'a>,
}

/// What a normaliser made of a property: the keys it ends on and, when the
/// value is static, the value written.
struct Outcome {
    keys: Vec<String>,
    value: Option<String>,
}

impl Outcome {
    fn one(key: impl Into<String>, value: Option<String>) -> Self {
        Self {
            keys: vec![key.into()],
            value,
        }
    }
}

fn plan_property<'a>(source: &str, property: &'a ObjectPropertyKind<'a>) -> Option<Plan<'a>> {
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
    let outcome = normalize_removed_boolean_sugar(property, key_name, &mut edits)
        .or_else(|| normalize_font_variant(property, key_name, &mut edits))
        .or_else(|| normalize_moved_value(source, property, key_name, key, &mut edits))
        .or_else(|| normalize_ambiguous_font(property, key_name, key, &mut edits))
        .or_else(|| normalize_canonical_key(property, key_name, key, &mut edits));
    let renamed = outcome.is_some();
    let outcome = outcome.unwrap_or_else(|| Outcome::one(key_name, static_value(&property.value)));
    let class = match (outcome.keys.as_slice(), &outcome.value) {
        ([key], Some(value)) => static_class(key, value),
        _ => None,
    };
    Some(Plan {
        keys: outcome.keys,
        renamed,
        class,
        edits,
        value: &property.value,
    })
}

/// A string literal's value, or `true` for the literal `true`: the values
/// that name one class.
fn static_value(value: &Expression<'_>) -> Option<String> {
    match value {
        Expression::StringLiteral(literal) => Some(literal.value.to_string()),
        Expression::BooleanLiteral(literal) if literal.value => Some("true".to_string()),
        _ => None,
    }
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
) -> Option<Outcome> {
    let (key, value) = removed_boolean_sugar_replacement(key_name)?;
    match &property.value {
        Expression::BooleanLiteral(literal) if literal.value => {
            edits.push(Replacement {
                start: property.span.start as usize,
                end: property.span.end as usize,
                text: format!("{key}: '{value}'"),
            });
            Some(Outcome::one(key, Some(value.to_string())))
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
            Some(Outcome::one(key, None))
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
        _ => is_nullish(expression),
    }
}

/// `null` or `undefined`: a branch that sets nothing.
fn is_nullish(expression: &Expression<'_>) -> bool {
    match expression {
        Expression::NullLiteral(_) => true,
        Expression::Identifier(identifier) => identifier.name == "undefined",
        _ => false,
    }
}

/// `touch: 'pan-x'` moved onto its group's own key, `touchPanX: 'x'`; the
/// compiler's table says where each value went, and an alias of the key
/// (`touchAction`) is read as the key, so one pass reaches the group key. A
/// replacement of `true` is the boolean flag.
///
/// A ternary whose every branch is a string, `null` or `undefined` moves
/// with its branches. When they all land on one key the ternary keeps its
/// test: `c ? 'pan-x' : 'pan-left'` becomes `touchPanX: c ? 'x' : 'left'`.
/// Branches on different groups split into one copy of the ternary per group,
/// each branch of another group reading `undefined` — groups never reset each
/// other, so the copies answer as the one ternary did. A ternary with a
/// branch that stays on the stand-alone key (`c ? 'pan-x' : 'auto'`) is left:
/// split, it would put runtime values on both sides of one family, which the
/// build reports; left, the build reports the moved value instead.
fn normalize_moved_value(
    source: &str,
    property: &oxc_ast::ast::ObjectProperty<'_>,
    key_name: &str,
    key: KeySite,
    edits: &mut Vec<Replacement>,
) -> Option<Outcome> {
    let canonical = canonical_key(key_name).unwrap_or(key_name);
    let mut leaves = Vec::new();
    if !string_leaves(&property.value, &mut leaves) {
        return None;
    }
    let mut targets: Vec<(&'static str, String, oxc_span::Span)> = Vec::new();
    let mut keys: Vec<&str> = Vec::new();
    let mut moved = false;
    for leaf in &leaves {
        let (target, value) = match closed_enum_value_move(canonical, &leaf.value) {
            Some((target, value)) => {
                moved = true;
                (target, value.to_string())
            }
            None => ("", leaf.value.to_string()),
        };
        let target_key = if target.is_empty() { canonical } else { target };
        if !keys.contains(&target_key) {
            keys.push(target_key);
        }
        targets.push((target, value, leaf.span));
    }
    if !moved || keys.contains(&canonical) {
        return None;
    }
    let keys: Vec<String> = keys.into_iter().map(str::to_string).collect();
    let value = match &property.value {
        Expression::StringLiteral(_) => targets.first().map(|(_, value, _)| value.clone()),
        _ => None,
    };
    let value_span = property.value.span();
    let written = &source[value_span.start as usize..value_span.end as usize];
    let text = keys
        .iter()
        .map(|target_key| {
            let mut text = written.to_string();
            for (target, value, span) in targets.iter().rev() {
                let leaf = match (*target == target_key.as_str(), value.as_str()) {
                    (false, _) => "undefined".to_string(),
                    (true, "true") => "true".to_string(),
                    (true, value) => quoted(value),
                };
                let start = (span.start - value_span.start) as usize;
                let end = (span.end - value_span.start) as usize;
                text.replace_range(start..end, &leaf);
            }
            format!("{}: {text}", key_text(key, target_key))
        })
        .collect::<Vec<_>>()
        .join(", ");
    edits.push(Replacement {
        start: property.span.start as usize,
        end: property.span.end as usize,
        text,
    });
    Some(Outcome { keys, value })
}

/// The string leaves of a value made of strings, ternaries and nullish
/// branches. False for any other leaf.
fn string_leaves<'a>(expression: &'a Expression<'a>, out: &mut Vec<&'a StringLiteral<'a>>) -> bool {
    match expression {
        Expression::ConditionalExpression(conditional) => {
            string_leaves(&conditional.consequent, out)
                && string_leaves(&conditional.alternate, out)
        }
        Expression::StringLiteral(literal) => {
            out.push(literal);
            true
        }
        _ => is_nullish(expression),
    }
}

/// `fontVariant: 'tabular-nums'` named a class, so the class says which key
/// replaces it: the migrate parser reads it as it reads any `className`.
fn normalize_font_variant(
    property: &oxc_ast::ast::ObjectProperty<'_>,
    key_name: &str,
    edits: &mut Vec<Replacement>,
) -> Option<Outcome> {
    if key_name != "fontVariant" {
        return None;
    }
    let Expression::StringLiteral(literal) = &property.value else {
        return None;
    };
    let parsed = super::class_parser::parse_class(&literal.value)?;
    let (value, written) = match &parsed.value {
        SzValue::String(text) => (text.clone(), quoted(text)),
        SzValue::Bool(flag) => (flag.to_string(), flag.to_string()),
        _ => return None,
    };
    edits.push(Replacement {
        start: property.span.start as usize,
        end: property.span.end as usize,
        text: format!("{}: {written}", parsed.prop),
    });
    Some(Outcome::one(parsed.prop, Some(value)))
}

/// The legacy `font` key resolved the way `font-*` classes are: a weight
/// keyword or number is `weight`, a family keyword is `fontFamily`.
fn normalize_ambiguous_font(
    property: &oxc_ast::ast::ObjectProperty<'_>,
    key_name: &str,
    key: KeySite,
    replacements: &mut Vec<Replacement>,
) -> Option<Outcome> {
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
    Some(Outcome::one(canonical, None))
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
    property: &oxc_ast::ast::ObjectProperty<'_>,
    key_name: &str,
    key: KeySite,
    replacements: &mut Vec<Replacement>,
) -> Option<Outcome> {
    let suggestion = canonical_key(key_name)?;
    push_key_replacement(key, suggestion, replacements);
    Some(Outcome::one(suggestion, static_value(&property.value)))
}

/// The one bare key the compiler's suggestion table renames a key to, when it
/// names one and it is not the key itself.
fn canonical_key(key_name: &str) -> Option<&'static str> {
    key_suggestion(key_name)
        .filter(|suggestion| is_clean_canonical_target(suggestion) && *suggestion != key_name)
}

/// `^[a-z][a-z0-9]*$`, case-insensitive.
fn is_clean_canonical_target(target: &str) -> bool {
    let mut bytes = target.bytes();
    bytes
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic())
        && bytes.all(|byte| byte.is_ascii_alphanumeric())
}

/// A key's text, quoted the way the original was.
fn key_text(key: KeySite, replacement: &str) -> String {
    if key.quoted {
        format!("'{replacement}'")
    } else {
        replacement.to_string()
    }
}

/// The key's text replaced, quoted the way the original was.
fn push_key_replacement(key: KeySite, replacement: &str, replacements: &mut Vec<Replacement>) {
    replacements.push(Replacement {
        start: key.span.start as usize,
        end: key.span.end as usize,
        text: key_text(key, replacement),
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
        // A touch value that moved takes its group key; a flag is a boolean.
        assert_eq!(keys_only("{ touch: 'pan-up' }"), "{ touchPanY: 'up' }");
        assert_eq!(
            keys_only("{ touch: 'pinch-zoom' }"),
            "{ touchPinchZoom: true }"
        );
        assert_eq!(keys_only("{ touch: 'none' }"), "{ touch: 'none' }");
        assert_eq!(keys_only("{ touch: v }"), "{ touch: v }");
        // A class the parser reads as a number is no numeric-glyph key.
        assert_eq!(
            keys_only("{ fontVariant: 'p-4' }"),
            "{ fontVariant: 'p-4' }"
        );
    }

    #[test]
    fn two_keys_a_rename_merged_keep_one_and_author_duplicates_stay() {
        assert_eq!(
            keys_only("{ liningNums: true, ...v, oldstyleNums: true }"),
            "{ ...v, numFigure: 'oldstyle' }"
        );
        // `md:hidden md:flex` rendered `hidden`: Tailwind sorts it after
        // `flex`, so it is the one kept, wherever it was written.
        assert_eq!(
            keys_only("{ block: true, md: { hidden: true, flex: true } }"),
            "{ display: 'block', md: { display: 'none' } }"
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

    #[test]
    fn a_moved_touch_value_in_a_ternary_of_literals_moves_with_its_branches() {
        // Every branch lands on one key: the ternary keeps its test.
        assert_eq!(
            keys_only("{ touch: c ? 'pan-x' : 'pan-left' }"),
            "{ touchPanX: c ? 'x' : 'left' }"
        );
        assert_eq!(
            keys_only("{ touch: c ? (v ? 'pan-up' : null) : undefined }"),
            "{ touchPanY: c ? (v ? 'up' : null) : undefined }"
        );
        assert_eq!(
            keys_only("{ 'touch': c ? 'pinch-zoom' : undefined }"),
            "{ 'touchPinchZoom': c ? true : undefined }"
        );
        // Branches on two groups split onto both keys; a group never resets
        // another, so each copy of the ternary answers for its own group.
        assert_eq!(
            keys_only("{ touch: c ? 'pan-x' : 'pan-y' }"),
            "{ touchPanX: c ? 'x' : undefined, touchPanY: c ? undefined : 'y' }"
        );
    }

    #[test]
    fn a_ternary_the_codemod_cannot_split_safely_is_left_for_the_build() {
        // A moved value beside a stand-alone keyword would split onto both
        // sides of one family, each holding a runtime value: the shape the
        // build reports. Runtime data has no spelling to move.
        for sz in [
            "{ touch: c ? 'pan-x' : 'auto' }",
            "{ touch: c ? 'none' : 'pan-y' }",
            "{ touch: c ? 'pan-x' : v }",
            "{ touch: c ? 'pan-x' : 1 }",
            "{ touch: c ? 'none' : 'auto' }",
        ] {
            assert_eq!(keys_only(sz), sz);
        }
    }

    #[test]
    fn a_moved_value_under_an_alias_reaches_its_group_key_in_one_pass() {
        assert_eq!(keys_only("{ touchAction: 'pan-x' }"), "{ touchPanX: 'x' }");
        assert_eq!(
            keys_only("{ touchAction: c ? 'pan-down' : null }"),
            "{ touchPanY: c ? 'down' : null }"
        );
        assert_eq!(keys_only("{ touchAction: 'none' }"), "{ touch: 'none' }");
    }

    #[test]
    fn a_moved_value_inside_any_variant_or_object_branch_is_rewritten() {
        assert_eq!(
            keys_only("{ group: { hover: { touch: 'pan-x' } } }"),
            "{ group: { hover: { touchPanX: 'x' } } }"
        );
        assert_eq!(
            keys_only("{ data: { open: { touch: 'pan-x' } }, aria: { expanded: { touch: 'pinch-zoom' } } }"),
            "{ data: { open: { touchPanX: 'x' } }, aria: { expanded: { touchPinchZoom: true } } }"
        );
        assert_eq!(
            keys_only("{ md: { touch: c ? 'pan-x' : undefined } }"),
            "{ md: { touchPanX: c ? 'x' : undefined } }"
        );
        // An object chosen at runtime is still a whole sz object.
        assert_eq!(
            keys_only("c ? { touch: 'pan-x' } : { tabularNums: true }"),
            "c ? { touchPanX: 'x' } : { numSpacing: 'tabular' }"
        );
        assert_eq!(
            keys_only("c && { touch: 'pan-y' }"),
            "c && { touchPanY: 'y' }"
        );
        assert_eq!(
            keys_only("{ md: c ? { touch: 'pan-x' } : undefined, hover: v || { flex: true } }"),
            "{ md: c ? { touchPanX: 'x' } : undefined, hover: v || { display: 'flex' } }"
        );
    }

    #[test]
    fn two_old_keys_of_one_group_keep_the_class_tailwind_sorted_last() {
        // 0.17 emitted both classes and Tailwind's stylesheet order decided;
        // the object decides by position now, so the winner is kept by name.
        assert_eq!(
            keys_only("{ tabularNums: true, proportionalNums: true }"),
            "{ numSpacing: 'tabular' }"
        );
        assert_eq!(
            keys_only("{ oldstyleNums: true, p: 2, liningNums: true }"),
            "{ numFigure: 'oldstyle', p: 2 }"
        );
        assert_eq!(
            keys_only("{ stackedFractions: true, ...v, diagonalFractions: true }"),
            "{ numFraction: 'stacked', ...v }"
        );
        assert_eq!(
            keys_only("{ flex: true, block: true }"),
            "{ display: 'flex' }"
        );
        // One class written twice ranks the same: the later key stays.
        assert_eq!(
            keys_only("{ display: 'flex', flex: true, ordinal: true, numOrdinal: true }"),
            "{ display: 'flex', numOrdinal: true }"
        );
        // A split ternary holds two keys and is never a collision's winner
        // or loser on one of them.
        assert_eq!(
            keys_only("{ touch: c ? 'pan-x' : 'pan-y', flex: true }"),
            "{ touchPanX: c ? 'x' : undefined, touchPanY: c ? undefined : 'y', display: 'flex' }"
        );
        // A runtime value has no class to rank: the later key stays.
        assert_eq!(
            keys_only("{ tabularNums: true, proportionalNums: c ? true : undefined }"),
            "{ numSpacing: c ? 'proportional' : undefined }"
        );
    }

    #[test]
    fn a_stand_alone_keyword_beside_old_group_keys_keeps_the_stand_alone() {
        // Every stand-alone class sorts after its groups, so 0.17 rendered it.
        assert_eq!(
            keys_only("{ fontVariant: 'normal-nums', tabularNums: true }"),
            "{ nums: 'normal' }"
        );
        assert_eq!(
            keys_only("{ tabularNums: c ? true : undefined, fontVariant: 'normal-nums' }"),
            "{ nums: 'normal' }"
        );
        assert_eq!(
            keys_only("{ touch: 'none', touchAction: 'pan-x', p: 1 }"),
            "{ touch: 'none', p: 1 }"
        );
        // A stand-alone value known only at runtime decides nothing.
        assert_eq!(
            keys_only("{ touch: v, touchAction: 'pan-x' }"),
            "{ touch: v, touchPanX: 'x' }"
        );
        // Keys the author already wrote in the new spelling are theirs.
        assert_eq!(
            keys_only("{ touch: 'none', touchPanX: 'x' }"),
            "{ touch: 'none', touchPanX: 'x' }"
        );
    }
}
