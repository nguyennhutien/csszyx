//! The Rust side of `csszyx migrate`.
//!
//! `migrate` turns Tailwind class strings into sz objects. This is the only
//! implementation: the TypeScript one it was ported from is gone, and what
//! that port established is kept as a recorded golden in
//! `tests/migrate_parity.rs`, which replays every class the goldens and
//! corpora contain and still expects the answers agreed at the time.
//!
//! The tables are generated from the authored TypeScript data in
//! `packages/compiler/src/migrate-tables` — the reverse of the compiler's own
//! `PROPERTY_MAP`, which lives beside it. What lives here is the logic: how a
//! class splits into prefix and value, and how a value's shape decides which
//! of a shared prefix's keys it belongs to.

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
