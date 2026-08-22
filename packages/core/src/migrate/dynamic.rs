//! Dynamic className expressions: `clsx(...)` calls, ternaries, `&&` and
//! template literals.
//!
//! Each handler returns what to write in place of the attribute, or says why
//! it could not. The policy is all or nothing: if any part of an expression
//! cannot be migrated in full, the whole expression is left as it was and a
//! warning says which part, so a half-migrated expression can never change
//! what renders.

use oxc_ast::ast::{
    Argument, CallExpression, ConditionalExpression, Expression, LogicalExpression,
    LogicalOperator, TemplateLiteral,
};
use oxc_span::GetSpan;

use super::sz_codegen::{sz_expression, sz_object_literal};
use super::value::{is_js_whitespace, SzObject};
use super::variant_parser::class_name_to_sz_object;

/// Function names read as className composition helpers.
pub const CLSX_LIKE_NAMES: &[&str] = &["clsx", "cn", "cx", "twMerge", "classNames", "classnames"];

/// Whether a callee name is one of the recognised composition helpers.
#[must_use]
pub fn is_clsx_like_name(name: &str) -> bool {
    CLSX_LIKE_NAMES.contains(&name)
}

/// What a dynamic handler decided.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PatternResult {
    /// The attribute text to write, empty when not migrated.
    pub replacement: String,
    /// Classes the class parser did not know.
    pub unrecognized: Vec<String>,
    /// Why the expression was left alone.
    pub warnings: Vec<String>,
    /// How many className expressions were converted.
    pub converted: u32,
    /// Whether the attribute is rewritten.
    pub migrated: bool,
}

fn skip(unrecognized: Vec<String>, warnings: Vec<String>) -> PatternResult {
    PatternResult {
        unrecognized,
        warnings,
        ..PatternResult::default()
    }
}

const fn migrated(replacement: String, unrecognized: Vec<String>, converted: u32) -> PatternResult {
    PatternResult {
        replacement,
        unrecognized,
        warnings: Vec::new(),
        converted,
        migrated: true,
    }
}

/// The source text of a node.
fn slice(source: &str, span: oxc_span::Span) -> &str {
    &source[span.start as usize..span.end as usize]
}

/// `className={clsx('px-4', isActive && 'bg-blue-500')}` becomes
/// `sz={[...]}`; one plain argument becomes a plain object.
pub fn handle_clsx_call(
    call: &CallExpression<'_>,
    source: &str,
    custom_map: Option<&SzObject>,
) -> PatternResult {
    let mut warnings = Vec::new();
    let mut all_unrecognized = Vec::new();
    let mut elements = Vec::new();
    let mut converted = 0;

    for argument in &call.arguments {
        let Some((expression, unrecognized)) = convert_clsx_argument(argument, source, custom_map)
        else {
            warnings.push(cannot_migrate_clsx_argument(argument, source));
            return skip(all_unrecognized, warnings);
        };
        elements.push(expression);
        all_unrecognized.extend(unrecognized);
        converted += 1;
    }

    if elements.is_empty() {
        return skip(all_unrecognized, warnings);
    }
    if elements.len() == 1 && !elements[0].contains("&&") && !elements[0].contains('?') {
        return migrated(
            format!("sz={{{}}}", elements[0]),
            all_unrecognized,
            converted,
        );
    }
    migrated(
        format!("sz={{[{}]}}", elements.join(", ")),
        all_unrecognized,
        converted,
    )
}

fn convert_clsx_argument(
    argument: &Argument<'_>,
    source: &str,
    custom_map: Option<&SzObject>,
) -> Option<(String, Vec<String>)> {
    match argument {
        Argument::StringLiteral(literal) => migrate_string(&literal.value, custom_map),
        Argument::LogicalExpression(logical) if logical.operator == LogicalOperator::And => {
            logical_and_inner(logical, source, custom_map)
        }
        Argument::ConditionalExpression(conditional) => {
            ternary_inner(conditional, source, custom_map)
        }
        _ => None,
    }
}

