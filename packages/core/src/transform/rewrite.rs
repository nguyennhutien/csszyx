//! Native source rewrite helpers.
//!
//! This slice rewrites static `sz` attributes and merges static string
//! `class`/`className` attributes when parser IR proves they belong to the same
//! JSX opening element. Dynamic class expressions are not represented in this IR
//! and remain read-only until the semantic/runtime fallback path lands.

use string_wizard::{MagicString, UpdateOptions};

use super::{
    lower::lower_sz_attribute_classes,
    recovery::{generate_inline_recovery_token, offset_to_line_column},
    SourceIr,
};

/// Reason a static IR cannot be rewritten by the current narrow slice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StaticRewriteUnsupported {
    /// No static `sz` attribute was found.
    NoStaticSzAttribute,
    /// No JSX opening element group can be rewritten safely.
    NoStaticOpeningElement,
    /// Static `sz` lowered to no classes.
    EmptyClassList,
}

/// Rewrite static `sz` attributes into `className="..."`.
pub fn rewrite_static_sz_attributes(
    source: &str,
    filename: &str,
    ir: &SourceIr,
) -> Result<String, StaticRewriteUnsupported> {
    let mut magic = MagicString::new(source);
    let mut rewrote = false;

    for element in &ir.jsx_opening_elements {
        if let Some(recovery_index) = element.recovery_attribute_index {
            if !element.has_recovery_token_attribute {
                if let Some(last_attribute_end) = element.last_attribute_end {
                    let recovery = &ir.recovery_attributes[recovery_index];
                    let (line, column) =
                        offset_to_line_column(source, recovery.attribute_span.start);
                    let token = generate_inline_recovery_token(
                        filename,
                        line,
                        column,
                        &element.element_name,
                    );
                    magic.append_right(
                        last_attribute_end as usize,
                        format!(" data-sz-recovery-token=\"{token}\""),
                    );
                    rewrote = true;
                }
            }
        }

        if !element.sz_attribute_indices.is_empty() {
            let has_ternary = element
                .sz_attribute_indices
                .iter()
                .any(|index| ir.sz_attributes[*index].ternary.is_some());

            if has_ternary {
                rewrite_ternary_sz_attribute(source, ir, element, &mut magic)?;
                rewrote = true;
                continue;
            }

            let has_runtime_fallback = element
                .sz_attribute_indices
                .iter()
                .any(|index| ir.sz_attributes[*index].runtime_fallback);

            if has_runtime_fallback {
                rewrite_runtime_fallback_sz_attribute(source, ir, element, &mut magic)?;
                rewrote = true;
                continue;
            }

            let mut classes = Vec::new();
            let mut rewrites_empty_class = false;
            for index in &element.sz_attribute_indices {
                let attribute = &ir.sz_attributes[*index];
                classes.extend(lower_sz_attribute_classes(attribute));
                rewrites_empty_class |= attribute.rewrites_empty_class;
            }
            if classes.is_empty() && !rewrites_empty_class {
                return Err(StaticRewriteUnsupported::EmptyClassList);
            }

            if let Some(class_index) = element.class_attribute_index {
                let class_attribute = &ir.class_attributes[class_index];
                let existing_classes = class_attribute
                    .value
                    .split_whitespace()
                    .filter(|class_name| !class_name.is_empty());
                let merged = existing_classes
                    .chain(classes.iter().map(String::as_str))
                    .collect::<Vec<_>>()
                    .join(" ");
                overwrite_attribute(&mut magic, class_attribute.attribute_span, &merged);
                for index in &element.sz_attribute_indices {
                    let attribute = &ir.sz_attributes[*index];
                    magic.remove(
                        whitespace_start(source, attribute.attribute_span.start as usize),
                        attribute.attribute_span.end as usize,
                    );
                }
            } else {
                let Some((first_index, rest)) = element.sz_attribute_indices.split_first() else {
                    continue;
                };
                let first_attribute = &ir.sz_attributes[*first_index];
                overwrite_attribute(
                    &mut magic,
                    first_attribute.attribute_span,
                    &classes.join(" "),
                );
                for index in rest {
                    let attribute = &ir.sz_attributes[*index];
                    magic.remove(
                        whitespace_start(source, attribute.attribute_span.start as usize),
                        attribute.attribute_span.end as usize,
                    );
                }
            }

            rewrote = true;
        }
    }

    if !rewrote {
        return if ir.sz_attributes.is_empty() {
            Err(StaticRewriteUnsupported::NoStaticSzAttribute)
        } else {
            Err(StaticRewriteUnsupported::NoStaticOpeningElement)
        };
    }

    Ok(magic.to_string())
}

