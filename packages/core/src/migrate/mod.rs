//! The Rust side of `csszyx migrate`.
//!
//! `migrate` turns Tailwind class strings into sz objects. The TypeScript in
//! `packages/cli/src/migrate` is still the shipped implementation; this module
//! is its port, held to the same answers by `tests/migrate_parity.rs`, which
//! replays every class the goldens and corpora contain through both.
//!
//! The tables the port reads are generated from the TypeScript
//! (`transform::generated::{reverse_tables, migrate_tables}`), so the two
//! sides cannot disagree on data. What lives here is the logic: how a class
//! splits into prefix and value, and how a value's shape decides which of a
//! shared prefix's keys it belongs to.

mod class_parser;
mod class_rules;
mod dynamic;
mod html;
mod json;
mod line_endings;
mod normalize;
mod source;
mod sz_codegen;
mod value;
mod variant_parser;

pub use class_parser::parse_class;
pub use dynamic::{is_clsx_like_name, PatternResult, CLSX_LIKE_NAMES};
pub use html::{transform_html_source, HtmlTransformOptions, InjectRuntime};
pub use json::{migrate_class_name, migrate_parse_class};
pub use line_endings::{detect_line_ending, with_line_ending};
pub use source::{transform_source, TransformOptions, TransformResult, TransformStats};
pub use sz_codegen::{sz_expression, sz_html_value, sz_object_literal};
pub use value::{Extra, ParsedClass, SzObject, SzValue};
pub use variant_parser::{
    class_name_to_sz_object, extract_variants, map_variant, tokenize, Conversion,
};