fn cannot_migrate_clsx_argument(argument: &Argument<'_>, source: &str) -> String {
    let text = slice(source, argument.span());
    match argument {
        Argument::SpreadElement(_) => format!("Cannot migrate spread argument: {text}"),
        Argument::LogicalExpression(_) => format!("Cannot migrate logical expression: {text}"),
        Argument::ConditionalExpression(_) => format!("Cannot migrate ternary: {text}"),
        _ => format!("Cannot migrate argument: {text}"),
    }
}

/// `className={cond ? 'a' : 'b'}` becomes `sz={cond ? {...} : {...}}`;
/// both branches must be string literals.
pub fn handle_ternary(
    conditional: &ConditionalExpression<'_>,
    source: &str,
    custom_map: Option<&SzObject>,
) -> PatternResult {
    match ternary_inner(conditional, source, custom_map) {
        Some((expression, unrecognized)) => {
            migrated(format!("sz={{{expression}}}"), unrecognized, 1)
        }
        None => skip(
            Vec::new(),
            vec!["Ternary branches must be string literals".to_string()],
        ),
    }
}

/// `className={cond && 'a'}` becomes `sz={cond && {...}}`; the right side
/// must be a string literal.
pub fn handle_logical_and(
    logical: &LogicalExpression<'_>,
    source: &str,
    custom_map: Option<&SzObject>,
) -> PatternResult {
    match logical_and_inner(logical, source, custom_map) {
        Some((expression, unrecognized)) => {
            migrated(format!("sz={{{expression}}}"), unrecognized, 1)
        }
        None => skip(
            Vec::new(),
            vec!["Right side of && must be a string literal".to_string()],
        ),
    }
}

/// The static text of a template literal merged into one base object, each
/// expression migrated on its own; any expression that cannot be stops the
/// whole literal.
pub fn handle_template_literal(
    template: &TemplateLiteral<'_>,
    source: &str,
    custom_map: Option<&SzObject>,
) -> PatternResult {
    let mut warnings = Vec::new();
    let mut unrecognized = Vec::new();

    let static_text = template
        .quasis
        .iter()
        // An untagged template has no invalid escapes, so every quasi cooks.
        .map(|quasi| {
            quasi
                .value
                .cooked
                .as_ref()
                .unwrap_or(&quasi.value.raw)
                .to_string()
        })
        .collect::<Vec<_>>()
        .join(" ");
    let trimmed_static = static_text
        .split(is_js_whitespace)
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join(" ");

    let mut base = SzObject::new();
    let mut dynamic = Vec::new();
    let mut converted = 0;
    if !trimmed_static.is_empty() {
        let result = class_name_to_sz_object(&trimmed_static, custom_map);
        base = result.sz_object;
        unrecognized.extend(result.unrecognized);
    }

    for expression in &template.expressions {
        if let Some(warning) = migrate_template_expression(
            expression,
            source,
            custom_map,
            &mut base,
            &mut dynamic,
            &mut unrecognized,
            &mut converted,
        ) {
            warnings.push(warning);
            return skip(unrecognized, warnings);
        }
    }

    let has_base = !base.is_empty();
    let has_dynamic = !dynamic.is_empty();
    if !has_base && !has_dynamic {
        return skip(unrecognized, warnings);
    }
    if has_base && !has_dynamic {
        return migrated(
            format!("sz={}", sz_expression(&base)),
            unrecognized,
            converted + 1,
        );
    }
    let mut parts = Vec::new();
    if has_base {
        parts.push(sz_object_literal(&base));
    }
    parts.extend(dynamic);
    migrated(
        format!("sz={{[{}]}}", parts.join(", ")),
        unrecognized,
        converted + u32::from(has_base),
    )
}