/// Emit `className={cond ? "…" : "…"}` for a single ternary `sz` attribute.
///
/// The only supported shape is exactly one `sz={cond ? A : B}` with no
/// companion `className`/`class` on the same element — anything more
/// elaborate would need a `_sz(...)` runtime merge call which is not wired
/// in this slice. Returns `Err(EmptyClassList)` to fail-closed (leave source
/// untouched) for those combinations instead of silently joining both
/// branches' classes into one className.
fn rewrite_ternary_sz_attribute(
    source: &str,
    ir: &SourceIr,
    element: &super::JsxOpeningElementIr,
    magic: &mut MagicString<'_>,
) -> Result<(), StaticRewriteUnsupported> {
    if element.sz_attribute_indices.len() != 1 || element.class_attribute_index.is_some() {
        return Err(StaticRewriteUnsupported::EmptyClassList);
    }
    let only_attribute = &ir.sz_attributes[element.sz_attribute_indices[0]];
    let ternary = only_attribute
        .ternary
        .as_ref()
        .expect("ternary presence already verified by caller");
    let test_source = &source[ternary.test_span.start as usize..ternary.test_span.end as usize];
    let consequent = ternary.consequent_classes.join(" ");
    let alternate = ternary.alternate_classes.join(" ");
    let replacement = format!("className={{{test_source} ? \"{consequent}\" : \"{alternate}\"}}");
    magic.update_with(
        only_attribute.attribute_span.start as usize,
        only_attribute.attribute_span.end as usize,
        replacement,
        UpdateOptions {
            overwrite: true,
            ..UpdateOptions::default()
        },
    );
    Ok(())
}

/// Emit `className={_sz(<original-source>)}` for a single runtime-fallback
/// `sz` attribute.
///
/// Only the simple case is supported in this slice — exactly one `sz`
/// attribute on the element and no companion `className`/`class`.
/// Combinations involving an existing `className` need an `_szMerge(...)`
/// path (oxc-JS today raises `D2.5+` not-implemented in the same shape),
/// so we fail-closed to keep source unchanged rather than silently dropping
/// either side. Downstream consumers see `metadata.uses_runtime = true`
/// and inject the helper import.
fn rewrite_runtime_fallback_sz_attribute(
    source: &str,
    ir: &SourceIr,
    element: &super::JsxOpeningElementIr,
    magic: &mut MagicString<'_>,
) -> Result<(), StaticRewriteUnsupported> {
    if element.sz_attribute_indices.len() != 1 || element.class_attribute_index.is_some() {
        return Err(StaticRewriteUnsupported::EmptyClassList);
    }
    let only_attribute = &ir.sz_attributes[element.sz_attribute_indices[0]];
    debug_assert!(only_attribute.runtime_fallback);
    let expression_source =
        &source[only_attribute.value_span.start as usize..only_attribute.value_span.end as usize];
    let replacement = format!("className={{_sz({expression_source})}}");
    magic.update_with(
        only_attribute.attribute_span.start as usize,
        only_attribute.attribute_span.end as usize,
        replacement,
        UpdateOptions {
            overwrite: true,
            ..UpdateOptions::default()
        },
    );
    Ok(())
}

fn overwrite_attribute(magic: &mut MagicString<'_>, span: super::TextSpan, class_name: &str) {
    magic.update_with(
        span.start as usize,
        span.end as usize,
        format!("className=\"{class_name}\""),
        UpdateOptions {
            overwrite: true,
            ..UpdateOptions::default()
        },
    );
}

