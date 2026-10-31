//! Global custom-property usages csszyx does not rewrite: a DOM style method
//! called with a `--token`, a `--token` key in a raw JSX `style` object, and a
//! `var(--token)` inside a `className` string.
//!
//! The bundler plugin reads these before it aliases a global variable, and a
//! usage the alias would not follow fails the build. A file the parser
//! rejects cannot be checked at all, so it answers one `parse-error` record
//! instead of an empty list.

use std::collections::{BTreeSet, HashMap, HashSet};

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, BindingPattern, CallExpression, Expression, JSXAttribute, JSXAttributeName,
    JSXAttributeValue, JSXExpression, MemberExpression, ObjectPropertyKind, PropertyKey,
    VariableDeclarator,
};
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use serde::{Serialize, Serializer};

use super::parser::{parse_errors, source_type_for_path};
use super::recovery::SourceLines;
use super::source_walk::SourceWalk;
use super::TransformFile;

/// What one record reports.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GlobalVarUsageKind {
    /// `element.style.setProperty('--token', …)`.
    StyleSetProperty,
    /// `element.style.getPropertyValue('--token')`.
    StyleGetProperty,
    /// `element.style.removeProperty('--token')`.
    StyleRemoveProperty,
    /// A `--token` key in a JSX `style={{ … }}` object.
    JsxStyleKey,
    /// A `var(--token)` inside a static `className` string.
    ClassStringVarReference,
    /// The file could not be parsed, so none of its usages could be read.
    ParseError,
}

impl GlobalVarUsageKind {
    /// The name JavaScript reads, which is also the one the message prints.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::StyleSetProperty => "style-set-property",
            Self::StyleGetProperty => "style-get-property",
            Self::StyleRemoveProperty => "style-remove-property",
            Self::JsxStyleKey => "jsx-style-key",
            Self::ClassStringVarReference => "class-string-var-reference",
            Self::ParseError => "parse-error",
        }
    }
}

impl Serialize for GlobalVarUsageKind {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.as_str())
    }
}

/// Where a usage is: 1-based line, and 1-based column in UTF-16 code units
/// counted from the last `\n`, which is how a JavaScript string indexes it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalVarUsageLocation {
    /// The filename the file was handed in with.
    pub file_path: String,
    /// 1-based line.
    pub line: u32,
    /// 1-based UTF-16 column.
    pub column: u32,
}

/// One out-of-band usage, or the one record of a file that did not parse.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct GlobalVarUsage {
    /// What the record reports.
    pub kind: GlobalVarUsageKind,
    /// The custom property, leading `--` included; empty for a parse error.
    pub name: String,
    /// Where it is.
    pub location: GlobalVarUsageLocation,
    /// What a build error prints for it.
    pub message: String,
}

/// Which usages a scan reports.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Deserialize)]
#[serde(default)]
pub struct GlobalVarUsageQuery {
    /// Report only these custom properties; every one when absent.
    pub tokens: Option<Vec<String>>,
}

/// Scan every file, answering one list per file in input order.
///
/// A file whose text holds neither `--` nor `var(` is not parsed and answers
/// an empty list. Every other file is parsed once with the grammar the
/// transform picks for its filename.
///
/// Files are read one after another rather than on the rayon pool: the
/// compiler hands one file per call, and the pool's generic machinery costs
/// the wasm parser artifact 1,172 gzip bytes for no parallelism.
#[must_use]
pub fn scan_global_var_usages(
    files: &[TransformFile],
    query: &GlobalVarUsageQuery,
) -> Vec<Vec<GlobalVarUsage>> {
    let tokens: Option<HashSet<&str>> = query
        .tokens
        .as_ref()
        .map(|tokens| tokens.iter().map(String::as_str).collect());
    files
        .iter()
        .map(|file| usages_of(file, tokens.as_ref()))
        .collect()
}

/// The usages of one file.
fn usages_of(file: &TransformFile, tokens: Option<&HashSet<&str>>) -> Vec<GlobalVarUsage> {
    let source = file.source.as_str();
    if !source.contains("--") && !source.contains("var(") {
        return Vec::new();
    }
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, source_type_for_path(&file.filename)).parse();
    let mut records = Records {
        file,
        tokens,
        lines: SourceLines::new(&file.source),
        found: Vec::new(),
    };
    if let Some((start, error)) = parse_errors(&parsed).into_iter().next() {
        let message = format!(
            "the file could not be parsed ({error}), so its global custom-property usages cannot be checked."
        );
        records.push_record(
            GlobalVarUsageKind::ParseError,
            String::new(),
            start,
            message,
        );
        return records.found;
    }
    let mut walk = SourceWalk {
        usages: Some(UsageScan::default()),
        links: None,
    };
    walk.visit_program(&parsed.program);
    let scan = walk.usages.unwrap_or_default();
    for candidate in &scan.candidates {
        if let Some(name) = candidate.name.resolve(&scan.constants) {
            records.push(candidate.kind, name, candidate.start);
        }
    }
    records.found
}

