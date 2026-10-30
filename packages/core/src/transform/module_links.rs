//! What a module links to: its stylesheets and the names it re-exports.
//!
//! When asked, also the values it exports for the cross-module registry, the
//! module format and every module it loads, and the CSS its `<style>`
//! elements hold. One parse answers them all.

use std::collections::{HashMap, HashSet};

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, CallExpression, Expression, ImportExpression, ImportOrExportKind, JSXElement,
    JSXElementName, TSImportEqualsDeclaration, TSModuleReference, TemplateLiteral,
};
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::Span;
use oxc_syntax::identifier::is_identifier_name;
use oxc_syntax::module_record::{
    ExportEntry, ExportExportName, ExportImportName, ImportImportName, ModuleRecord,
};

use super::parser::source_type_for_path;
use super::registry_entries::{registry_entries, RegistryEntry};
use super::source_walk::SourceWalk;
use super::TransformFile;

/// One name a module exports without declaring it.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleForward {
    /// The name this module exports, and therefore the one an importer writes.
    pub export_name: String,
    /// The name the provider exports it as; `default` for the default slot.
    pub imported_name: String,
    /// The provider specifier, exactly as this module spelled it.
    pub specifier: String,
}

/// The links one module carries.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleLinks {
    /// Stylesheet specifiers, query suffix kept, in source order, each once.
    pub css_imports: Vec<String>,
    /// Re-exported names, declaration order preserved.
    pub forwards: Vec<ModuleForward>,
    /// Exported values for the cross-module registry; empty unless asked for.
    pub registry_entries: Vec<RegistryEntry>,
    /// Whether the source is an ES module: an `import` or `export` statement,
    /// or `import.meta`. False unless module facts were asked for.
    pub module_syntax: bool,
    /// Every module the source loads: its imports and re-exports, then each
    /// `import()`, `require()` or TypeScript `import … = require()` with a
    /// literal specifier, in source order; type-only ones are left out. Empty
    /// unless module facts were asked for.
    pub loads: Vec<ModuleLoad>,
    /// The text of every string, template part and JSX text inside a
    /// `<style>` element, escapes decoded; empty unless asked for.
    pub style_css: Vec<String>,
    /// Every other string holding `<style`, as markup a script builds.
    pub style_markup: Vec<String>,
    /// Whether the parse this scan ran stopped on a syntax error, so the facts
    /// above come from a partial tree; false when the scan did not parse.
    pub parse_failed: bool,
}

/// Which optional answers a scan computes.
///
/// Registry entries cost a scope walk and an evaluation per export, and only
/// the registry pass wants them, so a stylesheet or forward scan does not pay
/// for them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ModuleLinksQuery {
    /// Read the exported values the cross-module registry carries.
    pub registry_entries: bool,
    /// Read the module format and every module the source loads.
    pub module_facts: bool,
    /// Read the CSS `<style>` elements hold, and the strings that build one.
    pub style_texts: bool,
}

/// One module a source loads, and one name it reads from it.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleLoad {
    /// The specifier, exactly as the source spelled it.
    pub specifier: String,
    /// The name read, or none when every name is reachable: a namespace, an
    /// `export *`, an `import()` or a `require()`. Left out of the JSON when
    /// none, as the napi object leaves it out.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// The provider name standing for a module's default slot.
const DEFAULT_IMPORT_NAME: &str = "default";

/// Bytes read after an export clause's `}` when looking for `from`.
const FROM_WINDOW: usize = 63;

/// Bytes read before an export clause's `{` when looking for `export type`.
const TYPE_WINDOW: usize = 48;

/// Read the links of every file, in input order.
///
/// Each file is parsed once, and only when its text can hold a link. For `N`
/// source bytes the lexical gate is `O(N)` time and `O(1)` space; the parser is
/// entered for a literal `.css`, or for a module request containing a backslash
/// because JavaScript escapes can hide any part of the extension. The worst
/// case is an import-heavy file whose strings contain escapes, which is parsed
/// once like a directly spelled stylesheet request.
///
/// Registry entries, when the query asks for them, come from the same parse,
/// and only from a module whose text contains `export`.
pub fn scan_module_links(files: &[TransformFile], query: ModuleLinksQuery) -> Vec<ModuleLinks> {
    super::map_files(files, |file| links_of(file, query))
}

/// Read the links of one file.
fn links_of(file: &TransformFile, query: ModuleLinksQuery) -> ModuleLinks {
    let source = file.source.as_str();
    let wants_css = may_request_stylesheet(source);
    let wants_forwards = has_export_clause(source);
    let wants_entries = query.registry_entries && source.contains("export");
    let wants_facts = query.module_facts;
    let wants_styles = query.style_texts && contains_ignoring_case(source, "<style");
    if !wants_css && !wants_forwards && !wants_entries && !wants_facts && !wants_styles {
        return ModuleLinks::default();
    }
    // The arena lives for this call only, so every file's parse is freed
    // before the next one starts. The dialect is the one the transform reads
    // the file in: JSX in a plain `.js` file parses.
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, source_type_for_path(&file.filename)).parse();
    let record = &parsed.module_record;
    let mut walk = SourceWalk {
        usages: None,
        links: Some(LinkScan {
            wants_loads: wants_facts,
            wants_styles,
            ..LinkScan::default()
        }),
    };
    if wants_css || wants_facts || wants_styles {
        walk.visit_program(&parsed.program);
    }
    let mut walk = walk.links.unwrap_or_default();
    let dynamic = std::mem::take(&mut walk.stylesheet_imports);
    ModuleLinks {
        parse_failed: parsed.diagnostics.has_errors(),
        css_imports: if wants_css {
            css_imports(record, dynamic)
        } else {
            Vec::new()
        },
        forwards: if wants_forwards {
            forwards(record, source)
        } else {
            Vec::new()
        },
        registry_entries: if wants_entries {
            registry_entries(&parsed.program)
        } else {
            Vec::new()
        },
        ..script_facts(record, walk, wants_facts)
    }
}

