//! A JSX or TSX source file with its `className` attributes migrated to
//! `sz`.
//!
//! The file is parsed once, as TSX whatever its extension, the way the
//! TypeScript parses every file. The walk notes which composition helpers
//! are imported, whether any is called outside a className, and migrates
//! each `className` attribute it can: a string through the class parser, a
//! supported expression through the dynamic handlers, and a legacy
//! `sz={{ … }}` through the key normaliser. Edits are collected as spans and
//! applied from the end of the file backwards, each in the file's own
//! line-ending convention.

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    CallExpression, Expression, ImportDeclaration, ImportDeclarationSpecifier, JSXAttribute,
    JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXElementName, JSXExpression,
    JSXOpeningElement, LogicalOperator, ObjectExpression, ObjectPropertyKind, PropertyKind,
};
use oxc_ast_visit::{walk, Visit};
use oxc_parser::{ParseOptions, Parser};
use oxc_span::{GetSpan, SourceType};
use serde::Serialize;

use super::dynamic::{
    handle_clsx_call, handle_logical_and, handle_template_literal, handle_ternary,
    is_clsx_like_name, PatternResult,
};
use super::line_endings::{detect_line_ending, with_line_ending};
use super::normalize::{normalize_sz_object, static_key};
use super::sz_codegen::{sz_expression, sz_html_value, sz_object_literal};
use super::value::{is_js_whitespace, SzObject};
use super::variant_parser::{class_name_to_sz_object, tokenize};

/// Options for the source transformation.
#[derive(Clone, Copy, Debug, Default)]
pub struct TransformOptions<'a> {
    /// Insert a `@sz-todo` comment above elements with unrecognised classes.
    pub inject_todos: bool,
    /// Only normalise legacy sz keys; leave every className untouched.
    pub keys_only: bool,
    /// The migration-resolution map, which answers for a class before the
    /// parser is asked.
    pub custom_map: Option<&'a SzObject>,
}

/// What the transformation did to one file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformResult {
    /// The migrated source.
    pub code: String,
    /// Whether anything was written.
    pub changed: bool,
    /// Why something was left alone, each prefixed with the file path.
    pub warnings: Vec<String>,
    /// The counts.
    pub stats: TransformStats,
    /// Composition helpers imported but no longer called after migration.
    pub potentially_unused_imports: Vec<String>,
}

/// The counts of one transformation.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformStats {
    /// className attributes rewritten.
    pub class_names_transformed: u32,
    /// className attributes left alone.
    pub class_names_skipped: u32,
    /// className kept on capitalised components, which do not take sz.
    pub class_names_skipped_component: u32,
    /// Classes the parser did not know.
    pub classes_unrecognized: Vec<String>,
    /// Legacy sz keys rewritten; absent when the file was never parsed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sz_keys_normalized: Option<u32>,
}

/// One edit: the bytes `start..end` replaced by `text`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Replacement {
    pub(crate) start: usize,
    pub(crate) end: usize,
    pub(crate) text: String,
}

/// Migrate a JSX/TSX source, replacing `className` with `sz`.
#[must_use]
pub fn transform_source(
    source: &str,
    file_path: &str,
    options: &TransformOptions<'_>,
) -> TransformResult {
    if let Some(unchanged) = fast_path_result(source, options.keys_only) {
        return unchanged;
    }

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::tsx())
        .with_options(ParseOptions {
            preserve_parens: false,
            ..ParseOptions::default()
        })
        .parse();
    // oxc folds warnings into `diagnostics`; only error-severity entries are
    // parse failures, which is what Babel throws on.
    let first_error = parsed.diagnostics.errors().next();
    if parsed.panicked || first_error.is_some() {
        let message = first_error.map_or(String::new(), |error| error.message.to_string());
        let mut result = unchanged_result(source);
        result
            .warnings
            .push(format!("Parse error in {file_path}: {message}"));
        return result;
    }

    let mut visitor = Migration {
        source,
        file_path,
        options,
        replacements: Vec::new(),
        warnings: Vec::new(),
        classes_unrecognized: Vec::new(),
        stats: TransformStats::default(),
        clsx_import_names: Vec::new(),
        clsx_used_outside_class_name: false,
        has_cva_import: false,
        class_name_depth: 0,
        elements: Vec::new(),
    };
    visitor.visit_program(&parsed.program);

    if visitor.has_cva_import {
        visitor.warnings.push(format!(
            "[{file_path}] File uses cva() — consider migrating to szv() from @csszyx/runtime for type-safe variant-based styling."
        ));
    }

    let eol = detect_line_ending(source);
    let mut output = source.to_string();
    let mut sorted = visitor.replacements.clone();
    // Stable, so two edits at one offset land in the order they were made.
    sorted.sort_by_key(|replacement| std::cmp::Reverse(replacement.start));
    for replacement in &sorted {
        let text = with_line_ending(&replacement.text, eol);
        output.replace_range(replacement.start..replacement.end, &text);
    }

    let mut potentially_unused_imports = Vec::new();
    if !visitor.clsx_import_names.is_empty()
        && !visitor.clsx_used_outside_class_name
        && !visitor.replacements.is_empty()
    {
        for name in &visitor.clsx_import_names {
            if !is_called(&output, name) {
                potentially_unused_imports.push(name.clone());
            }
        }
    }

    let mut stats = visitor.stats;
    stats.classes_unrecognized = visitor.classes_unrecognized;
    stats.sz_keys_normalized = Some(stats.sz_keys_normalized.unwrap_or(0));
    TransformResult {
        code: output,
        changed: !visitor.replacements.is_empty(),
        warnings: visitor.warnings,
        stats,
        potentially_unused_imports,
    }
}