/// The records found so far, and what placing one needs.
struct Records<'f> {
    file: &'f TransformFile,
    tokens: Option<&'f HashSet<&'f str>>,
    /// Indexed on the first record, so a file with none never pays for it.
    lines: SourceLines<'f>,
    found: Vec<GlobalVarUsage>,
}

impl Records<'_> {
    /// Record a usage of `name` at `start` when it is a reported custom property.
    fn push(&mut self, kind: GlobalVarUsageKind, name: &str, start: u32) {
        let reported = self.tokens.is_none_or(|tokens| tokens.contains(name));
        if name.starts_with("--") && reported {
            let message = format!(
                "{name} is used outside csszyx-owned global variable alias rewrites ({}).",
                kind.as_str()
            );
            self.push_record(kind, name.to_owned(), start, message);
        }
    }

    fn push_record(&mut self, kind: GlobalVarUsageKind, name: String, start: u32, message: String) {
        let source = self.file.source.as_str();
        let (line, byte_column) = self.lines.line_column(start);
        let line_start = (start - byte_column) as usize;
        let units = source[line_start..line_start + byte_column as usize]
            .encode_utf16()
            .count();
        self.found.push(GlobalVarUsage {
            kind,
            name,
            location: GlobalVarUsageLocation {
                file_path: self.file.filename.clone(),
                line,
                column: u32::try_from(units + 1).unwrap_or(u32::MAX),
            },
            message,
        });
    }
}

/// How a candidate names its custom property.
enum Spelled {
    /// The text itself.
    Text(String),
    /// A binding whose string value names it, if it has one.
    Constant(String),
}

impl Spelled {
    /// The name, a constant read through `constants`.
    fn resolve<'s>(&'s self, constants: &'s HashMap<String, String>) -> Option<&'s str> {
        match self {
            Self::Text(text) => Some(text),
            Self::Constant(binding) => constants.get(binding).map(String::as_str),
        }
    }
}

/// A place that would be a usage if its name is a reported custom property.
struct Candidate {
    kind: GlobalVarUsageKind,
    name: Spelled,
    start: u32,
}

/// What one walk over the file collects for this scan, outer node before the
/// nodes inside it; the walk is [`SourceWalk`], shared with the module-link
/// scan so the wasm artifact carries one copy of oxc's.
///
/// Constants are collected in the same walk and read only after it, so a use
/// resolves to the last `name = '<string>'` declarator of its name in source
/// order, wherever that declarator sits: scope is not read.
#[derive(Default)]
pub(crate) struct UsageScan {
    constants: HashMap<String, String>,
    candidates: Vec<Candidate>,
}

impl UsageScan {
    /// A `name = '<string>'` declarator, which a later use may read.
    pub(crate) fn declarator(&mut self, declarator: &VariableDeclarator<'_>) {
        if let (BindingPattern::BindingIdentifier(id), Some(Expression::StringLiteral(value))) =
            (&declarator.id, &declarator.init)
        {
            self.constants
                .insert(id.name.as_str().to_owned(), value.value.as_str().to_owned());
        }
    }

    /// A `style` or `className` attribute.
    pub(crate) fn jsx_attribute(&mut self, attribute: &JSXAttribute<'_>) {
        if let JSXAttributeName::Identifier(name) = &attribute.name {
            match name.name.as_str() {
                "style" => self.style_keys(attribute),
                "className" => self.class_name(attribute),
                _ => {}
            }
        }
    }

    fn candidate(&mut self, kind: GlobalVarUsageKind, name: Spelled, start: u32) {
        self.candidates.push(Candidate { kind, name, start });
    }

    /// `<member>.setProperty(first, …)` and its two siblings.
    pub(crate) fn style_method(&mut self, call: &CallExpression<'_>) {
        let kind = call
            .callee
            .as_member_expression()
            .and_then(member_name)
            .and_then(style_method_kind);
        let name = call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .and_then(spelled);
        if let (Some(kind), Some(name)) = (kind, name) {
            self.candidate(kind, name, call.span.start);
        }
    }

