//! The values a module exports for the bundler's cross-module registry: each
//! szv factory and static sz object an importer may compile against.
//!
//! The registry is only correct if an export qualifies exactly when the same
//! initializer would compile beside its use, so nothing here evaluates
//! anything: every initializer goes through the reader the file's own code
//! gets ([`super::parser::exported_static_value`]). What this module owns is
//! which bindings are exported, and under which name.

use std::collections::HashMap;

use oxc_ast::ast::{
    Declaration, ExportDefaultDeclaration, ExportNamedDeclaration, Expression, ModuleExportName,
    Program, Statement, VariableDeclaration, VariableDeclarationKind,
};
use serde::ser::{SerializeMap, Serializer};
use serde::Serialize;

use super::parser::{exported_static_value, is_reserved_szv_factory_name, ExportedStaticValue};
use super::scope::DeclaratorScope;
use super::{StaticSzObject, StaticSzValue};

/// What one recorded export is, because a consumer treats the two differently.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RegistryEntryKind {
    /// A variant table the importer compiles and picks from.
    SzvConfig,
    /// A value the importer lowers like the same literal written locally.
    SzObject,
}

/// One exported value an importing module may compile against.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryEntry {
    /// What the value is, and therefore how a consumer must treat it.
    pub kind: RegistryEntryKind,
    /// The name an importer writes: the exported name, `default` for the slot.
    pub export_name: String,
    /// The value, serialized as the plain object the registry carries.
    #[serde(serialize_with = "serialize_plain_object")]
    pub value: StaticSzObject,
}

/// The registry key a default export is filed under.
const DEFAULT_EXPORT_NAME: &str = "default";

/// A module-scope declarator, kept with whether it was declared `const`.
type ScopedInitializer<'p> = (Option<&'p Expression<'p>>, bool);

/// Every exported szv factory and static sz object, declaration order kept.
///
/// Both spellings of a named export are read — `export const X = …` and
/// `const X = …; export { X as Y }` — because they are one declaration and one
/// value. `export default <object>` needs no `const`: the slot has no name to
/// rebind. Type-only exports carry no value, and `export … from` names a
/// value in a module this read has not seen, so both are skipped.
pub fn registry_entries<'p>(program: &'p Program<'p>) -> Vec<RegistryEntry> {
    let scope = DeclaratorScope::from_program(program);
    let module_scope = module_scope_initializers(program);
    let read = |name: &str, (init, is_const): ScopedInitializer<'p>| {
        let value = exported_static_value(init?, is_const, &scope, program)?;
        Some(entry(name, value))
    };
    let mut entries = Vec::new();
    for statement in &program.body {
        match statement {
            Statement::ExportDefaultDeclaration(export) => {
                entries.extend(read(DEFAULT_EXPORT_NAME, default_initializer(export)));
            }
            Statement::ExportNamedDeclaration(export) if is_local_value_export(export) => {
                match &export.declaration {
                    Some(Declaration::VariableDeclaration(declaration)) => {
                        for (name, initializer) in declared_initializers(declaration) {
                            if !is_reserved_szv_factory_name(name) {
                                entries.extend(read(name, initializer));
                            }
                        }
                    }
                    Some(_) => {}
                    None => {
                        for (local, exported) in listed_names(export) {
                            if let Some(&initializer) = module_scope.get(local) {
                                entries.extend(read(exported, initializer));
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    entries
}

/// Tag one read value with the name an importer looks it up by.
fn entry(name: &str, value: ExportedStaticValue) -> RegistryEntry {
    let (kind, value) = match value {
        ExportedStaticValue::SzvConfig(value) => (RegistryEntryKind::SzvConfig, value),
        ExportedStaticValue::SzObject(value) => (RegistryEntryKind::SzObject, value),
    };
    RegistryEntry {
        kind,
        export_name: name.to_owned(),
        value,
    }
}

/// The expression a default export carries; a declaration has none to read.
fn default_initializer<'p>(export: &'p ExportDefaultDeclaration<'p>) -> ScopedInitializer<'p> {
    (export.declaration.as_expression(), true)
}

/// Whether a named export names values declared in this module.
fn is_local_value_export(export: &ExportNamedDeclaration<'_>) -> bool {
    !export.export_kind.is_type() && export.source.is_none()
}

/// Each identifier-bound declarator of one declaration, with its initializer.
fn declared_initializers<'p>(
    declaration: &'p VariableDeclaration<'p>,
) -> impl Iterator<Item = (&'p str, ScopedInitializer<'p>)> {
    let is_const = declaration.kind == VariableDeclarationKind::Const;
    declaration
        .declarations
        .iter()
        .filter_map(move |declarator| {
            let name = declarator.id.get_identifier_name()?;
            Some((name.as_str(), (declarator.init.as_ref(), is_const)))
        })
}

/// Every module-scope declarator by the name it binds, the last one winning.
///
/// An export list may sit either side of the bindings it names, so the whole
/// top level is indexed before any list is read. Block-scoped declarations are
/// left out: only a module-scope binding can be what `export { X }` refers to.
fn module_scope_initializers<'p>(
    program: &'p Program<'p>,
) -> HashMap<&'p str, ScopedInitializer<'p>> {
    let mut found = HashMap::new();
    for statement in &program.body {
        let declaration = match statement {
            Statement::VariableDeclaration(declaration) => declaration,
            Statement::ExportNamedDeclaration(export) => match &export.declaration {
                Some(Declaration::VariableDeclaration(declaration)) => declaration,
                _ => continue,
            },
            _ => continue,
        };
        found.extend(declared_initializers(declaration));
    }
    found
}

/// The local and exported names of each value clause in an export list.
///
/// A clause whose local name the runtime owns is skipped, as its declaration
/// form would be. A string export name is legal but is not a name an importer
/// of a token module writes, so it is skipped rather than recorded under a key
/// nobody asks for.
fn listed_names<'p>(
    export: &'p ExportNamedDeclaration<'p>,
) -> impl Iterator<Item = (&'p str, &'p str)> {
    export.specifiers.iter().filter_map(|specifier| {
        if specifier.export_kind.is_type() {
            return None;
        }
        let local = identifier_name(&specifier.local)?;
        let exported = identifier_name(&specifier.exported)?;
        (!is_reserved_szv_factory_name(local)).then_some((local, exported))
    })
}

/// The name of an identifier export name, or `None` for a string literal.
fn identifier_name<'p>(name: &'p ModuleExportName<'p>) -> Option<&'p str> {
    match name {
        ModuleExportName::IdentifierName(identifier) => Some(identifier.name.as_str()),
        ModuleExportName::IdentifierReference(identifier) => Some(identifier.name.as_str()),
        ModuleExportName::StringLiteral(_) => None,
    }
}

/// Serialize a static object as a plain JSON object, keys in source order.
///
/// The registry carries plain objects, and the importer reads their keys in
/// order, so the order is written out explicitly rather than left to a map
/// type that may sort it.
fn serialize_plain_object<S: Serializer>(
    object: &StaticSzObject,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    PlainObject(object).serialize(serializer)
}

/// A static object written as a plain JSON object.
struct PlainObject<'a>(&'a StaticSzObject);

impl Serialize for PlainObject<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.properties.len()))?;
        for property in &self.0.properties {
            map.serialize_entry(&property.key, &PlainValue(&property.value))?;
        }
        map.end()
    }
}