/// The unchanged result a file that holds nothing to migrate gets without
/// being parsed.
fn unchanged_result(source: &str) -> TransformResult {
    TransformResult {
        code: source.to_string(),
        changed: false,
        warnings: Vec::new(),
        stats: TransformStats::default(),
        potentially_unused_imports: Vec::new(),
    }
}

/// A file with no `className`, `sz=` or `cva` in it cannot need anything,
/// so it is not parsed. In keys-only mode only `sz=` matters.
fn fast_path_result(source: &str, keys_only: bool) -> Option<TransformResult> {
    let has_sz = source.contains("sz=");
    if (keys_only && !has_sz)
        || (!has_sz && !source.contains("className") && !source.contains("cva"))
    {
        return Some(unchanged_result(source));
    }
    None
}

/// `\b{name}\s*\(`: whether the helper is still called anywhere in the
/// migrated output.
fn is_called(output: &str, name: &str) -> bool {
    let name_is_word = name.chars().next().is_some_and(is_word_char);
    let mut from = 0;
    while let Some(found) = output[from..].find(name) {
        let start = from + found;
        let before_is_word = output[..start]
            .chars()
            .next_back()
            .is_some_and(is_word_char);
        // `\b` holds where word and non-word meet.
        if before_is_word != name_is_word {
            let rest = output[start + name.len()..].trim_start_matches(is_js_whitespace);
            if rest.starts_with('(') {
                return true;
            }
        }
        from = start + 1;
    }
    false
}

const fn is_word_char(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_'
}

/// The sz attribute beside a className, as far as merging cares.
enum SiblingSz {
    /// No sz attribute on the element.
    None,
    /// An sz attribute whose value is not a static object literal.
    Dynamic,
    /// A static `sz={{ … }}`.
    Static {
        object_start: usize,
        object_end: usize,
        /// Where the last property ends, or `None` for an empty object.
        last_property_end: Option<usize>,
        /// The keys the object sets at its top level.
        keys: Vec<String>,
    },
}

/// What the walk needs to know about the element an attribute sits on.
struct ElementContext {
    start: usize,
    name: String,
    custom_component: bool,
    sibling_sz: SiblingSz,
}

struct Migration<'s, 'o> {
    source: &'s str,
    file_path: &'s str,
    options: &'o TransformOptions<'o>,
    replacements: Vec<Replacement>,
    warnings: Vec<String>,
    classes_unrecognized: Vec<String>,
    stats: TransformStats,
    /// Composition helpers imported, in import order.
    clsx_import_names: Vec<String>,
    clsx_used_outside_class_name: bool,
    has_cva_import: bool,
    /// How many className attributes the walk is currently inside.
    class_name_depth: u32,
    elements: Vec<ElementContext>,
}

/// The packages whose default and named imports are composition helpers.
const CLSX_PACKAGES: &[&str] = &["clsx", "clsx/lite", "classnames", "tailwind-merge"];
/// The packages whose import means the file builds variants with cva.
const CVA_PACKAGES: &[&str] = &["cva", "class-variance-authority"];