/// Whether `text` holds `needle`, ASCII case ignored.
fn contains_ignoring_case(text: &str, needle: &str) -> bool {
    text.as_bytes()
        .windows(needle.len())
        .any(|window| window.eq_ignore_ascii_case(needle.as_bytes()))
}

/// The module facts and style texts of one parsed source.
fn script_facts(record: &ModuleRecord<'_>, mut facts: LinkScan, wants_facts: bool) -> ModuleLinks {
    if !wants_facts {
        return ModuleLinks {
            style_css: facts.style_css,
            style_markup: facts.style_markup,
            ..ModuleLinks::default()
        };
    }
    let mut loads = static_loads(record);
    loads.append(&mut facts.loads);
    ModuleLinks {
        module_syntax: record.has_module_syntax || !record.import_metas.is_empty(),
        loads,
        style_css: facts.style_css,
        style_markup: facts.style_markup,
        ..ModuleLinks::default()
    }
}

/// The imports and re-exports of a module record, one per name read; a
/// type-only one loads nothing at runtime.
fn static_loads(record: &ModuleRecord<'_>) -> Vec<ModuleLoad> {
    let imports = record
        .import_entries
        .iter()
        .filter(|entry| !entry.is_type)
        .map(|entry| ModuleLoad {
            specifier: entry.module_request.name.to_string(),
            name: match &entry.import_name {
                ImportImportName::Name(name) => Some(name.name.to_string()),
                ImportImportName::Default(_) => Some(DEFAULT_IMPORT_NAME.to_owned()),
                ImportImportName::NamespaceObject => None,
            },
        });
    let exports = record
        .indirect_export_entries
        .iter()
        .chain(&record.star_export_entries)
        .filter(|entry| !entry.is_type)
        .filter_map(|entry| {
            let specifier = entry.module_request.as_ref()?.name.to_string();
            let name = match &entry.import_name {
                ExportImportName::Name(name) => Some(name.name.to_string()),
                _ => None,
            };
            Some(ModuleLoad { specifier, name })
        });
    imports.chain(exports).collect()
}

/// The value of a string literal or of a template with no substitution,
/// escapes decoded; none for any other expression.
fn static_text<'a>(expression: &'a Expression<'_>) -> Option<&'a str> {
    match expression {
        Expression::StringLiteral(literal) => Some(literal.value.as_str()),
        Expression::TemplateLiteral(template) if template.expressions.is_empty() => template
            .quasis
            .first()
            .and_then(|quasi| quasi.value.cooked.as_ref())
            .map(oxc_ast::ast::Str::as_str),
        _ => None,
    }
}

/// What one walk of a program collects beyond its module record; the walk
/// is [`SourceWalk`], shared with the global-variable scan so the wasm
/// artifact carries one copy of oxc's.
#[derive(Default)]
pub(crate) struct LinkScan {
    /// Static string values requested through `import()` that name a
    /// stylesheet, with source positions.
    stylesheet_imports: Vec<(u32, String)>,
    wants_loads: bool,
    wants_styles: bool,
    /// How many `<style>` elements the walk is inside.
    pub(crate) in_style: usize,
    /// The modules loaded by a call or a TypeScript `import … = require()`,
    /// in source order.
    loads: Vec<ModuleLoad>,
    style_css: Vec<String>,
    style_markup: Vec<String>,
}

impl LinkScan {
    /// File one piece of string text: CSS inside a `<style>` element, markup
    /// elsewhere when it holds `<style`.
    pub(crate) fn text(&mut self, text: &str) {
        if !self.wants_styles {
            return;
        }
        if self.in_style > 0 {
            self.style_css.push(text.to_owned());
        } else if contains_ignoring_case(text, "<style") {
            self.style_markup.push(text.to_owned());
        }
    }
}

impl LinkScan {
    /// An `import()` whose specifier names a stylesheet.
    pub(crate) fn import_expression(&mut self, import: &ImportExpression<'_>) {
        let Some(specifier) = static_text(&import.source) else {
            return;
        };
        if names_stylesheet(specifier) {
            self.stylesheet_imports
                .push((import.span.start, specifier.to_owned()));
        }
        self.load(specifier);
    }

    /// A `require()` with a literal specifier.
    pub(crate) fn call(&mut self, call: &CallExpression<'_>) {
        if !matches!(&call.callee, Expression::Identifier(name) if name.name == "require") {
            return;
        }
        if let Some(specifier) = call
            .arguments
            .first()
            .and_then(Argument::as_expression)
            .and_then(static_text)
        {
            self.load(specifier);
        }
    }

    /// A TypeScript `import name = require('…')`, which compiles to a
    /// `require()`; a type-only one loads nothing.
    pub(crate) fn import_equals(&mut self, declaration: &TSImportEqualsDeclaration<'_>) {
        if let (ImportOrExportKind::Value, TSModuleReference::ExternalModuleReference(reference)) =
            (declaration.import_kind, &declaration.module_reference)
        {
            self.load(&reference.expression.value);
        }
    }

    /// Record a module the source loads with every name reachable.
    fn load(&mut self, specifier: &str) {
        if self.wants_loads {
            self.loads.push(ModuleLoad {
                specifier: specifier.to_owned(),
                name: None,
            });
        }
    }

