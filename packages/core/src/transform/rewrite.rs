//! Native source rewrite helpers.
//!
//! This slice rewrites static `sz` attributes and merges static string
//! `class`/`className` attributes when parser IR proves they belong to the same
//! JSX opening element. Dynamic class expressions are not represented in this IR
//! and remain read-only until the semantic/runtime fallback path lands.

use string_wizard::{MagicString, UpdateOptions};

use super::{lower::lower_static_sz_object, SourceIr};

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
    ir: &SourceIr,
) -> Result<String, StaticRewriteUnsupported> {
    let mut magic = MagicString::new(source);
    let mut rewrote = false;

    for element in &ir.jsx_opening_elements {
        if element.sz_attribute_indices.is_empty() {
            continue;
        }

        let mut classes = Vec::new();
        for index in &element.sz_attribute_indices {
            let attribute = &ir.sz_attributes[*index];
            classes.extend(lower_static_sz_object(&attribute.object));
        }
        if classes.is_empty() {
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

    if !rewrote {
        return if ir.sz_attributes.is_empty() {
            Err(StaticRewriteUnsupported::NoStaticSzAttribute)
        } else {
            Err(StaticRewriteUnsupported::NoStaticOpeningElement)
        };
    }

    Ok(magic.to_string())
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

    #[test]
    fn rewrites_single_static_sz_attribute() {
        let source =
            "export const App = () => <div sz={{ start: 4, hover: { bg: 'red-500' } }} />;";
        let rewritten = rewrite_static_sz_attributes(source, &parse(source)).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"inset-s-4 hover:bg-red-500\" />;"
        );
    }

    #[test]
    fn merges_existing_static_class_attribute() {
        let source = "export const App = () => <div className=\"block\" sz={{ p: 4 }} />;";
        let rewritten = rewrite_static_sz_attributes(source, &parse(source)).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"block p-4\" />;"
        );
    }

    #[test]
    fn rewrites_multiple_grouped_static_sz_attributes() {
        let source = "export const App = () => <div sz={{ p: 4 }} sz={{ m: 2 }} />;";
        let rewritten = rewrite_static_sz_attributes(source, &parse(source)).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"p-4 m-2\" />;"
        );
    }

    #[test]
    fn rewrites_multiple_opening_elements_independently() {
        let source =
            "export const App = () => <><div sz={{ p: 4 }} /><span className=\"x\" sz={{ m: 2 }} /></>;";
        let rewritten = rewrite_static_sz_attributes(source, &parse(source)).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <><div className=\"p-4\" /><span className=\"x m-2\" /></>;"
        );
    }

    #[test]
    fn rejects_empty_class_list() {
        let source = "export const App = () => <div sz={{ bg: 'red-500/50' }} />;";

        assert_eq!(
            rewrite_static_sz_attributes(source, &parse(source)),
            Err(StaticRewriteUnsupported::EmptyClassList)
        );
    }
}
