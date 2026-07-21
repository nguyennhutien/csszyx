//! Global custom-property alias application for static sz IR.
//!
//! Phase H keeps this as an IR-level transform so class lowering and source
//! rewrite read the same aliased view of static `sz` values.

use std::collections::BTreeMap;

use super::{
    CssVariableMapEntry, GlobalVarAliasEntry, SourceIr, StaticSzObject, StaticSzValue,
    StaticTernaryIr,
};

/// Result of applying global variable aliases to source IR.
#[derive(Debug, Clone, PartialEq)]
pub struct GlobalVarAliasApplication {
    /// IR with exact static global custom-property values rewritten to aliases.
    pub ir: SourceIr,
    /// Original-to-alias metadata for values that were actually rewritten.
    pub variable_map: Vec<CssVariableMapEntry>,
}

/// Applies exact global custom-property aliases to static sz IR.
pub fn apply_global_var_aliases(
    ir: &SourceIr,
    aliases: &[GlobalVarAliasEntry],
) -> GlobalVarAliasApplication {
    let alias_map = normalize_aliases(aliases);
    if alias_map.is_empty() {
        return GlobalVarAliasApplication {
            ir: ir.clone(),
            variable_map: Vec::new(),
        };
    }

    let mut next = ir.clone();
    let mut variable_map = Vec::new();
    for attribute in &mut next.sz_attributes {
        rewrite_object(&mut attribute.object, &alias_map, &mut variable_map);
        for ternary in &mut attribute.ternaries {
            rewrite_ternary_classes(ternary, &alias_map, &mut variable_map);
        }
        for part in &mut attribute.array_parts {
            for class_name in &mut part.classes {
                rewrite_class_name(class_name, &alias_map, &mut variable_map);
            }
            if let Some(ternary) = &mut part.ternary {
                rewrite_ternary_classes(ternary, &alias_map, &mut variable_map);
            }
        }
    }

    GlobalVarAliasApplication {
        ir: next,
        variable_map,
    }
}

fn normalize_aliases(aliases: &[GlobalVarAliasEntry]) -> BTreeMap<String, String> {
    aliases
        .iter()
        .filter(|entry| entry.original.starts_with("--") && entry.alias.starts_with("--"))
        .map(|entry| (entry.original.clone(), entry.alias.clone()))
        .collect()
}

fn rewrite_object(
    object: &mut StaticSzObject,
    aliases: &BTreeMap<String, String>,
    variable_map: &mut Vec<CssVariableMapEntry>,
) {
    for property in &mut object.properties {
        rewrite_value(&mut property.value, aliases, variable_map);
    }
}

fn rewrite_value(
    value: &mut StaticSzValue,
    aliases: &BTreeMap<String, String>,
    variable_map: &mut Vec<CssVariableMapEntry>,
) {
    match value {
        StaticSzValue::String(current) => {
            if let Some(alias) = aliases.get(current.as_str()) {
                let original = std::mem::replace(current, alias.clone());
                push_variable_map(variable_map, original, alias.clone());
            }
        }
        StaticSzValue::Object(object) => rewrite_object(object, aliases, variable_map),
        StaticSzValue::Number(_) | StaticSzValue::Boolean(_) => {}
    }
}

fn rewrite_ternary_classes(
    ternary: &mut StaticTernaryIr,
    aliases: &BTreeMap<String, String>,
    variable_map: &mut Vec<CssVariableMapEntry>,
) {
    for class_name in &mut ternary.consequent_classes {
        rewrite_class_name(class_name, aliases, variable_map);
    }
    for class_name in &mut ternary.alternate_classes {
        rewrite_class_name(class_name, aliases, variable_map);
    }
}

fn rewrite_class_name(
    class_name: &mut String,
    aliases: &BTreeMap<String, String>,
    variable_map: &mut Vec<CssVariableMapEntry>,
) {
    for (original, alias) in aliases {
        if class_name.contains(original) {
            *class_name = class_name.replace(original, alias);
            push_variable_map(variable_map, original.clone(), alias.clone());
        }
    }
}

fn push_variable_map(
    variable_map: &mut Vec<CssVariableMapEntry>,
    original: String,
    mangled: String,
) {
    if variable_map
        .iter()
        .any(|entry| entry.original == original && entry.mangled == mangled)
    {
        return;
    }
    variable_map.push(CssVariableMapEntry { original, mangled });
}

#[cfg(test)]
mod tests {
    use super::apply_global_var_aliases;
    use crate::transform::{
        parser::parse_source_shell, GlobalVarAliasEntry, SourceIr, StaticSzObject,
        StaticSzProperty, StaticSzValue, SzAttributeIr, TextSpan, TransformFile,
    };