/// A static value written as the plain JSON value it stands for.
struct PlainValue<'a>(&'a StaticSzValue);

impl Serialize for PlainValue<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.0 {
            StaticSzValue::String(text) => serializer.serialize_str(text),
            StaticSzValue::Number(number) => serializer.serialize_f64(*number),
            StaticSzValue::Boolean(flag) => serializer.serialize_bool(*flag),
            StaticSzValue::Object(object) => PlainObject(object).serialize(serializer),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{registry_entries, RegistryEntry, RegistryEntryKind};
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    /// Read one module's entries through a real parse.
    fn entries(source: &str) -> Vec<RegistryEntry> {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, source, SourceType::tsx()).parse();
        registry_entries(&parsed.program)
    }

    /// Each entry as its name, kind and JSON value, encoded as the boundary
    /// encodes it. Read off the encoded text rather than a `serde_json::Value`,
    /// whose map would sort the keys this module is responsible for keeping.
    fn read(source: &str) -> Vec<(String, RegistryEntryKind, String)> {
        entries(source)
            .into_iter()
            .map(|entry| {
                let json = serde_json::to_string(&entry).expect("entry encodes");
                let value = json
                    .split_once(r#""value":"#)
                    .and_then(|(_, rest)| rest.strip_suffix('}'))
                    .expect("value is the last field")
                    .to_owned();
                (entry.export_name, entry.kind, value)
            })
            .collect()
    }

    fn object(name: &str, value: &str) -> (String, RegistryEntryKind, String) {
        (
            name.to_owned(),
            RegistryEntryKind::SzObject,
            value.to_owned(),
        )
    }

    fn names(source: &str) -> Vec<String> {
        entries(source)
            .into_iter()
            .map(|entry| entry.export_name)
            .collect()
    }

    #[test]
    fn an_exported_literal_object_is_recorded() {
        assert_eq!(
            read("export const card = { p: 4, rounded: 'lg' };"),
            [object("card", r#"{"p":4.0,"rounded":"lg"}"#)]
        );
    }

    #[test]
    fn values_resolve_through_the_local_evaluator() {
        // Every one of these lowers when written beside `sz={card}`, so each
        // must qualify across the module boundary too.
        let cases = [
            (
                "const S = 4;\nexport const card = { p: S };",
                r#"{"p":4.0}"#,
            ),
            ("export const card = { p: +4 };", r#"{"p":4.0}"#),
            ("export const card = { p: `4` };", r#"{"p":"4"}"#),
            ("export const card = { p: 4, m: null };", r#"{"p":4.0}"#),
            (
                "const base = { m: 2 };\nexport const card = { ...base, p: 4 };",
                r#"{"m":2.0,"p":4.0}"#,
            ),
            (
                "const SIZES = { md: 4 };\nexport const card = { p: SIZES.md };",
                r#"{"p":4.0}"#,
            ),
            (
                "export const card = { p: 4, hover: { bg: 'red-500', flex: true } } as const;",
                r#"{"p":4.0,"hover":{"bg":"red-500","flex":true}}"#,
            ),
        ];
        for (source, value) in cases {
            assert_eq!(read(source), [object("card", value)], "{source}");
        }
    }

    #[test]
    fn what_the_local_evaluator_refuses_is_refused() {
        for source in [
            "let S = 4;\nS = 8;\nexport const card = { p: S };",
            "export const card = { ...base, p: 4 };",
            "export const card = { p: [4] };",
            "export const card = build();",
            "export const card = 'p-4';",
            "const k = 'p';\nexport const card = { [k]: 4 };",
        ] {
            assert!(entries(source).is_empty(), "{source}");
        }
    }

    #[test]
    fn keys_keep_source_order() {
        assert_eq!(
            read("export const card = { z: 1, m: 2, p: 4 };"),
            [object("card", r#"{"z":1.0,"m":2.0,"p":4.0}"#)]
        );
    }

    #[test]
    fn every_declarator_of_one_export_is_read() {
        assert_eq!(
            names("export const a = { p: 4 }, b = { m: 2 }, { c } = d, e;"),
            ["a", "b"]
        );
    }

    #[test]
    fn a_let_object_is_refused_and_a_let_factory_is_not() {
        // The object kind needs `const`; the factory kind never did.
        let source = "import { szv } from '@csszyx/runtime';\n\
                      export let card = { p: 4 };\n\
                      export let table = szv({ base: { p: 4 } });";
        assert_eq!(
            read(source),
            [(
                "table".to_owned(),
                RegistryEntryKind::SzvConfig,
                r#"{"base":{"p":4.0}}"#.to_owned()
            )]
        );
    }

    #[test]
    fn a_factory_that_fails_qualification_is_not_read_as_an_object() {
        let source = "import { szv } from '@csszyx/runtime';\n\
                      const PAD = 4;\n\
                      export const a = szv({ base: { p: PAD } });\n\
                      export const b = szv(config);\n\
                      export const c = szv({ base: { p: 4 }, variants: { pad: { lg: { p: 8 } } } });";
        assert!(entries(source).is_empty());
    }

    #[test]
    fn names_the_runtime_owns_are_skipped() {
        assert!(entries("export const szr = { p: 4 };").is_empty());
        assert!(entries("const szr = { p: 4 };\nexport { szr as card };").is_empty());
    }

    #[test]
    fn non_variable_declarations_carry_no_entry() {
        assert!(entries("export function card() {}\nexport class Box {}").is_empty());
    }

    #[test]
    fn an_export_list_files_each_value_under_its_exported_name() {
        let source = "const a = { p: 4 };\n\
                      export { a, a as b, a as default, later };\n\
                      const later = { m: 2 };";
        assert_eq!(
            read(source),
            [
                object("a", r#"{"p":4.0}"#),
                object("b", r#"{"p":4.0}"#),
                object("default", r#"{"p":4.0}"#),
                object("later", r#"{"m":2.0}"#),
            ]
        );
    }

    #[test]
    fn an_export_list_reads_an_exported_declaration_too() {
        assert_eq!(
            names("export const a = { p: 4 };\nexport { a as b };"),
            ["a", "b"]
        );
    }

    #[test]
    fn an_export_list_refuses_what_it_cannot_answer_for() {
        for source in [
            "let a = { p: 4 };\nexport { a };",
            "import { a } from './other';\nexport { a };",
            "{ const a = { p: 4 }; }\nexport { a };",
            "const a = { p: 4 };\nexport { type a };",
            "const a = { p: 4 };\nexport type { a };",
            "const a = { p: 4 };\nexport { a as \"card-sz\" };",
            "const a = { p: 4 };\nexport { a } from './other';",
            "export * from './other';",
        ] {
            assert!(entries(source).is_empty(), "{source}");
        }
    }

    #[test]
    fn a_default_export_needs_an_object_or_a_factory() {
        assert_eq!(
            read("const S = 4;\nexport default { p: S };"),
            [object("default", r#"{"p":4.0}"#)]
        );
        assert_eq!(
            entries(
                "import { szv } from '@csszyx/runtime';\nexport default szv({ base: { p: 4 } });"
            )
            .into_iter()
            .map(|entry| entry.kind)
            .collect::<Vec<_>>(),
            [RegistryEntryKind::SzvConfig]
        );
        for source in [
            "const x = { p: 4 };\nexport default x;",
            "export default 'p-4';",
            "export default function card() {}",
        ] {
            assert!(entries(source).is_empty(), "{source}");
        }
    }
}