    /// The text of a template's static parts.
    pub(crate) fn template(&mut self, template: &TemplateLiteral<'_>) {
        for quasi in &template.quasis {
            let text = quasi.value.cooked.as_ref().unwrap_or(&quasi.value.raw);
            self.text(text);
        }
    }

    /// Whether an element is a `<style>` element.
    pub(crate) fn is_style(element: &JSXElement<'_>) -> bool {
        matches!(
            &element.opening_element.name,
            JSXElementName::Identifier(name) if name.name == "style"
        )
    }
}

/// Whether source text can hold a direct or escaped stylesheet request.
fn may_request_stylesheet(source: &str) -> bool {
    source.contains(".css") || (source.contains('\\') && source.contains("import"))
}

/// Whether a specifier names a stylesheet, ignoring a `?query` suffix.
fn names_stylesheet(specifier: &str) -> bool {
    specifier
        .split('?')
        .next()
        .is_some_and(|path| std::path::Path::new(path).extension() == Some("css".as_ref()))
}

/// Stylesheet specifiers a module requests, statically or through `import()`.
fn css_imports(record: &ModuleRecord<'_>, dynamic: Vec<(u32, String)>) -> Vec<String> {
    let mut found: Vec<(u32, String)> = Vec::new();
    for (specifier, requests) in &record.requested_modules {
        if !names_stylesheet(specifier.as_str()) {
            continue;
        }
        for request in requests.iter().filter(|request| !request.is_type) {
            found.push((request.span.start, specifier.as_str().to_owned()));
        }
    }
    found.extend(dynamic);
    // The record keys requests by specifier, so source order is restored
    // from the spans before duplicates are dropped.
    found.sort_unstable_by_key(|(start, _)| *start);
    let mut unique: Vec<String> = Vec::with_capacity(found.len());
    for (_, specifier) in found {
        if !unique.contains(&specifier) {
            unique.push(specifier);
        }
    }
    unique
}

/// Every re-exported name in one module, with the module it points at.
fn forwards(record: &ModuleRecord<'_>, source: &str) -> Vec<ModuleForward> {
    let default_imports: HashSet<(&str, &str)> = record
        .import_entries
        .iter()
        .filter(|entry| matches!(entry.import_name, ImportImportName::Default(_)) && !entry.is_type)
        .map(|entry| {
            (
                entry.module_request.name.as_str(),
                entry.local_name.name.as_str(),
            )
        })
        .collect();
    // Grouped by statement and ordered by where the statement starts, which
    // is the order a reader of the module meets the clauses in.
    let grouped = group_export_statements(
        record
            .local_export_entries
            .iter()
            .chain(&record.indirect_export_entries)
            .chain(&record.star_export_entries),
    );
    grouped
        .statements
        .iter()
        .flat_map(|(_, entries)| entries.iter())
        .filter_map(|entry| read_forward(entry, source, &default_imports))
        .collect()
}

/// Export entries grouped by their source statement.
struct GroupedExportStatements<'a> {
    statements: Vec<(Span, Vec<&'a ExportEntry<'a>>)>,
    #[cfg(test)]
    index_lookups: usize,
}

/// Group export entries without scanning every prior statement for each entry.
///
/// For E export entries across G statements this performs E hash-table entry
/// lookups, then sorts the G groups: expected O(E + G log G) time and O(G)
/// auxiliary space. Module-link scanning pays this cost once per parsed barrel.
fn group_export_statements<'a>(
    entries: impl Iterator<Item = &'a ExportEntry<'a>>,
) -> GroupedExportStatements<'a> {
    let mut statements: Vec<(Span, Vec<&ExportEntry<'a>>)> = Vec::new();
    let mut statement_indices: HashMap<(u32, u32), usize> = HashMap::new();
    #[cfg(test)]
    let mut index_lookups = 0;

    for entry in entries {
        #[cfg(test)]
        {
            index_lookups += 1;
        }
        let span = entry.statement_span;
        match statement_indices.entry((span.start, span.end)) {
            std::collections::hash_map::Entry::Occupied(known) => {
                statements[*known.get()].1.push(entry);
            }
            std::collections::hash_map::Entry::Vacant(vacant) => {
                vacant.insert(statements.len());
                statements.push((span, vec![entry]));
            }
        }
    }
    statements.sort_unstable_by_key(|(span, _)| span.start);
    GroupedExportStatements {
        statements,
        #[cfg(test)]
        index_lookups,
    }
}

/// The forward one export entry carries, if it carries one.
fn read_forward(
    entry: &ExportEntry<'_>,
    source: &str,
    default_imports: &HashSet<(&str, &str)>,
) -> Option<ModuleForward> {
    // A type-only export carries nothing at runtime; an entry with no module
    // request is a value this module declares, which the value extractor owns.
    if entry.is_type {
        return None;
    }
    let specifier = entry.module_request.as_ref()?.name.as_str();
    let export_name = match &entry.export_name {
        ExportExportName::Name(name) => recorded_name(name.name.as_str())?,
        ExportExportName::Default(_) | ExportExportName::Null => return None,
    };
    let imported_name = match &entry.import_name {
        ExportImportName::Name(name) => recorded_name(name.name.as_str())?,
        ExportImportName::All | ExportImportName::AllButDefault | ExportImportName::Null => {
            return None
        }
    };
    let (through_import, type_statement) = read_export_clause(entry.span, source);
    if through_import {
        // The two type marks the record does not carry for a re-exported
        // import sit on the export clause: `export type {` and an inline
        // `type X` inside the entry's own span.
        if type_statement || starts_with_type_keyword(entry.span.source_text(source)) {
            return None;
        }
    }
    let imported_name = if through_import && default_imports.contains(&(specifier, imported_name)) {
        DEFAULT_IMPORT_NAME
    } else {
        imported_name
    };
    Some(ModuleForward {
        export_name: export_name.to_owned(),
        imported_name: imported_name.to_owned(),
        specifier: specifier.to_owned(),
    })
}