fn imports_from(source: &str, packages: &[&str]) -> bool {
    packages
        .iter()
        .any(|package| source == *package || source.starts_with(&format!("{package}/")))
}

impl<'a> Visit<'a> for Migration<'_, '_> {
    fn visit_import_declaration(&mut self, declaration: &ImportDeclaration<'a>) {
        let module = declaration.source.value.as_str();
        let is_clsx_package = imports_from(module, CLSX_PACKAGES);
        if imports_from(module, CVA_PACKAGES) {
            self.has_cva_import = true;
        }
        for specifier in declaration.specifiers.iter().flatten() {
            let local = match specifier {
                ImportDeclarationSpecifier::ImportSpecifier(specifier) => &specifier.local.name,
                ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
                    &specifier.local.name
                }
                ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
                    &specifier.local.name
                }
            };
            if (is_clsx_package || is_clsx_like_name(local))
                && !self
                    .clsx_import_names
                    .iter()
                    .any(|name| name == local.as_str())
            {
                self.clsx_import_names.push(local.to_string());
            }
        }
    }

    fn visit_call_expression(&mut self, call: &CallExpression<'a>) {
        if let Expression::Identifier(callee) = &call.callee {
            if self.class_name_depth == 0
                && self
                    .clsx_import_names
                    .iter()
                    .any(|name| name == callee.name.as_str())
            {
                self.clsx_used_outside_class_name = true;
            }
        }
        walk::walk_call_expression(self, call);
    }

    fn visit_jsx_opening_element(&mut self, element: &JSXOpeningElement<'a>) {
        self.elements.push(element_context(element));
        walk::walk_jsx_opening_element(self, element);
        self.elements.pop();
    }

    fn visit_jsx_attribute(&mut self, attribute: &JSXAttribute<'a>) {
        self.handle_jsx_attribute(attribute);
        let is_class_name = attribute_name(attribute) == Some("className");
        if is_class_name {
            self.class_name_depth += 1;
        }
        walk::walk_jsx_attribute(self, attribute);
        if is_class_name {
            self.class_name_depth -= 1;
        }
    }
}

/// An attribute's plain name; a namespaced name is never sz or className.
fn attribute_name<'a>(attribute: &'a JSXAttribute<'a>) -> Option<&'a str> {
    match &attribute.name {
        JSXAttributeName::Identifier(identifier) => Some(identifier.name.as_str()),
        JSXAttributeName::NamespacedName(_) => None,
    }
}

const fn span_range(span: oxc_span::Span) -> (usize, usize) {
    (span.start as usize, span.end as usize)
}

/// What the walk needs to know about an element before its attributes.
fn element_context(element: &JSXOpeningElement<'_>) -> ElementContext {
    let (name, custom_component) = match &element.name {
        JSXElementName::Identifier(identifier) => (
            identifier.name.to_string(),
            identifier
                .name
                .chars()
                .next()
                .is_some_and(char::is_uppercase),
        ),
        JSXElementName::IdentifierReference(identifier) => (
            identifier.name.to_string(),
            identifier
                .name
                .chars()
                .next()
                .is_some_and(char::is_uppercase),
        ),
        JSXElementName::MemberExpression(_) | JSXElementName::ThisExpression(_) => {
            ("element".to_string(), true)
        }
        JSXElementName::NamespacedName(_) => ("element".to_string(), false),
    };
    let mut sibling_sz = SiblingSz::None;
    for item in &element.attributes {
        let JSXAttributeItem::Attribute(attribute) = item else {
            continue;
        };
        if attribute_name(attribute) != Some("sz") {
            continue;
        }
        sibling_sz = match &attribute.value {
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                match &container.expression {
                    JSXExpression::ObjectExpression(object) => static_sz(object),
                    _ => SiblingSz::Dynamic,
                }
            }
            _ => SiblingSz::Dynamic,
        };
        break;
    }
    ElementContext {
        start: element.span.start as usize,
        name,
        custom_component,
        sibling_sz,
    }
}