    /// Each key of a `style={{ … }}` object, spreads skipped.
    fn style_keys(&mut self, attribute: &JSXAttribute<'_>) {
        let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value else {
            return;
        };
        let JSXExpression::ObjectExpression(object) = &container.expression else {
            return;
        };
        for property in &object.properties {
            if let ObjectPropertyKind::ObjectProperty(property) = property {
                if let Some(name) = key_spelled(&property.key) {
                    self.candidate(GlobalVarUsageKind::JsxStyleKey, name, property.span.start);
                }
            }
        }
    }

    /// Each `var(--token)` in the static text of a `className`, sorted, once.
    fn class_name(&mut self, attribute: &JSXAttribute<'_>) {
        for text in attribute_strings(attribute) {
            for name in var_references(text) {
                self.candidate(
                    GlobalVarUsageKind::ClassStringVarReference,
                    Spelled::Text(name.to_owned()),
                    attribute.span.start,
                );
            }
        }
    }
}

/// The property a member expression reads, when it is spelled statically.
fn member_name<'b>(member: &'b MemberExpression<'_>) -> Option<&'b str> {
    match member {
        MemberExpression::StaticMemberExpression(member) => Some(member.property.name.as_str()),
        MemberExpression::ComputedMemberExpression(member) => match &member.expression {
            Expression::StringLiteral(literal) => Some(literal.value.as_str()),
            Expression::Identifier(id) => Some(id.name.as_str()),
            _ => None,
        },
        MemberExpression::PrivateFieldExpression(_) => None,
    }
}

/// The record a style method's name reports, if it is one of the three.
fn style_method_kind(method: &str) -> Option<GlobalVarUsageKind> {
    match method {
        "setProperty" => Some(GlobalVarUsageKind::StyleSetProperty),
        "getPropertyValue" => Some(GlobalVarUsageKind::StyleGetProperty),
        "removeProperty" => Some(GlobalVarUsageKind::StyleRemoveProperty),
        _ => None,
    }
}

/// How an expression names a custom property: a string, or a binding.
fn spelled(expression: &Expression<'_>) -> Option<Spelled> {
    match expression {
        Expression::StringLiteral(literal) => {
            Some(Spelled::Text(literal.value.as_str().to_owned()))
        }
        Expression::Identifier(id) => Some(Spelled::Constant(id.name.as_str().to_owned())),
        _ => None,
    }
}

/// How an object key names a custom property: a bare name, or a key
/// [`spelled`] can read.
fn key_spelled(key: &PropertyKey<'_>) -> Option<Spelled> {
    match key {
        PropertyKey::StaticIdentifier(id) => Some(Spelled::Text(id.name.as_str().to_owned())),
        key => key.as_expression().and_then(spelled),
    }
}

/// The static text of an attribute: a string, an expression-container string,
/// or the cooked chunks of an expression-container template.
fn attribute_strings<'b>(attribute: &'b JSXAttribute<'_>) -> Vec<&'b str> {
    match &attribute.value {
        Some(JSXAttributeValue::StringLiteral(literal)) => vec![literal.value.as_str()],
        Some(JSXAttributeValue::ExpressionContainer(container)) => match &container.expression {
            JSXExpression::StringLiteral(literal) => vec![literal.value.as_str()],
            // An untagged template with a malformed escape does not parse, so
            // every chunk that reaches this point has a cooked value.
            JSXExpression::TemplateLiteral(template) => template
                .quasis
                .iter()
                .filter_map(|quasi| quasi.value.cooked.as_ref().map(oxc_ast::ast::Str::as_str))
                .collect(),
            _ => Vec::new(),
        },
        _ => Vec::new(),
    }
}

/// The custom properties `var(` opens in `text`, as `/var\(\s*(--[\w-]+)/g`
/// reads them in JavaScript: sorted, each once.
fn var_references(text: &str) -> BTreeSet<&str> {
    // Names are ASCII, so byte order is the UTF-16 order JavaScript sorts by.
    text.match_indices("var(")
        .filter_map(|(at, open)| custom_property_at(&text[at + open.len()..]))
        .collect()
}

/// The `--name` a `var(` argument starts with, after JavaScript whitespace.
fn custom_property_at(argument: &str) -> Option<&str> {
    let rest = argument.trim_start_matches(is_js_whitespace);
    let end = rest
        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '-'))
        .unwrap_or(rest.len());
    let name = &rest[..end];
    (name.len() > 2 && name.starts_with("--")).then_some(name)
}

