//! Native source rewrite helpers.
//!
//! This slice rewrites static `sz` attributes and merges static string
//! `class`/`className` attributes when parser IR proves they belong to the same
//! JSX opening element.

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

            rewrite_static_sz_element(source, ir, element, &mut magic)?;
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

fn rewrite_static_sz_element(
    source: &str,
    ir: &SourceIr,
    element: &super::JsxOpeningElementIr,
    magic: &mut MagicString<'_>,
) -> Result<(), StaticRewriteUnsupported> {
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
        rewrite_static_sz_with_existing_class(source, ir, element, magic, class_index, &classes);
        return Ok(());
    }

    let Some((first_index, rest)) = element.sz_attribute_indices.split_first() else {
        return Ok(());
    };
    let first_attribute = &ir.sz_attributes[*first_index];
    overwrite_attribute(magic, first_attribute.attribute_span, &classes.join(" "));
    for index in rest {
        let attribute = &ir.sz_attributes[*index];
        magic.remove(
            whitespace_start(source, attribute.attribute_span.start as usize),
            attribute.attribute_span.end as usize,
        );
    }
    Ok(())
}

fn rewrite_static_sz_with_existing_class(
    source: &str,
    ir: &SourceIr,
    element: &super::JsxOpeningElementIr,
    magic: &mut MagicString<'_>,
    class_index: usize,
    classes: &[String],
) {
    let class_attribute = &ir.class_attributes[class_index];
    if class_attribute.expression_span.is_some() {
        let existing = class_merge_argument(source, class_attribute);
        let next = js_string_literal(&classes.join(" "));
        magic.update_with(
            class_attribute.attribute_span.start as usize,
            class_attribute.attribute_span.end as usize,
            format!("className={{_szMerge({existing}, {next})}}"),
            UpdateOptions {
                overwrite: true,
                ..UpdateOptions::default()
            },
        );
    } else {
        let existing_classes = class_attribute
            .value
            .split_whitespace()
            .filter(|class_name| !class_name.is_empty());
        let merged = existing_classes
            .chain(classes.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" ");
        overwrite_attribute(magic, class_attribute.attribute_span, &merged);
    }

    for index in &element.sz_attribute_indices {
        let attribute = &ir.sz_attributes[*index];
        magic.remove(
            whitespace_start(source, attribute.attribute_span.start as usize),
            attribute.attribute_span.end as usize,
        );
    }
}

/// Emit `className={cond ? "…" : "…"}` or merge it with an existing class.
///
/// Multiple `sz` attributes are still unsupported for ternary because the
/// runtime expression shape would need ordered merging across separate source
/// spans.
fn rewrite_ternary_sz_attribute(
    source: &str,
    ir: &SourceIr,
    element: &super::JsxOpeningElementIr,
    magic: &mut MagicString<'_>,
) -> Result<(), StaticRewriteUnsupported> {
    if element.sz_attribute_indices.len() != 1 {
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
    let ternary_source = format!("{test_source} ? \"{consequent}\" : \"{alternate}\"");
    if let Some(class_index) = element.class_attribute_index {
        let class_attribute = &ir.class_attributes[class_index];
        let existing = class_merge_argument(source, class_attribute);
        magic.update_with(
            class_attribute.attribute_span.start as usize,
            class_attribute.attribute_span.end as usize,
            format!("className={{_szMerge({existing}, {ternary_source})}}"),
            UpdateOptions {
                overwrite: true,
                ..UpdateOptions::default()
            },
        );
        magic.remove(
            whitespace_start(source, only_attribute.attribute_span.start as usize),
            only_attribute.attribute_span.end as usize,
        );
    } else {
        magic.update_with(
            only_attribute.attribute_span.start as usize,
            only_attribute.attribute_span.end as usize,
            format!("className={{{ternary_source}}}"),
            UpdateOptions {
                overwrite: true,
                ..UpdateOptions::default()
            },
        );
    }
    Ok(())
}

/// Emit a runtime fallback for a single `sz` attribute.
///
/// When there is no companion `className`/`class`, emit
/// `className={_sz(<original-source>)}`. When a companion exists, emit
/// `className={_szMerge(existing, _sz(<original-source>))}` and remove `sz`.
fn rewrite_runtime_fallback_sz_attribute(
    source: &str,
    ir: &SourceIr,
    element: &super::JsxOpeningElementIr,
    magic: &mut MagicString<'_>,
) -> Result<(), StaticRewriteUnsupported> {
    if element.sz_attribute_indices.len() != 1 {
        return Err(StaticRewriteUnsupported::EmptyClassList);
    }
    let only_attribute = &ir.sz_attributes[element.sz_attribute_indices[0]];
    debug_assert!(only_attribute.runtime_fallback);
    let expression_source =
        &source[only_attribute.value_span.start as usize..only_attribute.value_span.end as usize];

    if let Some(class_index) = element.class_attribute_index {
        let class_attribute = &ir.class_attributes[class_index];
        let existing = class_merge_argument(source, class_attribute);
        magic.update_with(
            class_attribute.attribute_span.start as usize,
            class_attribute.attribute_span.end as usize,
            format!("className={{_szMerge({existing}, _sz({expression_source}))}}"),
            UpdateOptions {
                overwrite: true,
                ..UpdateOptions::default()
            },
        );
        magic.remove(
            whitespace_start(source, only_attribute.attribute_span.start as usize),
            only_attribute.attribute_span.end as usize,
        );
    } else {
        magic.update_with(
            only_attribute.attribute_span.start as usize,
            only_attribute.attribute_span.end as usize,
            format!("className={{_sz({expression_source})}}"),
            UpdateOptions {
                overwrite: true,
                ..UpdateOptions::default()
            },
        );
    }
    Ok(())
}

fn js_string_literal(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

fn class_merge_argument(source: &str, class_attribute: &super::ClassAttributeIr) -> String {
    class_attribute.expression_span.map_or_else(
        || js_string_literal(&class_attribute.value),
        |span| source[span.start as usize..span.end as usize].to_string(),
    )
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
    fn merges_existing_dynamic_class_attribute() {
        let source = "export const App = () => <div className={getClass()} sz={{ p: 4 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className={_szMerge(getClass(), \"p-4\")} />;"
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
    fn rewrites_runtime_fallback_with_static_classname_to_merge_helper() {
        let source = "const X = ({ big }) => <div className=\"existing\" sz={{ ...(big ? { p: 8 } : {}) }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const X = ({ big }) => <div className={_szMerge(\"existing\", _sz({ ...(big ? { p: 8 } : {}) }))} />;"
        );
    }

    #[test]
    fn rewrites_runtime_fallback_with_static_class_to_merge_helper() {
        let source = "const X = ({ styles }) => <div class=\"existing\" sz={styles} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const X = ({ styles }) => <div className={_szMerge(\"existing\", _sz(styles))} />;"
        );
    }

    #[test]
    fn rewrites_runtime_fallback_with_dynamic_classname_to_merge_helper() {
        let source = "const X = ({ styles }) => <div className={getClass()} sz={styles} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const X = ({ styles }) => <div className={_szMerge(getClass(), _sz(styles))} />;"
        );
    }

    #[test]
    fn rewrites_static_ternary_with_classname_to_merge_helper() {
        let source = "const X = ({ active }) => <div className=\"existing\" sz={active ? { p: 4 } : { p: 8 }} />;";
        let rewritten = rewrite(source).expect("rewritten");

        assert_eq!(
            rewritten,
            "const X = ({ active }) => <div className={_szMerge(\"existing\", active ? \"p-4\" : \"p-8\")} />;"
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