impl<'a> Migration<'_, '_> {
    fn handle_jsx_attribute(&mut self, attribute: &JSXAttribute<'a>) {
        let Some(name) = attribute_name(attribute) else {
            return;
        };
        if name == "sz" {
            if let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value {
                if let JSXExpression::ObjectExpression(object) = &container.expression {
                    let count = normalize_sz_object(object, &mut self.replacements);
                    self.stats.sz_keys_normalized =
                        Some(self.stats.sz_keys_normalized.unwrap_or(0) + count);
                }
            }
            return;
        }
        if self.options.keys_only || name != "className" {
            return;
        }
        let element = self
            .elements
            .last()
            .expect("an attribute is always inside an opening element");
        if element.custom_component {
            self.stats.class_names_skipped_component += 1;
            return;
        }
        if !matches!(element.sibling_sz, SiblingSz::None) {
            if !self.merge_into_sibling_sz(attribute) {
                self.stats.class_names_skipped += 1;
            }
            return;
        }

        let range = span_range(attribute.span);
        match &attribute.value {
            Some(JSXAttributeValue::StringLiteral(literal)) => {
                self.apply_static_class_migration(&literal.value, range);
            }
            Some(JSXAttributeValue::ExpressionContainer(container)) => {
                self.migrate_class_expression(&container.expression, range);
            }
            _ => self.stats.class_names_skipped += 1,
        }
    }

    fn parent_start(&self) -> usize {
        self.elements.last().map_or(0, |element| element.start)
    }

    /// A `@sz-todo` comment above the element, when asked for and there is
    /// something to list.
    fn inject_todo_comment(&mut self, unrecognized: &[String]) {
        if !self.options.inject_todos || unrecognized.is_empty() {
            return;
        }
        let start = self.parent_start();
        self.replacements.push(Replacement {
            start,
            end: start,
            text: format!("\n{{/* @sz-todo: {} */}}\n", unrecognized.join(", ")),
        });
    }

    fn apply_static_class_migration(&mut self, value: &str, range: (usize, usize)) {
        let Some((replacement, unrecognized)) =
            process_static_string(value, self.options.custom_map)
        else {
            self.stats.class_names_skipped += 1;
            return;
        };
        self.replacements.push(Replacement {
            start: range.0,
            end: range.1,
            text: replacement,
        });
        self.stats.class_names_transformed += 1;
        self.classes_unrecognized
            .extend(unrecognized.iter().cloned());
        self.inject_todo_comment(&unrecognized);
    }

    fn migrate_class_expression(&mut self, expression: &JSXExpression<'a>, range: (usize, usize)) {
        if let JSXExpression::StringLiteral(literal) = expression {
            self.apply_static_class_migration(&literal.value, range);
            return;
        }
        let Some(result) = self.dynamic_pattern_result(expression) else {
            self.stats.class_names_skipped += 1;
            return;
        };
        if result.migrated {
            self.replacements.push(Replacement {
                start: range.0,
                end: range.1,
                text: result.replacement,
            });
            self.stats.class_names_transformed += result.converted;
        } else {
            self.stats.class_names_skipped += 1;
            let file_path = self.file_path;
            self.warnings.extend(
                result
                    .warnings
                    .iter()
                    .map(|warning| format!("[{file_path}] {warning}")),
            );
        }
        self.classes_unrecognized
            .extend(result.unrecognized.iter().cloned());
        self.inject_todo_comment(&result.unrecognized);
    }

    fn dynamic_pattern_result(&self, expression: &JSXExpression<'a>) -> Option<PatternResult> {
        let custom_map = self.options.custom_map;
        let source = self.source;
        match expression {
            JSXExpression::TemplateLiteral(template) => {
                Some(handle_template_literal(template, source, custom_map))
            }
            JSXExpression::CallExpression(call) => match &call.callee {
                Expression::Identifier(callee) if is_clsx_like_name(&callee.name) => {
                    Some(handle_clsx_call(call, source, custom_map))
                }
                _ => None,
            },
            JSXExpression::ConditionalExpression(conditional) => {
                Some(handle_ternary(conditional, source, custom_map))
            }
            JSXExpression::LogicalExpression(logical)
                if logical.operator == LogicalOperator::And =>
            {
                Some(handle_logical_and(logical, source, custom_map))
            }
            _ => None,
        }
    }

    /// The resolve pass meeting an element an earlier pass migrated: with a
    /// map in play, the classes the map decides join the existing sz object.
    /// See the TypeScript for the full rationale.
    fn merge_into_sibling_sz(&mut self, attribute: &JSXAttribute<'a>) -> bool {
        let Some(custom_map) = self.options.custom_map else {
            return false;
        };
        let Some(JSXAttributeValue::StringLiteral(literal)) = &attribute.value else {
            return false;
        };
        let element = self
            .elements
            .last()
            .expect("an attribute is always inside an opening element");
        let SiblingSz::Static {
            object_start,
            object_end,
            last_property_end,
            keys,
        } = &element.sibling_sz
        else {
            return false;
        };
        let (object_start, object_end, last_property_end) =
            (*object_start, *object_end, *last_property_end);
        let element_name = element.name.clone();
        let existing_keys = keys.clone();
        let range = span_range(attribute.span);

        let trimmed = literal.value.trim_matches(is_js_whitespace);
        let converted = class_name_to_sz_object(trimmed, Some(custom_map));
        let mut remaining = converted.keep_in_class_name.clone();
        remaining.extend(converted.unrecognized.iter().cloned());
        let class_name_changed = remaining.join(" ") != tokenize(trimmed).join(" ");
        let unrecognized = converted.unrecognized.clone();

        if converted.sz_object.is_empty() && !class_name_changed {
            self.classes_unrecognized
                .extend(unrecognized.iter().cloned());
            self.inject_todo_comment(&unrecognized);
            return false;
        }
        let clashes: Vec<&String> = converted
            .sz_object
            .keys()
            .filter(|key| existing_keys.contains(key))
            .collect();
        if !clashes.is_empty() {
            let verb = if clashes.len() == 1 { "is" } else { "are" };
            self.warnings.push(format!(
                "[{}] Cannot merge resolved classes into the existing sz prop on <{element_name}>: {} {verb} already set. Resolve by hand.",
                self.file_path,
                clashes.iter().map(|key| key.as_str()).collect::<Vec<_>>().join(", ")
            ));
            self.classes_unrecognized
                .extend(unrecognized.iter().cloned());
            self.inject_todo_comment(&unrecognized);
            return false;
        }

        if !converted.sz_object.is_empty() {
            match last_property_end {
                Some(end) => self.replacements.push(Replacement {
                    start: end,
                    end,
                    text: format!(", {}", sz_html_value(&converted.sz_object, false)),
                }),
                None => self.replacements.push(Replacement {
                    start: object_start,
                    end: object_end,
                    text: sz_object_literal(&converted.sz_object),
                }),
            }
        }
        if remaining.is_empty() {
            // Take the space before the attribute with it, or two attributes
            // end up separated by two.
            let start = if range.0 > 0 && self.source.as_bytes()[range.0 - 1] == b' ' {
                range.0 - 1
            } else {
                range.0
            };
            self.replacements.push(Replacement {
                start,
                end: range.1,
                text: String::new(),
            });
        } else if class_name_changed {
            self.replacements.push(Replacement {
                start: range.0,
                end: range.1,
                text: format!("className=\"{}\"", remaining.join(" ")),
            });
        }
        self.stats.class_names_transformed += 1;
        self.classes_unrecognized
            .extend(unrecognized.iter().cloned());
        self.inject_todo_comment(&unrecognized);
        true
    }
}