/// The name a forward records, or None for a string-literal name that no
/// importer of a token module writes.
fn recorded_name(name: &str) -> Option<&str> {
    is_identifier_name(name).then_some(name)
}

/// Whether an export specifier is written `type X`.
fn starts_with_type_keyword(text: &str) -> bool {
    text.strip_prefix("type")
        .and_then(|rest| rest.chars().next())
        .is_some_and(is_js_whitespace)
}

/// How the export clause around one entry is written: whether the entry is
/// spelled by a local binding rather than a `from` clause, and whether its
/// clause is `export type {`.
fn read_export_clause(entry: Span, source: &str) -> (bool, bool) {
    let end = entry.end as usize;
    let through_import = source[end..].find('}').is_none_or(|offset| {
        let close = end + offset;
        let after = trim_js_start(window(source, close + 1, close + 1 + FROM_WINDOW));
        !(after
            .strip_prefix("from")
            .map(trim_js_start)
            .is_some_and(|rest| rest.starts_with(['"', '\''])))
    });
    let start = entry.start as usize;
    let type_statement = source[..=start.min(source.len().saturating_sub(1))]
        .rfind('{')
        .is_some_and(|open| {
            is_export_type_suffix(window(source, open.saturating_sub(TYPE_WINDOW), open))
        });
    (through_import, type_statement)
}

/// Whether text ends in `export type`, the `export` a whole word.
fn is_export_type_suffix(text: &str) -> bool {
    let Some(rest) = trim_js_end(text).strip_suffix("type") else {
        return false;
    };
    let trimmed = trim_js_end(rest);
    if trimmed.len() == rest.len() {
        return false;
    }
    trimmed.strip_suffix("export").is_some_and(|before| {
        !before
            .chars()
            .next_back()
            .is_some_and(|c| c.is_alphanumeric() || c == '_')
    })
}

/// A byte range of the source, narrowed inward to character boundaries.
fn window(source: &str, from: usize, to: usize) -> &str {
    source
        .get(source.ceil_char_boundary(from)..source.floor_char_boundary(to))
        .unwrap_or("")
}

/// The whitespace a JavaScript `\s` matches.
const fn is_js_whitespace(c: char) -> bool {
    c.is_whitespace() || c == '\u{feff}'
}

/// Text without leading JavaScript whitespace.
fn trim_js_start(text: &str) -> &str {
    text.trim_start_matches(is_js_whitespace)
}

/// Text without trailing JavaScript whitespace.
fn trim_js_end(text: &str) -> &str {
    text.trim_end_matches(is_js_whitespace)
}

/// Whether the text holds an `export {` clause - the one shape a forward can
/// take, with or without `from`.
///
/// The gate before the parse: `export function`, `export const` and
/// `export default` declare their value here and `export *` names nothing,
/// so only a clause is worth a parse. Whitespace and comments may sit between
/// the keyword and the brace. A false positive (the text inside a string or
/// comment) only costs a parse; the scan never refuses a real clause.
fn has_export_clause(source: &str) -> bool {
    let mut cursor = source.find("export");
    while let Some(at) = cursor {
        let position = skip_trivia(source, at + "export".len());
        if source[position..].starts_with('{') {
            return true;
        }
        // Resume past what was scanned, so a comment is never read twice;
        // the scan always ends past the keyword itself.
        cursor = source[position..]
            .find("export")
            .map(|offset| position + offset);
    }
    false
}