fn whitespace_start(source: &str, attr_start: usize) -> usize {
    let mut index = attr_start;
    while index > 0 && source.as_bytes()[index - 1].is_ascii_whitespace() {
        index -= 1;
    }
    index
}

#[cfg(test)]
mod tests {
    use super::{rewrite_static_sz_attributes, StaticRewriteUnsupported};
    use crate::transform::{parser::parse_source_shell, TransformFile};

    fn parse(source: &str) -> crate::transform::SourceIr {
        parse_source_shell(&TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: source.to_string(),
        })
        .ir
    }

    fn rewrite(source: &str) -> Result<String, StaticRewriteUnsupported> {
        rewrite_static_sz_attributes(source, "/repo/src/App.tsx", &parse(source))
    }

    #[test]
    fn rewrites_single_static_sz_attribute() {
        let source =
            "export const App = () => <div sz={{ start: 4, hover: { bg: 'red-500' } }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"inset-s-4 hover:bg-red-500\" />;"
        );
    }

    #[test]
    fn merges_existing_static_class_attribute() {
        let source = "export const App = () => <div className=\"block\" sz={{ p: 4 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"block p-4\" />;"
        );
    }

    #[test]
    fn rewrites_multiple_grouped_static_sz_attributes() {
        let source = "export const App = () => <div sz={{ p: 4 }} sz={{ m: 2 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"p-4 m-2\" />;"
        );
    }

    #[test]
    fn rewrites_multiple_opening_elements_independently() {
        let source =
            "export const App = () => <><div sz={{ p: 4 }} /><span className=\"x\" sz={{ m: 2 }} /></>;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <><div className=\"p-4\" /><span className=\"x m-2\" /></>;"
        );
    }

    #[test]
    fn rewrites_static_string_sz_attribute() {
        let source = "export const App = () => <div sz=\"p-4 bg-blue-500\" />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"p-4 bg-blue-500\" />;"
        );
    }

    #[test]
    fn rewrites_static_array_sz_attribute() {
        let source =
            "export const App = () => <div sz={[{ flex: true }, false, null, { p: 4 }]} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"flex p-4\" />;"
        );
    }

    #[test]
    fn skips_null_and_undefined_static_object_values() {
        let source = "export const App = () => <div sz={{ p: 4, gap: null, m: undefined }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"p-4\" />;"
        );
    }

    #[test]
    fn rewrites_static_object_literal_spreads() {
        let source = "export const App = () => <div sz={{ ...{ p: 4 }, m: 2 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"p-4 m-2\" />;"
        );
    }

    #[test]
    fn rewrites_identifier_backed_spread() {
        // `{ ...BASE, m: 2 }` resolves BASE through the declarator scope
        // and flattens its initializer's properties in source order before
        // the trailing literal property. This locks in the contract that
        // identifier-backed spreads do not need a runtime helper as long
        // as every referenced binding resolves to a fully static object.
        let source = "const BASE = { p: 4 } as const;\nexport const App = () => <div sz={{ ...BASE, m: 2 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const BASE = { p: 4 } as const;\nexport const App = () => <div className=\"p-4 m-2\" />;"
        );
    }

    #[test]
    fn rewrites_identifier_spread_only() {
        let source = "const BASE = { p: 4, m: 2 } as const;\nexport const App = () => <div sz={{ ...BASE }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const BASE = { p: 4, m: 2 } as const;\nexport const App = () => <div className=\"p-4 m-2\" />;"
        );
    }

    #[test]
    fn rewrites_empty_static_array_sz_attribute() {
        let source = "export const App = () => <div sz={[false, null, undefined]} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"\" />;"
        );
    }

    #[test]
    fn rewrites_typescript_wrapped_static_sz_attribute() {
        let source = "export const App = () => <div sz={{ p: 4 } as const} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"p-4\" />;"
        );
    }

    #[test]
    fn rewrites_typescript_wrapped_static_property_values() {
        let source =
            "export const App = () => <div sz={{ p: (4 as const), m: (2 satisfies number) }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"p-4 m-2\" />;"
        );
    }

    #[test]
    fn appends_static_recovery_token_attribute() {
        let source = "export const App = () => <div szRecover=\"csr\">x</div>;";
        let rewritten = rewrite(source).expect("rewritten");

        assert!(rewritten.contains("szRecover=\"csr\" data-sz-recovery-token=\""));
        assert_eq!(rewritten.matches("data-sz-recovery-token").count(), 1);
    }

    #[test]
    fn appends_recovery_token_after_last_attribute_before_sz_rewrite() {
        let source = "export const App = () => <div szRecover=\"csr\" sz={{ p: 4 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert!(rewritten.contains("szRecover=\"csr\" className=\"p-4\" data-sz-recovery-token=\""));
        assert_eq!(rewritten.matches("data-sz-recovery-token").count(), 1);
    }

    #[test]
    fn skips_recovery_token_when_already_tagged() {
        let source =
            "export const App = () => <div szRecover=\"csr\" data-sz-recovery-token=\"abc\">x</div>;";

        assert_eq!(
            rewrite(source),
            Err(StaticRewriteUnsupported::NoStaticSzAttribute)
        );
    }

    #[test]
    fn rewrites_static_ternary_sz_attribute() {
        let source = "const X = ({ active }) => <div sz={active ? { p: 4 } : { p: 8 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const X = ({ active }) => <div className={active ? \"p-4\" : \"p-8\"} />;"
        );
    }

    #[test]
    fn rewrites_function_body_local_static_ternary() {
        let source = "const X = ({ active }) => {\n  const ON = { p: 4 } as const;\n  const OFF = { p: 8 } as const;\n  return <div sz={active ? ON : OFF} />;\n};";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const X = ({ active }) => {\n  const ON = { p: 4 } as const;\n  const OFF = { p: 8 } as const;\n  return <div className={active ? \"p-4\" : \"p-8\"} />;\n};"
        );
    }

    #[test]
    fn rewrites_conditional_spread_to_runtime_helper() {
        // Mixing an identifier-backed spread with a conditional spread
        // cannot be fully resolved at compile time without enumerating
        // every reachable class set, so the rewriter punts to the runtime
        // `_sz(...)` helper with the user's exact source preserved.
        let source = "const BASE = { p: 4 } as const;\nconst X = ({ big }) => <div sz={{ ...BASE, ...(big ? { p: 8 } : {}) }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const BASE = { p: 4 } as const;\nconst X = ({ big }) => <div className={_sz({ ...BASE, ...(big ? { p: 8 } : {}) })} />;"
        );
    }

    #[test]
    fn rewrites_dynamic_identifier_to_runtime_helper() {
        let source = "const X = ({ styles }) => <div sz={styles} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const X = ({ styles }) => <div className={_sz(styles)} />;"
        );
    }

    #[test]
    fn runtime_fallback_falls_through_when_paired_with_classname() {
        let source = "const X = ({ big }) => <div className=\"existing\" sz={{ ...(big ? { p: 8 } : {}) }} />;";

        assert_eq!(
            rewrite(source),
            Err(StaticRewriteUnsupported::EmptyClassList)
        );
    }

    #[test]
    fn ternary_falls_through_when_paired_with_classname() {
        // Ternary + sibling className currently has no runtime merge wired up.
        // The rewriter must not emit a partial transform — leave the file
        // unchanged through the empty-class-list error so the engine reports
        // it the same way it does for any other unsupported combination.
        let source = "const X = ({ active }) => <div className=\"existing\" sz={active ? { p: 4 } : { p: 8 }} />;";

        assert_eq!(
            rewrite(source),
            Err(StaticRewriteUnsupported::EmptyClassList)
        );
    }

    #[test]
    fn rejects_empty_class_list() {
        let source = "export const App = () => <div sz={{ bg: 'red-500/50' }} />;";

        assert_eq!(
            rewrite(source),
            Err(StaticRewriteUnsupported::EmptyClassList)
        );
    }
}