/// Whether JavaScript's `\s` matches `c`: Unicode white space without U+0085,
/// plus U+FEFF.
const fn is_js_whitespace(c: char) -> bool {
    c == '\u{feff}' || (c.is_whitespace() && c != '\u{85}')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scan(filename: &str, source: &str, tokens: Option<&[&str]>) -> Vec<GlobalVarUsage> {
        let query = GlobalVarUsageQuery {
            tokens: tokens.map(|tokens| tokens.iter().map(|t| (*t).to_owned()).collect()),
        };
        let file = TransformFile {
            filename: filename.to_owned(),
            source: source.to_owned(),
        };
        scan_global_var_usages(&[file], &query)
            .pop()
            .expect("one answer per file")
    }

    fn found(source: &str) -> Vec<(&'static str, String, u32, u32)> {
        scan("/p/a.tsx", source, None)
            .into_iter()
            .map(|usage| {
                (
                    usage.kind.as_str(),
                    usage.name,
                    usage.location.line,
                    usage.location.column,
                )
            })
            .collect()
    }

    fn names(source: &str) -> Vec<String> {
        scan("/p/a.tsx", source, None)
            .into_iter()
            .map(|usage| usage.name)
            .collect()
    }

    #[test]
    fn reads_the_three_style_methods_by_name_and_skips_any_other() {
        let source = "a.style.setProperty('--s', 1);\na.style.getPropertyValue('--g');\na.style.removeProperty('--r');\na.style.item('--i');\nplain('--p');";

        assert_eq!(
            found(source),
            vec![
                ("style-set-property", "--s".to_owned(), 1, 1),
                ("style-get-property", "--g".to_owned(), 2, 1),
                ("style-remove-property", "--r".to_owned(), 3, 1),
            ]
        );
    }

    #[test]
    fn reads_a_computed_method_name_from_a_string_or_an_identifier_only() {
        let source = "a.style['setProperty']('--lit');\na.style[setProperty]('--id');\na.style[`setProperty`]('--tpl');\nclass C { #setProperty() {} m() { this.#setProperty('--private'); } }";

        assert_eq!(names(source), vec!["--lit", "--id"]);
    }

    #[test]
    fn resolves_a_first_argument_through_the_last_string_constant() {
        let source = "a.style.setProperty(t);\nconst t = '--first';\n{ const t = '--last'; }\nconst { d } = o;\nlet u;\nconst n = 1;\na.style.setProperty(u);\na.style.setProperty(n);\na.style.setProperty(...s);\na.style.setProperty(`--tpl`);\na.style.removeProperty();";

        assert_eq!(names(source), vec!["--last"]);
    }

    #[test]
    fn reports_only_names_that_start_with_two_dashes() {
        assert_eq!(
            names("a.style.setProperty('-x');\na.style.setProperty('x--');"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn reads_style_object_keys_of_every_static_spelling() {
        let source = "const k = '--computed';\nconst A = () => <i style={{ ...base, '--lit': 1, [k]: 2, ['--bracket']: 3, 123: 4, color: 5, [unknown]: 6, '--m'() {} }} />;";

        assert_eq!(
            names(source),
            vec!["--lit", "--computed", "--bracket", "--m"]
        );
    }

    #[test]
    fn reads_a_style_key_only_inside_an_object_literal_container() {
        let source = "const A = () => <><i style={s} /><i style=\"--a: 1\" /><i style={({ '--paren': 1 })} /><i style={{ '--ok': 1 }} /></>;";

        assert_eq!(names(source), vec!["--ok"]);
    }

    #[test]
    fn reads_class_name_text_from_strings_and_template_chunks_only() {
        let source = "const A = () => <><i className=\"var(--a)\" /><i className={'var(--b)'} /><i className={`var(--c) ${x} var(--d)`} /><i className={x} /><i className /><i class=\"var(--e)\" /><i xlink:href=\"var(--f)\" /><i className=<b /> /></>;";

        assert_eq!(names(source), vec!["--a", "--b", "--c", "--d"]);
    }

    #[test]
    fn sorts_and_dedupes_the_references_of_one_class_name() {
        let source = "const A = () => <i className=\"var(--z) var(--a) var(--z)\" />;";

        assert_eq!(names(source), vec!["--a", "--z"]);
    }

    #[test]
    fn reads_a_var_argument_as_the_javascript_pattern_does() {
        assert_eq!(
            var_references("var(--a) var( \t--b) var(--) var(-x) var(--c_1-d!) var(--é) var(\u{a0}--nbsp) var(\u{feff}--bom) var(\u{85}--nel)")
                .into_iter()
                .collect::<Vec<_>>(),
            vec!["--a", "--b", "--bom", "--c_1-d", "--nbsp"]
        );
    }

    #[test]
    fn javascript_whitespace_is_unicode_white_space_less_nel_plus_bom() {
        for c in [
            ' ', '\t', '\n', '\u{b}', '\u{c}', '\r', '\u{a0}', '\u{2028}', '\u{3000}', '\u{feff}',
        ] {
            assert!(is_js_whitespace(c), "{c:?}");
        }
        for c in ['\u{85}', 'a', '-', '\u{200b}'] {
            assert!(!is_js_whitespace(c), "{c:?}");
        }
    }

    #[test]
    fn filters_by_token_when_asked() {
        let source = "a.style.setProperty('--keep');\na.style.setProperty('--drop');";
        let kept: Vec<String> = scan("/p/a.ts", source, Some(&["--keep"]))
            .into_iter()
            .map(|usage| usage.name)
            .collect();

        assert_eq!(kept, vec!["--keep"]);
    }

    #[test]
    fn places_a_usage_by_utf16_column_after_the_last_newline_only() {
        let source = "x;\n'😀é'; a.style.setProperty('--a');\ny;\rb.style.setProperty('--b');";

        assert_eq!(
            found(source),
            vec![
                // Seven UTF-16 units precede the call; ten bytes do.
                ("style-set-property", "--a".to_owned(), 2, 8),
                ("style-set-property", "--b".to_owned(), 3, 4),
            ]
        );
    }

    #[test]
    fn writes_the_message_and_location_a_build_error_prints() {
        let usage = scan("/p/a.ts", "a.style.setProperty('--a');", None).remove(0);

        assert_eq!(
            usage,
            GlobalVarUsage {
                kind: GlobalVarUsageKind::StyleSetProperty,
                name: "--a".to_owned(),
                location: GlobalVarUsageLocation {
                    file_path: "/p/a.ts".to_owned(),
                    line: 1,
                    column: 1,
                },
                message: "--a is used outside csszyx-owned global variable alias rewrites (style-set-property).".to_owned(),
            }
        );
    }

    #[test]
    fn answers_a_rejected_file_with_one_parse_error_record_whatever_the_filter() {
        let usages = scan(
            "/p/bad.ts",
            "x;\nconst = var(--a);\nconst = 1;",
            Some(&["--b"]),
        );

        assert_eq!(
            usages,
            vec![GlobalVarUsage {
                kind: GlobalVarUsageKind::ParseError,
                name: String::new(),
                location: GlobalVarUsageLocation {
                    file_path: "/p/bad.ts".to_owned(),
                    line: 2,
                    column: 7,
                },
                message: "the file could not be parsed (Unexpected token), so its global custom-property usages cannot be checked.".to_owned(),
            }]
        );
    }

    #[test]
    fn parses_only_text_that_can_hold_a_custom_property() {
        assert!(scan("/p/bad.ts", "const = ;", None).is_empty());
        assert_eq!(scan("/p/bad.ts", "const = var(;", None).len(), 1);
        assert_eq!(scan("/p/bad.ts", "const = --;", None).len(), 1);
    }

    #[test]
    fn reads_jsx_in_a_plain_javascript_file() {
        let usages = scan(
            "/p/a.js",
            "const A = () => <i style={{ '--js': 1 }} />;",
            None,
        );

        assert_eq!(usages.len(), 1);
        assert_eq!(usages[0].name, "--js");
    }

    #[test]
    fn reports_an_outer_call_before_the_calls_in_its_arguments() {
        let source = "a.style.setProperty('--outer', a.style.getPropertyValue('--inner'));\nconst A = () => <i style={{ '--key': a.style.removeProperty('--in-key') }} />;";

        assert_eq!(
            names(source),
            vec!["--outer", "--inner", "--key", "--in-key"]
        );
    }

    #[test]
    fn serializes_the_record_javascript_reads() {
        let usage = scan("/p/a.ts", "a.style.setProperty('--a');", None).remove(0);

        assert_eq!(
            serde_json::to_string(&usage).expect("encodes"),
            r#"{"kind":"style-set-property","name":"--a","location":{"filePath":"/p/a.ts","line":1,"column":1},"message":"--a is used outside csszyx-owned global variable alias rewrites (style-set-property)."}"#
        );
    }

    #[test]
    fn names_every_kind_as_javascript_reads_it() {
        let kinds = [
            GlobalVarUsageKind::StyleSetProperty,
            GlobalVarUsageKind::StyleGetProperty,
            GlobalVarUsageKind::StyleRemoveProperty,
            GlobalVarUsageKind::JsxStyleKey,
            GlobalVarUsageKind::ClassStringVarReference,
            GlobalVarUsageKind::ParseError,
        ];

        assert_eq!(
            kinds.map(GlobalVarUsageKind::as_str),
            [
                "style-set-property",
                "style-get-property",
                "style-remove-property",
                "jsx-style-key",
                "class-string-var-reference",
                "parse-error",
            ]
        );
    }
}