    #[test]
    fn rewrites_static_object_values_and_records_metadata() {
        let mut ir = SourceIr::empty("/repo/src/App.tsx".to_string(), 100);
        ir.sz_attributes.push(SzAttributeIr {
            attribute_span: TextSpan { start: 1, end: 10 },
            value_span: TextSpan { start: 4, end: 9 },
            object: StaticSzObject {
                properties: vec![StaticSzProperty {
                    key: "bg".to_string(),
                    span: TextSpan { start: 5, end: 8 },
                    value: StaticSzValue::String("--brand-primary".to_string()),
                }],
            },
            literal_class_name: None,
            rewrites_empty_class: false,
            ternaries: Vec::new(),
            array_parts: Vec::new(),
            runtime_fallback: false,
            runtime_fallback_spread: false,
            candidate_classes: Vec::new(),
            dynamic_css_vars: Vec::new(),
        });

        let result = apply_global_var_aliases(
            &ir,
            &[GlobalVarAliasEntry {
                original: "--brand-primary".to_string(),
                alias: "--g0".to_string(),
            }],
        );

        assert_eq!(
            result.ir.sz_attributes[0].object.properties[0].value,
            StaticSzValue::String("--g0".to_string())
        );
        assert_eq!(result.variable_map.len(), 1);
        assert_eq!(result.variable_map[0].original, "--brand-primary");
        assert_eq!(result.variable_map[0].mangled, "--g0");
    }

    #[test]
    fn rewrites_nested_array_and_ternary_aliases_without_duplicate_metadata() {
        let source = "const A=({on})=><div sz={[{bg:'--brand-primary'}, on ? {color:'--brand-primary'} : {borderColor:'--brand-secondary'}]}/>;";
        let ir = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        })
        .ir;

        let result = apply_global_var_aliases(
            &ir,
            &[
                GlobalVarAliasEntry {
                    original: "--brand-primary".to_string(),
                    alias: "--g0".to_string(),
                },
                GlobalVarAliasEntry {
                    original: "--brand-secondary".to_string(),
                    alias: "--g1".to_string(),
                },
            ],
        );
        let attribute = &result.ir.sz_attributes[0];
        let classes = attribute
            .array_parts
            .iter()
            .flat_map(|part| {
                part.classes
                    .iter()
                    .chain(part.ternary.iter().flat_map(|ternary| {
                        ternary
                            .consequent_classes
                            .iter()
                            .chain(ternary.alternate_classes.iter())
                    }))
            })
            .cloned()
            .collect::<Vec<_>>();

        assert!(classes
            .iter()
            .all(|class_name| !class_name.contains("--brand-")));
        assert!(classes.iter().any(|class_name| class_name.contains("--g0")));
        assert!(classes.iter().any(|class_name| class_name.contains("--g1")));
        assert_eq!(result.variable_map.len(), 2);
    }

    #[test]
    fn rewrites_nested_objects_and_property_ternary_classes() {
        let source = "const A=({on})=><div sz={{hover:{bg:'--brand-primary'},color:on?'--brand-primary':'--brand-secondary'}}/>;";
        let ir = parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        })
        .ir;

        let result = apply_global_var_aliases(
            &ir,
            &[
                GlobalVarAliasEntry {
                    original: "--brand-primary".to_string(),
                    alias: "--g0".to_string(),
                },
                GlobalVarAliasEntry {
                    original: "--brand-secondary".to_string(),
                    alias: "--g1".to_string(),
                },
            ],
        );
        let attribute = &result.ir.sz_attributes[0];

        let StaticSzValue::Object(nested) = &attribute.object.properties[0].value else {
            panic!("hover should remain a nested static object");
        };
        assert_eq!(
            nested.properties[0].value,
            StaticSzValue::String("--g0".to_string())
        );
        assert!(attribute.ternaries.iter().all(|ternary| {
            ternary
                .consequent_classes
                .iter()
                .chain(&ternary.alternate_classes)
                .all(|class_name| !class_name.contains("--brand-"))
        }));
        assert_eq!(result.variable_map.len(), 2);
    }

    #[test]
    fn ignores_invalid_aliases_and_preserves_non_string_static_values() {
        let mut ir = SourceIr::empty("/repo/src/App.tsx".to_string(), 100);
        ir.sz_attributes.push(SzAttributeIr {
            attribute_span: TextSpan { start: 1, end: 10 },
            value_span: TextSpan { start: 4, end: 9 },
            object: StaticSzObject {
                properties: vec![
                    StaticSzProperty {
                        key: "p".to_string(),
                        span: TextSpan { start: 5, end: 6 },
                        value: StaticSzValue::Number(4.0),
                    },
                    StaticSzProperty {
                        key: "truncate".to_string(),
                        span: TextSpan { start: 7, end: 8 },
                        value: StaticSzValue::Boolean(true),
                    },
                ],
            },
            literal_class_name: None,
            rewrites_empty_class: false,
            ternaries: Vec::new(),
            array_parts: Vec::new(),
            runtime_fallback: false,
            runtime_fallback_spread: false,
            candidate_classes: Vec::new(),
            dynamic_css_vars: Vec::new(),
        });

        let result = apply_global_var_aliases(
            &ir,
            &[
                GlobalVarAliasEntry {
                    original: "brand-primary".to_string(),
                    alias: "--g0".to_string(),
                },
                GlobalVarAliasEntry {
                    original: "--brand-primary".to_string(),
                    alias: "g0".to_string(),
                },
                GlobalVarAliasEntry {
                    original: "--unused".to_string(),
                    alias: "--g9".to_string(),
                },
            ],
        );

        assert_eq!(result.ir, ir);
        assert!(result.variable_map.is_empty());
    }
}
