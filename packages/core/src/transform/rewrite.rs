//! Native source rewrite helpers.
//!
//! The first rewrite slice is intentionally narrow: it only rewrites one static
//! `sz` attribute when the element has no static `class`/`className` collected
//! in the file. Existing class merging requires JSX-opening-element grouping,
//! so unsupported shapes stay read-only for now.

use string_wizard::{MagicString, UpdateOptions};

use super::{lower::lower_static_sz_object, SourceIr};

/// Reason a static IR cannot be rewritten by the current narrow slice.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StaticRewriteUnsupported {
    /// No static `sz` attribute was found.
    NoStaticSzAttribute,
    /// More than one static `sz` attribute was found.
    MultipleSzAttributes,
    /// Static class/className exists and needs element-level merge semantics.
    ExistingClassAttribute,
    /// Static `sz` lowered to no classes.
    EmptyClassList,
}

/// Rewrite a single static `sz` attribute into `className="..."`.
pub fn rewrite_single_static_sz(
    source: &str,
    ir: &SourceIr,
) -> Result<String, StaticRewriteUnsupported> {
    if !ir.class_attributes.is_empty() {
        return Err(StaticRewriteUnsupported::ExistingClassAttribute);
    }

    let [attribute] = ir.sz_attributes.as_slice() else {
        return if ir.sz_attributes.is_empty() {
            Err(StaticRewriteUnsupported::NoStaticSzAttribute)
        } else {
            Err(StaticRewriteUnsupported::MultipleSzAttributes)
        };
    };

    let classes = lower_static_sz_object(&attribute.object);
    if classes.is_empty() {
        return Err(StaticRewriteUnsupported::EmptyClassList);
    }

    let mut magic = MagicString::new(source);
    magic.update_with(
        attribute.attribute_span.start as usize,
        attribute.attribute_span.end as usize,
        format!("className=\"{}\"", classes.join(" ")),
        UpdateOptions {
            overwrite: true,
            ..UpdateOptions::default()
        },
    );

    Ok(magic.to_string())
}

#[cfg(test)]
mod tests {
    use super::{rewrite_single_static_sz, StaticRewriteUnsupported};
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
        let rewritten = rewrite_single_static_sz(source, &parse(source)).expect("rewritten");

        assert_eq!(
            rewritten,
            "export const App = () => <div className=\"inset-s-4 hover:bg-red-500\" />;"
        );
    }

    #[test]
    fn rejects_existing_class_attribute_until_element_grouping_lands() {
        let source = "export const App = () => <div className=\"block\" sz={{ p: 4 }} />;";

        assert_eq!(
            rewrite_single_static_sz(source, &parse(source)),
            Err(StaticRewriteUnsupported::ExistingClassAttribute)
        );
    }

    #[test]
    fn rejects_multiple_static_sz_attributes() {
        let source = "export const App = () => <div sz={{ p: 4 }} sz={{ m: 2 }} />;";

        assert_eq!(
            rewrite_single_static_sz(source, &parse(source)),
            Err(StaticRewriteUnsupported::MultipleSzAttributes)
        );
    }

    #[test]
    fn rejects_empty_class_list() {
        let source = "export const App = () => <div sz={{ bg: 'red-500/50' }} />;";

        assert_eq!(
            rewrite_single_static_sz(source, &parse(source)),
            Err(StaticRewriteUnsupported::EmptyClassList)
        );
    }
}