/// A static sz object's span, the end of its last property, and its keys.
fn static_sz(object: &ObjectExpression<'_>) -> SiblingSz {
    let keys = object
        .properties
        .iter()
        .filter_map(|property| match property {
            ObjectPropertyKind::ObjectProperty(property)
                if !property.computed
                    && !property.method
                    && property.kind == PropertyKind::Init =>
            {
                static_key(&property.key).map(str::to_string)
            }
            _ => None,
        })
        .collect();
    SiblingSz::Static {
        object_start: object.span.start as usize,
        object_end: object.span.end as usize,
        last_property_end: object
            .properties
            .last()
            .map(|property| property.span().end as usize),
        keys,
    }
}

/// A static className as the attribute text that replaces it: `sz={{ … }}`,
/// preceded by the classes that stay in className when there are any.
fn process_static_string(
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
    let expression = sz_expression(&converted.sz_object);
    let mut remaining = converted.keep_in_class_name;
    remaining.extend(converted.unrecognized.iter().cloned());
    if remaining.is_empty() {
        return Some((format!("sz={expression}"), Vec::new()));
    }
    Some((
        format!("className=\"{}\" sz={expression}", remaining.join(" ")),
        converted.unrecognized,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_blank_class_string_is_nothing_to_migrate() {
        assert_eq!(process_static_string("", None), None);
        assert_eq!(process_static_string(" \u{00A0} ", None), None);
        assert_eq!(process_static_string("mystery", None), None);
    }
}