/// One template expression folded into the base object or added as a
/// dynamic element. A warning means the literal cannot be migrated.
fn migrate_template_expression(
    expression: &Expression<'_>,
    source: &str,
    custom_map: Option<&SzObject>,
    base: &mut SzObject,
    dynamic: &mut Vec<String>,
    unrecognized: &mut Vec<String>,
    converted: &mut u32,
) -> Option<String> {
    if let Expression::StringLiteral(literal) = expression {
        let (_, literal_unrecognized) = migrate_string(&literal.value, custom_map)?;
        let converted_literal = class_name_to_sz_object(&literal.value, custom_map);
        for (key, value) in converted_literal.sz_object.js_ordered() {
            base.insert(key.clone(), value.clone());
        }
        unrecognized.extend(literal_unrecognized);
        *converted += 1;
        return None;
    }
    let result = match expression {
        Expression::ConditionalExpression(conditional) => {
            ternary_inner(conditional, source, custom_map)
        }
        Expression::LogicalExpression(logical) if logical.operator == LogicalOperator::And => {
            logical_and_inner(logical, source, custom_map)
        }
        _ => None,
    };
    let Some((element, element_unrecognized)) = result else {
        let kind = match expression {
            Expression::ConditionalExpression(_) => "template ternary",
            Expression::LogicalExpression(_) => "template logical expr",
            _ => "template expression",
        };
        return Some(format!(
            "Cannot migrate {kind}: {}",
            slice(source, expression.span())
        ));
    };
    dynamic.push(element);
    unrecognized.extend(element_unrecognized);
    *converted += 1;
    None
}

/// `cond ? {…} : {…}`, or `cond && {…}` / `!cond && {…}` when one branch is
/// empty. A branch with an unrecognised class, or one that is not a string,
/// cannot be migrated.
fn ternary_inner(
    conditional: &ConditionalExpression<'_>,
    source: &str,
    custom_map: Option<&SzObject>,
) -> Option<(String, Vec<String>)> {
    let (Expression::StringLiteral(consequent), Expression::StringLiteral(alternate)) =
        (&conditional.consequent, &conditional.alternate)
    else {
        return None;
    };
    let condition = slice(source, conditional.test.span());
    let consequent = consequent.value.trim_matches(is_js_whitespace);
    let alternate = alternate.value.trim_matches(is_js_whitespace);

    if alternate.is_empty() {
        if consequent.is_empty() {
            return None;
        }
        let (object, unrecognized) = migrate_string(consequent, custom_map)?;
        if !unrecognized.is_empty() {
            return None;
        }
        return Some((format!("{condition} && {object}"), Vec::new()));
    }
    if consequent.is_empty() {
        let (object, unrecognized) = migrate_string(alternate, custom_map)?;
        if !unrecognized.is_empty() {
            return None;
        }
        return Some((
            format!("!{} && {object}", wrap_condition(condition)),
            Vec::new(),
        ));
    }

    let (consequent_object, consequent_unrecognized) = migrate_string(consequent, custom_map)?;
    let (alternate_object, alternate_unrecognized) = migrate_string(alternate, custom_map)?;
    if !consequent_unrecognized.is_empty() || !alternate_unrecognized.is_empty() {
        return None;
    }
    Some((
        format!("{condition} ? {consequent_object} : {alternate_object}"),
        Vec::new(),
    ))
}

/// `cond && {…}`; the right side must be a string every class of which is
/// recognised.
fn logical_and_inner(
    logical: &LogicalExpression<'_>,
    source: &str,
    custom_map: Option<&SzObject>,
) -> Option<(String, Vec<String>)> {
    let Expression::StringLiteral(right) = &logical.right else {
        return None;
    };
    let (object, unrecognized) = migrate_string(&right.value, custom_map)?;
    if !unrecognized.is_empty() {
        return None;
    }
    let condition = slice(source, logical.left.span());
    Some((format!("{condition} && {object}"), Vec::new()))
}

/// A class string as an object literal, or `None` when nothing in it is
/// recognised.
fn migrate_string(
    class_name: &str,
    custom_map: Option<&SzObject>,
) -> Option<(String, Vec<String>)> {
    let trimmed = class_name.trim_matches(is_js_whitespace);
    if trimmed.is_empty() {
        return None;
    }
    let converted = class_name_to_sz_object(trimmed, custom_map);
    if converted.sz_object.is_empty() {
        return None;
    }
    Some((
        sz_object_literal(&converted.sz_object),
        converted.unrecognized,
    ))
}

/// A compound condition in parentheses, so `!` applies to all of it.
fn wrap_condition(condition: &str) -> String {
    if condition.contains(' ') || condition.contains("||") || condition.contains("&&") {
        return format!("({condition})");
    }
    condition.to_string()
}