/// The first offset at or after `start` holding neither whitespace nor a comment.
fn skip_trivia(source: &str, start: usize) -> usize {
    let mut position = start;
    loop {
        position += source[position..].len() - trim_js_start(&source[position..]).len();
        let rest = &source[position..];
        if let Some(body) = rest.strip_prefix("/*") {
            position = body
                .find("*/")
                .map_or(source.len(), |close| position + 2 + close + 2);
            continue;
        }
        if let Some(body) = rest.strip_prefix("//") {
            position = body
                .find('\n')
                .map_or(source.len(), |newline| position + 2 + newline);
            continue;
        }
        return position;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxc_span::SourceType;

    #[test]
    fn export_type_suffix_needs_a_word_break_before_type() {
        // `exporttype {` is one identifier, not `export type {`: without the
        // break before `type` the clause is an ordinary export.
        assert!(!is_export_type_suffix("exporttype"));
        assert!(!is_export_type_suffix("mytype"));
        assert!(is_export_type_suffix("export type"));
        assert!(is_export_type_suffix("export\ttype "));
    }

    fn links(source: &str, filename: &str) -> ModuleLinks {
        let files = [TransformFile {
            filename: filename.to_owned(),
            source: source.to_owned(),
        }];
        scan_module_links(&files, ModuleLinksQuery::default()).remove(0)
    }

    fn forwards(source: &str) -> Vec<(String, String, String)> {
        links(source, "/p/index.ts")
            .forwards
            .into_iter()
            .map(|f| (f.export_name, f.imported_name, f.specifier))
            .collect()
    }

    fn fwd(export_name: &str, imported_name: &str, specifier: &str) -> (String, String, String) {
        (
            export_name.to_owned(),
            imported_name.to_owned(),
            specifier.to_owned(),
        )
    }

    fn css(source: &str) -> Vec<String> {
        links(source, "/p/main.tsx").css_imports
    }

    #[test]
    fn statement_grouping_uses_one_index_lookup_per_entry() {
        let source = (0..8_192)
            .map(|index| format!("export {{ x{index} }} from './m{index}';"))
            .collect::<Vec<_>>()
            .join("\n");
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, &source, SourceType::tsx()).parse();
        let record = &parsed.module_record;

        let grouped = group_export_statements(
            record
                .local_export_entries
                .iter()
                .chain(&record.indirect_export_entries)
                .chain(&record.star_export_entries),
        );

        assert_eq!(grouped.statements.len(), 8_192);
        assert_eq!(grouped.index_lookups, 8_192);
    }

    #[test]
    fn re_export_links_to_the_provider() {
        assert_eq!(
            forwards("export { cardSz } from './styles';"),
            [fwd("cardSz", "cardSz", "./styles")]
        );
    }

    #[test]
    fn re_export_keeps_renamed_names_apart() {
        assert_eq!(
            forwards("export { cardSz as card } from './styles';"),
            [fwd("card", "cardSz", "./styles")]
        );
    }

    #[test]
    fn re_export_of_provider_default_uses_the_barrel_name() {
        assert_eq!(
            forwards("export { default as card } from './styles';"),
            [fwd("card", "default", "./styles")]
        );
    }

    #[test]
    fn re_export_reads_several_clauses_in_order() {
        assert_eq!(
            forwards("export { a, b as c } from './styles';"),
            [fwd("a", "a", "./styles"), fwd("c", "b", "./styles")]
        );
    }

    #[test]
    fn imported_binding_re_exported_by_name() {
        assert_eq!(
            forwards("import { cardSz } from './styles';\nexport { cardSz };"),
            [fwd("cardSz", "cardSz", "./styles")]
        );
    }

    #[test]
    fn local_alias_follows_back_to_the_provider_name() {
        assert_eq!(
            forwards("import { cardSz as local } from './styles';\nexport { local as card };"),
            [fwd("card", "cardSz", "./styles")]
        );
    }

    #[test]
    fn default_import_re_exported_by_name() {
        assert_eq!(
            forwards("import card from './styles';\nexport { card };"),
            [fwd("card", "default", "./styles")]
        );
    }

    #[test]
    fn export_list_before_the_import() {
        assert_eq!(
            forwards("export { cardSz };\nimport { cardSz } from './styles';"),
            [fwd("cardSz", "cardSz", "./styles")]
        );
    }

    #[test]
    fn declared_names_are_not_forwards() {
        assert!(forwards("export const cardSz = { p: 4 };").is_empty());
        assert!(forwards("const cardSz = { p: 4 };\nexport { cardSz };").is_empty());
    }

    #[test]
    fn type_only_re_exports_are_not_forwards() {
        assert!(forwards("export type { Card } from './styles';").is_empty());
        assert!(forwards("export { type Card } from './styles';").is_empty());
    }

    #[test]
    fn types_imported_and_re_exported_in_two_statements_are_not_forwards() {
        assert!(forwards("import type { Card } from './styles';\nexport { Card };").is_empty());
        assert!(forwards("import { type Card } from './styles';\nexport { Card };").is_empty());
        assert!(forwards("import { Card } from './styles';\nexport { type Card };").is_empty());
        assert!(forwards("import { Card } from './styles';\nexport type { Card };").is_empty());
    }

    #[test]
    fn type_clause_next_to_a_value_clause_is_dropped() {
        assert_eq!(
            forwards(
                "import { Card, card } from './styles';\nexport type { Card };\nexport { card };"
            ),
            [fwd("card", "card", "./styles")]
        );
    }

    #[test]
    fn from_clause_longer_than_a_fixed_window() {
        let names: Vec<String> = (0..40).map(|i| format!("a{i}")).collect();
        let source = format!(
            "import a0 from './p';\nexport {{ {} }} from './p';",
            names.join(", ")
        );
        let result = forwards(&source);
        assert_eq!(result.len(), 40);
        assert_eq!(result[0], fwd("a0", "a0", "./p"));
    }

    #[test]
    fn from_clause_name_wins_over_a_default_import_sharing_it() {
        assert_eq!(
            forwards("import B from './b';\nexport { B } from './b';"),
            [fwd("B", "B", "./b")]
        );
    }

    #[test]
    fn namespace_import_re_exported_whole_is_not_a_forward() {
        assert!(forwards("import * as S from './styles';\nexport { S };").is_empty());
    }

    #[test]
    fn star_re_exports_are_not_forwards() {
        assert!(forwards("export * from './styles';").is_empty());
        assert!(forwards("export * as S from './styles';").is_empty());
    }

    #[test]
    fn string_names_are_not_forwards() {
        assert!(forwards("import { \"a-b\" as c } from './styles';\nexport { c };").is_empty());
        assert!(forwards("export { cardSz as \"a-b\" } from './styles';").is_empty());
    }

    #[test]
    fn side_effect_import_binds_nothing() {
        assert_eq!(
            forwards("import './styles';\nexport { cardSz } from './base';"),
            [fwd("cardSz", "cardSz", "./base")]
        );
    }

    #[test]
    fn module_without_exports_has_no_forwards() {
        assert!(forwards("import { cardSz } from './styles';\nconsole.log(cardSz);").is_empty());
    }

    #[test]
    fn clause_separated_by_comments_or_whitespace_is_read() {
        assert_eq!(
            forwards("export /* the card */ { cardSz } from './styles';"),
            [fwd("cardSz", "cardSz", "./styles")]
        );
        assert_eq!(
            forwards("export // line\n{ cardSz } from './styles';"),
            [fwd("cardSz", "cardSz", "./styles")]
        );
        assert_eq!(
            forwards("export{cardSz}from'./styles';"),
            [fwd("cardSz", "cardSz", "./styles")]
        );
        assert_eq!(
            forwards("export\n{\n  cardSz,\n} from './styles';"),
            [fwd("cardSz", "cardSz", "./styles")]
        );
    }

    #[test]
    fn barrel_with_namespace_re_exports_keeps_its_clauses() {
        assert_eq!(
            forwards("export { cardSz } from './styles';\nexport * as tokens from './tokens';\nexport * from './all';"),
            [fwd("cardSz", "cardSz", "./styles")]
        );
    }

    #[test]
    fn clause_after_a_type_only_clause_is_read() {
        assert_eq!(
            forwards("export type { T } from './types';\nexport { cardSz } from './styles';"),
            [fwd("cardSz", "cardSz", "./styles")]
        );
    }

    #[test]
    fn export_clause_gate_accepts_every_clause_spelling() {
        assert!(has_export_clause("export { a } from './x';"));
        assert!(has_export_clause("export/* c */{ a };"));
        assert!(has_export_clause("export // c\n{ a };"));
        assert!(has_export_clause("export\u{feff}{ a };"));
    }

    #[test]
    fn export_clause_gate_refuses_modules_that_cannot_forward() {
        assert!(!has_export_clause(
            "import { cardSz } from './styles';\nexport function Card() { return cardSz; }\nexport const x = 1;\nexport default Card;\n"
        ));
        assert!(!has_export_clause(
            "export * from './styles';\nexport * as ns from './more';\n"
        ));
        assert!(!has_export_clause("export /* never closed"));
        assert!(!has_export_clause(
            "export // trailing line comment with no newline"
        ));
        assert!(!has_export_clause("const exported = 1;"));
    }

    #[test]
    fn forwards_follow_statement_order_when_the_import_comes_last() {
        assert_eq!(
            forwards("export { b };\nexport { a } from './x';\nimport { b } from './y';"),
            [fwd("a", "a", "./x"), fwd("b", "b", "./y")]
        );
    }

    #[test]
    fn from_clause_at_the_edge_of_the_window_is_still_a_from_clause() {
        let source = format!(
            "import B from './b';\nexport {{ B }}{}from './b';",
            " ".repeat(57)
        );
        assert_eq!(forwards(&source), [fwd("B", "B", "./b")]);
    }

    #[test]
    fn from_clause_past_the_window_reads_as_a_local_binding() {
        let source = format!(
            "import B from './b';\nexport {{ B }}{}from './b';",
            " ".repeat(58)
        );
        assert_eq!(forwards(&source), [fwd("B", "default", "./b")]);
    }

    #[test]
    fn export_type_inside_a_longer_word_is_not_a_type_clause() {
        assert_eq!(
            forwards("import { Card } from './s';\nexport // see_export type\n{ Card };"),
            [fwd("Card", "Card", "./s")]
        );
        assert_eq!(
            forwards("import { Card } from './s';\nexport // seeexport type\n{ Card };"),
            [fwd("Card", "Card", "./s")]
        );
    }

    #[test]
    fn multibyte_text_at_either_window_edge_is_read_safely() {
        let after = format!(
            "import B from './b';\nexport {{ B }}{}\u{e9}\nconst x = 1;",
            " ".repeat(62)
        );
        assert_eq!(forwards(&after), [fwd("B", "default", "./b")]);
        let before = format!(
            "import {{ Card }} from './s';\n/*{}\u{e9}*/ export type {{ Card }};\nexport {{ Card as C }};",
            "x".repeat(40)
        );
        assert_eq!(forwards(&before), [fwd("C", "Card", "./s")]);
    }

    #[test]
    fn dynamic_import_of_an_interpolated_template_is_not_a_request() {
        assert!(
            css("const t = 'dark';\nconst l = () => import(`./themes/${t}.css`);\n").is_empty()
        );
        assert!(
            css("const suffix = '.js';\nconst l = () => import(`./fake.css${suffix}`);\n")
                .is_empty()
        );
        assert_eq!(
            css("const l = () => import(`./plain.css`);\n"),
            ["./plain.css"]
        );
    }

    #[test]
    fn stylesheet_request_gate_requires_module_syntax_beside_an_escape() {
        assert!(!may_request_stylesheet(r"const slash = '\\';"));
        assert!(!may_request_stylesheet("import './theme.js';"));
        assert!(may_request_stylesheet(r"import './theme\u002ecss';"));
        assert!(may_request_stylesheet("import './theme.css';"));
    }

    #[test]
    fn quoted_specifier_holding_dollar_brace_is_a_path() {
        assert_eq!(
            css("const l = () => import('./a${b}.css');\n"),
            ["./a${b}.css"]
        );
    }

    #[test]
    fn dynamic_import_of_an_expression_is_not_a_request() {
        assert!(css("const p = './a.css';\nconst l = () => import(p);\n").is_empty());
        assert!(css("const l = () => import(s.css + s);\n").is_empty());
    }

    #[test]
    fn css_imports_read_static_and_dynamic_requests() {
        let source = "import \"@workspace/ui/globals.css\";\nimport styles from \"./a.module.css\";\nimport url from \"./b.css?url\";\nimport inl from \"./c.css?inline\";\nimport raw from \"./d.css?raw\";\nconst lazy = () => import(\"@repo/ui/lazy.css\");\n";
        assert_eq!(
            css(source),
            [
                "@workspace/ui/globals.css",
                "./a.module.css",
                "./b.css?url",
                "./c.css?inline",
                "./d.css?raw",
                "@repo/ui/lazy.css",
            ]
        );
    }

    #[test]
    fn css_imports_ignore_text_that_is_not_an_import() {
        let source = "// import \"./line.css\";\n/* import \"./block.css\"; */\nconst tpl = `import \"./tpl.css\"`;\nexport const C = () => <div>{\"import './jsx.css'\"}</div>;\nconst cjs = require(\"./f.css\");\nconst glob = import.meta.glob(\"./s/*.css\");\nimport \"./theme.scss\";\n";
        assert!(css(source).is_empty());
    }

    #[test]
    fn css_imports_are_listed_once_in_source_order() {
        let source =
            "import \"./z.css\";\nimport \"./a.css\";\nconst again = () => import(\"./z.css\");\n";
        assert_eq!(css(source), ["./z.css", "./a.css"]);
    }

    #[test]
    fn css_imports_skip_a_type_only_request() {
        assert!(css("import type Sheet from \"./a.css\";\n").is_empty());
    }

    #[test]
    fn one_file_reports_both_link_kinds() {
        let result = links(
            "import \"./theme.css\";\nexport { cardSz } from './styles';\n",
            "/p/index.ts",
        );
        assert_eq!(result.css_imports, ["./theme.css"]);
        assert_eq!(result.forwards.len(), 1);
    }

    #[test]
    fn results_follow_input_order() {
        let files = [
            TransformFile {
                filename: "/p/a.ts".to_owned(),
                source: "import \"./a.css\";".to_owned(),
            },
            TransformFile {
                filename: "/p/b.ts".to_owned(),
                source: "const b = 1;".to_owned(),
            },
            TransformFile {
                filename: "/p/c.ts".to_owned(),
                source: "import \"./c.css\";".to_owned(),
            },
        ];
        let result = scan_module_links(&files, ModuleLinksQuery::default());
        assert_eq!(result[0].css_imports, ["./a.css"]);
        assert!(result[1].css_imports.is_empty());
        assert_eq!(result[2].css_imports, ["./c.css"]);
    }

    fn facts(source: &str, filename: &str) -> ModuleLinks {
        let files = [TransformFile {
            filename: filename.to_owned(),
            source: source.to_owned(),
        }];
        let query = ModuleLinksQuery {
            module_facts: true,
            style_texts: true,
            ..ModuleLinksQuery::default()
        };
        scan_module_links(&files, query).remove(0)
    }

    fn loads(source: &str) -> Vec<(String, Option<String>)> {
        facts(source, "/p/x.js")
            .loads
            .into_iter()
            .map(|load| (load.specifier, load.name))
            .collect()
    }

    #[test]
    fn module_syntax_reads_code_only() {
        // A statement in a comment, a string or a template is text; an
        // `import.meta` in a template substitution is code.
        let cases = [
            ("/*\nexport * from 'a';\n*/\nrequire('a');", false),
            ("const s = `\nexport const a = 1;\n`;", false),
            ("// import.meta.url\nmodule.exports = 1;", false),
            ("import('a').then(() => `${import.meta.url}`);", true),
            ("const r = /'/;\nexport const a = r;", true),
            ("export {};", true),
        ];
        for (source, esm) in cases {
            assert_eq!(facts(source, "/p/x.js").module_syntax, esm, "{source}");
        }
    }

    #[test]
    fn loads_name_what_each_form_reads() {
        assert_eq!(
            loads("import { szr as x, y } from 'r';\nimport d from 'r';\nimport * as ns from 'r';"),
            [
                ("r".to_owned(), Some("szr".to_owned())),
                ("r".to_owned(), Some("y".to_owned())),
                ("r".to_owned(), Some("default".to_owned())),
                ("r".to_owned(), None),
            ]
        );
        assert_eq!(
            loads("export { szr } from 'r';\nexport * from 'q';"),
            [
                ("r".to_owned(), Some("szr".to_owned())),
                ("q".to_owned(), None)
            ]
        );
        assert_eq!(
            loads("const a = require('r');\nimport('q');\nimport(name);\nrequire(name);"),
            [("r".to_owned(), None), ("q".to_owned(), None)]
        );
    }

    #[test]
    fn a_comment_or_string_loads_nothing() {
        assert!(
            loads("/* export * from 'r'; */\n// require('r')\nconst s = \"import('r')\";")
                .is_empty()
        );
    }

    #[test]
    fn style_css_is_every_string_inside_a_style_element() {
        let source = r#"export const A = () => <>
  <style>{/'/.test("'") && '[class~="pb-[2px]"] {}'}</style>
  <style>{/* author's */ '[class~="\x70b-2"] {}'}</style>
  <style dangerouslySetInnerHTML={{ __html: `.a { }` }} />
  <div title="[class~=x]" />
</>;"#;
        let links = facts(source, "/p/a.tsx");
        assert!(
            links
                .style_css
                .contains(&r#"[class~="pb-[2px]"] {}"#.to_owned()),
            "{:?}",
            links.style_css
        );
        assert!(
            links
                .style_css
                .contains(&r#"[class~="pb-2"] {}"#.to_owned()),
            "{:?}",
            links.style_css
        );
        assert!(
            links.style_css.contains(&".a { }".to_owned()),
            "{:?}",
            links.style_css
        );
        assert!(
            !links.style_css.iter().any(|css| css == "[class~=x]"),
            "{:?}",
            links.style_css
        );
        assert!(links.style_markup.is_empty());
    }

    #[test]
    fn style_css_includes_text_written_straight_inside_a_style_element() {
        let links = facts(
            "export const A = () => <><style>.pb-2 {'{}'}</style><b>.pb-3 </b></>;",
            "/p/a.tsx",
        );
        assert!(
            links.style_css.contains(&".pb-2 ".to_owned()),
            "{:?}",
            links.style_css
        );
        assert!(
            !links.style_css.iter().any(|css| css.contains("pb-3")),
            "{:?}",
            links.style_css
        );
    }

    #[test]
    fn a_template_with_no_substitution_names_a_load() {
        assert_eq!(
            loads("import(`q`);\nrequire(`r`);\nimport(`${q}`);\nrequire(`${r}`);"),
            [("q".to_owned(), None), ("r".to_owned(), None)]
        );
    }

    #[test]
    fn a_typescript_import_equals_require_is_a_load() {
        let links = facts(
            "import r = require('r');\nimport type t = require('t');\nimport n = N.m;",
            "/p/a.ts",
        );
        assert_eq!(
            links.loads,
            [ModuleLoad {
                specifier: "r".to_owned(),
                name: None,
            }]
        );
        assert!(!links.module_syntax);
    }

    #[test]
    fn a_source_the_parser_cannot_read_says_so() {
        assert!(facts("import type { A } from './a';", "/p/a.js").parse_failed);
        assert!(!facts("import type { A } from './a';", "/p/a.ts").parse_failed);
        assert!(!links("import type { A } from './a';", "/p/a.js").parse_failed);
    }

    #[test]
    fn a_type_only_import_or_export_loads_nothing() {
        let links = facts(
            "import type { szr } from 'r';\nimport { type szv } from 'v';\nexport type { szr } from 'r';\nexport type * from 'q';",
            "/p/a.ts",
        );
        assert!(links.loads.is_empty(), "{:?}", links.loads);
    }

    #[test]
    fn a_javascript_file_is_read_with_jsx_as_the_transform_reads_it() {
        let source = "import { szr } from '@csszyx/runtime';\nexport const A = () => <style>{'.a {}'}</style>;";
        for filename in ["/p/a.js", "/p/a.mjs", "/p/a.cjs"] {
            let links = facts(source, filename);
            assert_eq!(links.style_css, [".a {}"], "{filename}");
            assert_eq!(
                links.loads,
                [ModuleLoad {
                    specifier: "@csszyx/runtime".to_owned(),
                    name: Some("szr".to_owned()),
                }],
                "{filename}"
            );
        }
    }

    #[test]
    fn style_markup_is_a_string_outside_one_that_builds_a_style() {
        let links = facts("const page = '<STYLE>.a {}</STYLE>';", "/p/page.js");
        assert_eq!(links.style_markup, ["<STYLE>.a {}</STYLE>"]);
        assert!(links.style_css.is_empty());
    }

    #[test]
    fn style_texts_come_back_without_the_module_facts() {
        let files = [TransformFile {
            filename: "/p/a.tsx".to_owned(),
            source: "export const A = () => <style>{'.a {}'}</style>;\nconst page = '<style>.b {}</style>';"
                .to_owned(),
        }];
        let query = ModuleLinksQuery {
            style_texts: true,
            ..ModuleLinksQuery::default()
        };
        let links = scan_module_links(&files, query).remove(0);
        assert_eq!(links.style_css, [".a {}"]);
        assert_eq!(links.style_markup, ["<style>.b {}</style>"]);
        assert!(links.loads.is_empty());
    }

    #[test]
    fn style_texts_are_not_read_unless_asked_or_present() {
        let files = [TransformFile {
            filename: "/p/a.tsx".to_owned(),
            source: "export const A = () => <style>{'.a {}'}</style>;".to_owned(),
        }];
        let unasked = scan_module_links(&files, ModuleLinksQuery::default()).remove(0);
        assert!(unasked.style_css.is_empty());
        assert!(
            facts("export const A = () => <b>{'.a {}'}</b>;", "/p/a.tsx")
                .style_css
                .is_empty()
        );
    }

    fn entry_names(source: &str, query: ModuleLinksQuery) -> Vec<String> {
        let files = [TransformFile {
            filename: "/p/styles.ts".to_owned(),
            source: source.to_owned(),
        }];
        scan_module_links(&files, query)
            .remove(0)
            .registry_entries
            .into_iter()
            .map(|entry| entry.export_name)
            .collect()
    }

    const ASK_ENTRIES: ModuleLinksQuery = ModuleLinksQuery {
        registry_entries: true,
        module_facts: false,
        style_texts: false,
    };

    #[test]
    fn registry_entries_are_read_only_when_asked() {
        // A stylesheet or forward scan must not pay for the evaluation, and
        // its answer must not change shape because a module exports values.
        let source = "import './a.css';\nexport const card = { p: 4 };";
        assert!(entry_names(source, ModuleLinksQuery::default()).is_empty());
        assert_eq!(entry_names(source, ASK_ENTRIES), ["card"]);
    }

    #[test]
    fn registry_entries_parse_a_module_with_no_other_link() {
        // No `.css`, no `export {`: only the registry asks for this parse.
        assert_eq!(
            entry_names("export const card = { p: 4 };", ASK_ENTRIES),
            ["card"]
        );
    }

    #[test]
    fn a_module_without_export_text_is_not_parsed_for_entries() {
        assert!(entry_names("const card = { p: 4 };", ASK_ENTRIES).is_empty());
    }

    #[test]
    fn the_query_decodes_with_absent_fields_off() {
        let query: ModuleLinksQuery = serde_json::from_str("{}").expect("empty query decodes");
        assert_eq!(query, ModuleLinksQuery::default());
        let query: ModuleLinksQuery =
            serde_json::from_str(r#"{"registryEntries":true}"#).expect("query decodes");
        assert_eq!(query, ASK_ENTRIES);
    }
}
