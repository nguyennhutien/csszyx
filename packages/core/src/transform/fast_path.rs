use super::{
    JsxOpeningElementIr, SourceIr, StaticSzObject, StaticSzProperty, StaticSzValue, SzAttributeIr,
    TextSpan, TransformFile,
};

/// Conservative parser triage result for a source file.
#[derive(Debug, Clone, PartialEq)]
pub enum FastPathTriage {
    /// The file cannot affect csszyx transform output and can skip parsing.
    Noop(SourceIr),
    /// The file contains only AST-free static `sz={{ ... }}` attributes.
    StaticIr(SourceIr),
    /// The file contains a possible csszyx marker and must use the parser path.
    NeedsParser(FastPathBailout),
}

/// Reason a source file could not use the AST-free path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FastPathBailout {
    /// Source filename.
    pub filename: String,
    /// Conservative reason.
    pub reason: FastPathBailoutReason,
}

/// Conservative fast-path bailout reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FastPathBailoutReason {
    /// Source contains the `sz` marker somewhere. It may be a prop, local name,
    /// comment, or string; the parser owns that distinction.
    ContainsSzMarker,
}

/// Call-expression markers whose classes are collected by the full parser's
/// `collect_catalog_call_classes` (szv catalog, szr static args, dynamic
/// runtime injection). A file containing any of these cannot take the AST-free
/// static path, which only sees JSX `sz=` attributes. Keep in sync with the
/// callee names matched in `collect_catalog_call_classes`.
const CATALOG_CALL_MARKERS: [&str; 3] = ["szv(", "szr(", "dynamic("];

/// Triage a source file before invoking a parser.
///
/// This accepts two zero-risk paths:
/// - no `sz` marker: skip parsing entirely;
/// - simple JSX `sz={{ key: literal }}` attributes: build parser-neutral IR
///   directly and reuse the normal lower/rewrite pipeline.
///
/// Everything else falls through to the parser, including comments, strings,
/// nested objects, spreads, existing class/className attributes, and recovery
/// attributes.
pub fn triage_source(file: &TransformFile) -> FastPathTriage {
    if !file.source.contains("sz") {
        let source_len = u32::try_from(file.source.len()).unwrap_or(u32::MAX);
        return FastPathTriage::Noop(SourceIr::empty(file.filename.clone(), source_len));
    }

    // Calls that contribute classes to the safelist WITHOUT being a JSX `sz=`
    // attribute force the full parser: the AST-free `try_static_sz_ir` only walks
    // `sz={{ … }}` attributes, so a file that ALSO defines an `szv` catalog, an
    // `szr(static-object)`, or a `dynamic(...)` call would keep its static `sz`
    // classes but silently drop those extras — the exact classes the removed JavaScript lanes
    // collect via `collect_catalog_call_classes`. A file with both a plain
    // `sz={{ p: 4 }}` and a `szv({...})` used to fast-path here and lose the whole
    // szv catalog under `rust` while `oxc`/`babel` kept it (a parser-flip safelist
    // divergence, field-reported). The substring test is intentionally
    // conservative — a false positive only costs one file the slower parser path.
    if CATALOG_CALL_MARKERS
        .iter()
        .any(|marker| file.source.contains(marker))
    {
        return FastPathTriage::NeedsParser(FastPathBailout {
            filename: file.filename.clone(),
            reason: FastPathBailoutReason::ContainsSzMarker,
        });
    }

    // A component `szs=` slot attribute is rewritten to a compiled `szsc=`
    // prop by the parser lanes; the AST-free path only walks `sz={{ … }}`
    // attributes and cannot perform that rewrite. The element-wise guard in
    // `try_static_sz_ir` only inspects openings that contain `sz={{`, so an
    // `szs` on a SIBLING element was invisible to it: the file fast-pathed on
    // the sibling's `sz` alone and shipped the raw `szs` prop, silently
    // dropping the slot override (field-reported — the parser lanes always
    // rewrite it). Bail file-wide like the catalog markers above; the
    // substring test does not match an already-compiled `szsc=` prop.
    if file.source.contains("szs=") {
        return FastPathTriage::NeedsParser(FastPathBailout {
            filename: file.filename.clone(),
            reason: FastPathBailoutReason::ContainsSzMarker,
        });
    }

    // An `sz=` occurrence inside a comment or string literal must never build
    // static IR: the textual scan below cannot tell it from a real attribute,
    // so `// <Box sz={{ mb: 10 }} />` used to ship the commented-out classes
    // into the build (field-reported — the removed JavaScript lanes parse and ignore comments).
    // A `None` from the lexer means it hit something it cannot classify
    // (e.g. a JSX-text apostrophe opening a bogus string); both cases take the
    // parser path, which owns the real distinction.
    match non_code_ranges(&file.source) {
        Some(ranges) if !any_sz_marker_in_ranges(&file.source, &ranges) => {}
        _ => {
            return FastPathTriage::NeedsParser(FastPathBailout {
                filename: file.filename.clone(),
                reason: FastPathBailoutReason::ContainsSzMarker,
            });
        }
    }

    if let Some(ir) = try_static_sz_ir(file) {
        return FastPathTriage::StaticIr(ir);
    }

    FastPathTriage::NeedsParser(FastPathBailout {
        filename: file.filename.clone(),
        reason: FastPathBailoutReason::ContainsSzMarker,
    })
}

/// Byte ranges of comment bodies and string/template literals, found by a
/// conservative linear lexer. Returns `None` on anything ambiguous — an
/// unterminated `'`/`"` string reaching a newline (usually an apostrophe in
/// JSX text) or an unterminated template/block construct — so the caller
/// bails to the full parser instead of guessing.
///
/// The lexer intentionally errs toward over-classifying: a `//` inside a
/// regex character class reads as a line comment here. That is safe by
/// construction — the ranges are only ever used to REJECT the fast path, so
/// a misread costs one file the slower parser lane, never a wrong transform.
fn non_code_ranges(source: &str) -> Option<Vec<(usize, usize)>> {
    let bytes = source.as_bytes();
    let mut ranges = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'/' if bytes.get(i + 1) == Some(&b'/') => {
                let start = i;
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
                ranges.push((start, i));
            }
            b'/' if bytes.get(i + 1) == Some(&b'*') => {
                let start = i;
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                if i + 1 >= bytes.len() {
                    return None;
                }
                i += 2;
                ranges.push((start, i));
            }
            quote @ (b'\'' | b'"') => {
                let start = i;
                i += 1;
                loop {
                    match bytes.get(i) {
                        None | Some(b'\n') => return None,
                        Some(b'\\') => i += 2,
                        Some(byte) if *byte == quote => {
                            i += 1;
                            break;
                        }
                        Some(_) => i += 1,
                    }
                }
                ranges.push((start, i));
            }
            b'`' => {
                let start = i;
                i += 1;
                loop {
                    match bytes.get(i) {
                        None => return None,
                        Some(b'\\') => i += 2,
                        Some(b'`') => {
                            i += 1;
                            break;
                        }
                        Some(_) => i += 1,
                    }
                }
                ranges.push((start, i));
            }
            _ => i += 1,
        }
    }
    Some(ranges)
}

/// True when any attribute-boundary `sz` marker starts inside a non-code range.
fn any_sz_marker_in_ranges(source: &str, ranges: &[(usize, usize)]) -> bool {
    if ranges.is_empty() {
        return false;
    }
    let mut search_from = 0;
    while let Some(relative_start) = source[search_from..].find("sz=") {
        let index = search_from + relative_start;
        if is_attribute_boundary(source, index)
            && ranges
                .iter()
                .any(|(start, end)| index >= *start && index < *end)
        {
            return true;
        }
        search_from = index + 3;
    }
    false
}

fn try_static_sz_ir(file: &TransformFile) -> Option<SourceIr> {
    let source_len = u32::try_from(file.source.len()).ok()?;
    let mut ir = SourceIr::empty(file.filename.clone(), source_len);
    let mut search_from = 0;
    let mut found = false;
    let sz_attribute_count = count_sz_attributes(&file.source);

    while let Some(relative_start) = file.source[search_from..].find("sz={{") {
        let attribute_start = search_from + relative_start;
        if !is_attribute_boundary(&file.source, attribute_start) {
            search_from = attribute_start + 2;
            continue;
        }
        found = true;

        let opening_start = file.source[..attribute_start].rfind('<')?;
        let opening_end = attribute_start + file.source[attribute_start..].find('>')? + 1;
        let opening = &file.source[opening_start..opening_end];
        // No `szs=` check here: `triage_source` already bailed file-wide on
        // that marker before this walk runs, so no opening can contain it.
        if opening.contains("class=")
            || opening.contains("className=")
            || opening.contains("szRecover")
            || opening.contains("data-sz-recovery-token")
            || opening.contains("{...")
            || opening.matches("sz={{").count() != 1
        {
            return None;
        }

        let inner_start = attribute_start + "sz={{".len();
        let close_relative = file.source[inner_start..opening_end].find("}}")?;
        let inner_end = inner_start + close_relative;
        let attribute_end = inner_end + 2;

        let object = parse_flat_static_object(&file.source[inner_start..inner_end], inner_start)?;
        if object.is_empty() {
            return None;
        }

        let opening_span = span(opening_start, opening_end)?;

        let attribute_index = ir.sz_attributes.len();
        ir.sz_attributes.push(SzAttributeIr {
            runtime_fallback_diagnostic: None,
            attribute_span: span(attribute_start, attribute_end)?,
            value_span: span(attribute_start + "sz=".len(), attribute_end)?,
            object,
            literal_class_name: None,
            rewrites_empty_class: false,
            ternaries: Vec::new(),
            array_parts: Vec::new(),
            runtime_fallback: false,
            runtime_fallback_spread: false,
            candidate_classes: Vec::new(),
            dynamic_css_vars: Vec::new(),
            dropped_dynamic_keys: Vec::new(),
        });
        ir.jsx_opening_elements.push(JsxOpeningElementIr {
            opening_span,
            parent_element_index: None,
            can_host_style: true,
            sz_attribute_indices: vec![attribute_index],
            class_attribute_index: None,
            style_attribute_index: None,
            recovery_attribute_index: None,
            has_recovery_token_attribute: false,
            has_spread_attribute: false,
            safe_style_spread: None,
            last_attribute_end: Some(u32::try_from(attribute_end).ok()?),
            element_name: element_name(opening)?,
            hoisted_dynamic_css_vars: Vec::new(),
        });

        search_from = attribute_end;
    }

    if found && !ir.sz_attributes.is_empty() && ir.sz_attributes.len() == sz_attribute_count {
        Some(ir)
    } else {
        None
    }
}

fn count_sz_attributes(source: &str) -> usize {
    let mut count = 0;
    let mut search_from = 0;
    while let Some(relative_start) = source[search_from..].find("sz=") {
        let index = search_from + relative_start;
        if is_attribute_boundary(source, index) {
            count += 1;
        }
        search_from = index + 3;
    }
    count
}

fn parse_flat_static_object(source: &str, source_offset: usize) -> Option<StaticSzObject> {
    let mut properties = Vec::new();
    for raw_part in source.split(',') {
        let part = raw_part.trim();
        if part.is_empty() {
            continue;
        }
        if part.contains(['{', '}', '[', ']', '(', ')']) || part.contains("...") {
            return None;
        }
        let colon = part.find(':')?;
        let key = part[..colon].trim();
        if !is_identifier_key(key) {
            return None;
        }
        let value_source = part[colon + 1..].trim();
        let value = parse_static_value(value_source)?;
        let part_start = source_offset + raw_part.find(part)?;
        properties.push(StaticSzProperty {
            key: key.to_string(),
            span: span(part_start, part_start + part.len())?,
            value,
        });
    }

    Some(StaticSzObject { properties })
}

fn parse_static_value(source: &str) -> Option<StaticSzValue> {
    if source == "true" {
        return Some(StaticSzValue::Boolean(true));
    }
    if source == "false" {
        return Some(StaticSzValue::Boolean(false));
    }
    if let Some(value) = parse_simple_string(source) {
        return Some(StaticSzValue::String(value));
    }
    if source
        .chars()
        .all(|ch| ch.is_ascii_digit() || ch == '-' || ch == '.')
        && source.chars().filter(|ch| *ch == '-').count() <= 1
        && source.chars().filter(|ch| *ch == '.').count() <= 1
        && !source.ends_with(['-', '.'])
    {
        return source.parse::<f64>().ok().map(StaticSzValue::Number);
    }

    None
}

fn parse_simple_string(source: &str) -> Option<String> {
    let bytes = source.as_bytes();
    let quote = *bytes.first()?;
    if quote != b'\'' && quote != b'"' {
        return None;
    }
    if bytes.last().copied()? != quote || bytes.len() < 2 {
        return None;
    }
    let inner = &source[1..source.len() - 1];
    if inner.contains(['\\', '\'', '"', '\n', '\r']) {
        return None;
    }
    Some(inner.to_string())
}

fn is_identifier_key(key: &str) -> bool {
    let mut chars = key.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_ascii_alphabetic() || first == '_' || first == '$')
        && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '$')
}

fn is_attribute_boundary(source: &str, index: usize) -> bool {
    source[..index]
        .chars()
        .next_back()
        .is_some_and(|ch| ch.is_whitespace() || ch == '<')
}

fn element_name(opening: &str) -> Option<String> {
    let mut name = opening.strip_prefix('<')?.trim_start();
    if name.starts_with('/') {
        return None;
    }
    name = name.split_whitespace().next()?;
    if name.is_empty() || name.contains(['{', '}', '>']) {
        return None;
    }
    Some(name.trim_end_matches('/').to_string())
}

fn span(start: usize, end: usize) -> Option<TextSpan> {
    Some(TextSpan {
        start: u32::try_from(start).ok()?,
        end: u32::try_from(end).ok()?,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        element_name, is_identifier_key, non_code_ranges, parse_simple_string, triage_source,
        FastPathBailoutReason, FastPathTriage,
    };
    use crate::transform::TransformFile;

    #[test]
    fn source_without_sz_is_noop_without_parse() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div className=\"p-4\" />;".to_string(),
        };

        let FastPathTriage::Noop(ir) = triage_source(&file) else {
            panic!("expected no-op fast path");
        };

        assert_eq!(ir.filename, file.filename);
        assert_eq!(
            ir.source_span.len(),
            u32::try_from(file.source.len()).expect("fixture length fits u32")
        );
        assert!(ir.is_noop());
    }

    #[test]
    fn flat_static_sz_prop_builds_ast_free_ir() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div id=\"x\" sz={{ p: 4, bg: 'red-500', fontStyle: 'italic' }} />;".to_string(),
        };

        let FastPathTriage::StaticIr(ir) = triage_source(&file) else {
            panic!("expected AST-free static IR");
        };

        assert_eq!(ir.sz_attributes.len(), 1);
        assert_eq!(ir.jsx_opening_elements.len(), 1);
        assert_eq!(ir.jsx_opening_elements[0].element_name, "div");
        assert_eq!(ir.sz_attributes[0].object.properties.len(), 3);
    }

    #[test]
    fn lexical_helpers_reject_ambiguous_tokens() {
        assert_eq!(
            parse_simple_string("'safe-token'"),
            Some("safe-token".to_string())
        );
        assert_eq!(parse_simple_string("'mismatched\""), None);
        assert_eq!(parse_simple_string(r"'escaped\\value'"), None);

        assert!(!is_identifier_key(""));
        assert!(is_identifier_key("$token_2"));

        assert_eq!(element_name("</div>"), None);
        assert_eq!(element_name("<{dynamic} />"), None);
    }

    #[test]
    fn boolean_values_remain_on_the_ast_free_path() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const App=()=> <div sz={{ truncate: true, flex: false }} />;".to_string(),
        };

        let FastPathTriage::StaticIr(ir) = triage_source(&file) else {
            panic!("expected AST-free static IR");
        };
        assert_eq!(ir.sz_attributes[0].object.properties.len(), 2);
    }

    #[test]
    fn existing_class_bails_to_parser() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div className=\"x\" sz={{ p: 4 }} />;".to_string(),
        };

        assert!(matches!(
            triage_source(&file),
            FastPathTriage::NeedsParser(super::FastPathBailout {
                reason: FastPathBailoutReason::ContainsSzMarker,
                ..
            })
        ));
    }

    #[test]
    fn dynamic_call_bails_to_parser() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "import { dynamic } from '@csszyx/dynamic'; const App = () => <div sz={{ p: 4 }}><span className={dynamic({ w: 7 })} /></div>;".to_string(),
        };

        assert!(matches!(
            triage_source(&file),
            FastPathTriage::NeedsParser(super::FastPathBailout {
                reason: FastPathBailoutReason::ContainsSzMarker,
                ..
            })
        ));
    }

    #[test]
    fn catalog_call_alongside_static_sz_bails_to_parser() {
        // The regression: a file with a plain static `sz={{ p: 4 }}` AND a
        // top-level `szv`/`szr` catalog must NOT fast-path — the AST-free path
        // only sees the `sz=` attribute and would silently drop the catalog,
        // diverging from the removed JavaScript lanes that DO collect it (field-reported as a
        // `build.parser` flip changing the safelist). Every catalog marker in
        // `collect_catalog_call_classes` is covered here.
        for source in [
            "import { szv } from 'csszyx'; const s = szv({ variants: { l: { x: { grow: 1, mx: 0, my: 4 } } } }); const App = () => <div sz={{ p: 4 }} />;",
            "import { szr } from '@csszyx/runtime'; const c = szr({ mx: 0 }); const App = () => <div sz={{ p: 4 }} />;",
            "import { dynamic } from '@csszyx/dynamic'; const c = dynamic({ w: 7 }); const App = () => <div sz={{ p: 4 }} />;",
        ] {
            let file = TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source: source.to_string(),
            };
            assert!(
                matches!(
                    triage_source(&file),
                    FastPathTriage::NeedsParser(super::FastPathBailout {
                        reason: FastPathBailoutReason::ContainsSzMarker,
                        ..
                    })
                ),
                "expected NeedsParser for: {source}"
            );
        }
    }

    #[test]
    fn component_szs_alongside_static_sz_bails_to_parser() {
        // The regression: a component `szs={{ … }}` slot map on one element
        // next to a SIBLING element with a plain static `sz={{ … }}` must not
        // fast-path. The AST-free walk only inspects openings that contain
        // `sz={{`, so an `szs` on any other element is invisible to it and the
        // `szs` -> `szsc` rewrite is silently skipped (field-reported: slot
        // overrides dropped, component reads `szsc` as undefined). An `szs` on
        // the SAME opening as the `sz` was already rejected; the sibling shape
        // was the hole.
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const C = () => <Popup szs={{ body: { p: 0 } }}><Box sz={{ p: 4 }}>x</Box></Popup>;"
                .to_string(),
        };

        assert!(matches!(
            triage_source(&file),
            FastPathTriage::NeedsParser(super::FastPathBailout {
                reason: FastPathBailoutReason::ContainsSzMarker,
                ..
            })
        ));
    }

    #[test]
    fn nested_static_sz_bails_to_parser() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "export const App = () => <div sz={{ hover: { bg: 'red-500' } }} />;"
                .to_string(),
        };

        assert!(matches!(
            triage_source(&file),
            FastPathTriage::NeedsParser(super::FastPathBailout {
                reason: FastPathBailoutReason::ContainsSzMarker,
                ..
            })
        ));
    }

    #[test]
    fn mixed_static_and_dynamic_sz_bails_to_parser() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const App = ({ styles }) => <><div sz={{ p: 4 }} /><span sz={styles} /></>;"
                .to_string(),
        };

        assert!(matches!(
            triage_source(&file),
            FastPathTriage::NeedsParser(super::FastPathBailout {
                reason: FastPathBailoutReason::ContainsSzMarker,
                ..
            })
        ));
    }

    #[test]
    fn source_with_sz_in_comment_still_bails_to_parser() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "/* sz={{ p: 4 }} */ export const App = () => <div />;".to_string(),
        };

        assert!(matches!(
            triage_source(&file),
            FastPathTriage::NeedsParser(super::FastPathBailout {
                reason: FastPathBailoutReason::ContainsSzMarker,
                ..
            })
        ));
    }

    #[test]
    fn static_sz_next_to_a_commented_sz_bails_to_parser() {
        // The field-reported shape: a commented-out sz block AND a real static
        // one. Both look identical to the textual scan, so the file must take
        // the parser lane — fast-pathing it shipped the commented-out classes
        // (mb-10) into the build while the removed JavaScript lanes correctly ignored them.
        for source in [
            "const A = () => {\n  // <Box sz={{ mb: 10 }}>x</Box>\n  return <div sz={{ p: 2 }} />;\n};",
            "/** example: <svg sz={{ fill: 'red-500' }} /> */\nconst A = () => <div sz={{ p: 2 }} />;",
        ] {
            let file = TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source: source.to_string(),
            };
            assert!(
                matches!(
                    triage_source(&file),
                    FastPathTriage::NeedsParser(super::FastPathBailout {
                        reason: FastPathBailoutReason::ContainsSzMarker,
                        ..
                    })
                ),
                "expected NeedsParser for: {source}"
            );
        }
    }

    #[test]
    fn sz_shaped_text_inside_a_string_bails_to_parser() {
        // ` sz={{ z: 9 }}` inside an attribute string passes the boundary check
        // (space before `sz=`), so without string awareness the scan would lift
        // z-9 out of plain text.
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const A = () => <div title=\" sz={{ z: 9 }}\" sz={{ p: 4 }} />;".to_string(),
        };

        assert!(matches!(
            triage_source(&file),
            FastPathTriage::NeedsParser(super::FastPathBailout {
                reason: FastPathBailoutReason::ContainsSzMarker,
                ..
            })
        ));
    }

    #[test]
    fn jsx_text_apostrophe_is_ambiguous_and_bails_to_parser() {
        // `Don't` in JSX text opens a bogus single-quote "string" that hits a
        // newline — the lexer refuses to guess and the file takes the parser.
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "const A = () => <p sz={{ p: 2 }}>Don't panic</p>;\n".to_string(),
        };

        assert!(matches!(
            triage_source(&file),
            FastPathTriage::NeedsParser(super::FastPathBailout {
                reason: FastPathBailoutReason::ContainsSzMarker,
                ..
            })
        ));
    }

    #[test]
    fn benign_comments_and_strings_keep_the_fast_path() {
        // Comments/strings that do not contain an sz marker must not cost the
        // file its AST-free lane.
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "// layout shell\nconst A = () => <div id=\"shell\" sz={{ p: 4 }} />;"
                .to_string(),
        };

        assert!(matches!(triage_source(&file), FastPathTriage::StaticIr(_)));
    }

    /// Every shape that must NOT reach the AST-free scan, one fixture each.
    ///
    /// Falling through to the parser is always safe here — the parser handles
    /// all of these correctly — so the only failure mode worth locking is the
    /// opposite one: a shape that stops bailing gets compiled by the textual
    /// scan, which emits classes for code that does not exist and rewrites
    /// text inside comments and string literals. Each row is its own fixture
    /// on purpose. A single combined fixture would still report `NeedsParser`
    /// while all but one of the bail reasons quietly stopped working.
    #[test]
    fn every_shape_the_ast_free_scan_cannot_read_bails_to_the_parser() {
        for (what, source) in [
            (
                // The comment scanner must span the whole block, not just its
                // first line, or the example on line two is compiled for real.
                "sz on a later line of a JSDoc block",
                "/**\n * Usage:\n * <Box sz={{ mb: 10 }} />\n */\nexport const A = () => <div id=\"a\" />;",
            ),
            (
                // A `//` inside the comment body must not be read as the end
                // of it — the rest of the block would then count as code.
                "sz after a URL inside a JSDoc block",
                "/**\n * See https://example.com/docs\n * <Box sz={{ mb: 10 }} />\n */\nexport const A = () => <div id=\"a\" />;",
            ),
            (
                // The recorded range has to reach the closing delimiter; one
                // byte short and the trailing example escapes it.
                "sz at the very end of a block comment",
                "/* <Box sz={{ mb: 10 }} /> */\nexport const A = () => <div id=\"a\" />;",
            ),
            (
                // A template literal is data, not code. Compiling it emits
                // classes for markup that may never render AND edits the
                // string the program hands to its runtime.
                "sz inside a template literal",
                "export const html = `<div sz={{ p: 4 }} />`;\nexport const A = () => <div id=\"a\" />;",
            ),
            (
                // The fast lane cannot emit a recovery token, so an element
                // asking for one has to go where tokens are emitted; keeping
                // it here drops the feature with no signal.
                "szRecover beside a static sz",
                "export const A = () => <div szRecover=\"csr\" sz={{ p: 4 }} />;",
            ),
            (
                // `level` is a variable. Reading it as a string literal would
                // freeze a build-time guess into the class name.
                "an identifier as an sz value",
                "export const A = ({ level }) => <div sz={{ p: level }} />;",
            ),
            (
                // The scan splits the object on commas, so a comma INSIDE a
                // string value leaves it holding half a literal.
                "a comma inside a string value",
                "export const A = () => <div sz={{ content: ',' }} />;",
            ),
            (
                // `data-sz` is a different attribute that happens to end in
                // the marker. Treating it as `sz` rewrites an attribute the
                // author never asked csszyx to touch.
                "a data-sz attribute",
                "export const A = () => <div data-sz={{ p: 4 }} />;",
            ),
        ] {
            let file = TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source: source.to_string(),
            };
            assert!(
                matches!(triage_source(&file), FastPathTriage::NeedsParser(_)),
                "expected NeedsParser for {what}: {source}"
            );
        }
    }

    /// Sources that must not crash or hang the triage scan.
    ///
    /// The lexers here walk raw bytes with hand-written index arithmetic, so
    /// the interesting inputs are the ones that end mid-token or close as soon
    /// as they open. A slice past the end aborts the whole build with a panic
    /// the author cannot act on, and a scan that fails to advance hangs it
    /// with no output at all — both far worse than the wrong answer.
    #[test]
    fn truncated_and_empty_tokens_neither_panic_nor_hang() {
        // Every fixture carries an `sz` marker: the triage returns a no-op
        // before it reads a single byte otherwise, and the scanners under test
        // would never run.
        for source in [
            // Ends one byte into what could be a comment opener.
            "export const A = () => <div sz={{ p: 4 }} />; /**",
            "export const A = () => <div sz={{ p: 4 }} />; /*",
            "export const A = () => <div sz={{ p: 4 }} />; /",
            // The shortest possible block comment: opener and closer share a
            // star, so a scanner that steps past it never terminates.
            "/**/ export const A = () => <div sz={{ p: 4 }} />;",
            "export const A = () => <div sz={{ p: 4 }} />; /**/",
            // A quote that is the entire value, produced by splitting on the
            // comma inside a string.
            "export const A = () => <div sz={{ content: ',' }} />;",
            "export const A = () => <div sz={{ content: '' }} />;",
            "export const A = () => <div sz={{ content: ',,' }} />;",
            // A non-attribute marker near the end, so any over-scaled resume
            // offset lands past the end of the source.
            "const s = \"x\";\nexport const A = () => <div data-sz={{ p: 4 }} />;",
            "const s = \"x\"; // data-sz=",
            "const s = \"x\"; /* keep */ const t = 'data-sz='",
        ] {
            let file = TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source: source.to_string(),
            };
            // The verdict is the parser's business; surviving the scan is not.
            let _ = triage_source(&file);
        }
    }

    /// The fast lane must keep the numbers real code is written with.
    ///
    /// Losing these is silent and only costs speed, which is exactly why it
    /// would never be noticed: the existing fixtures all use a single-digit
    /// positive integer, so a value scanner that rejects everything else looks
    /// perfectly healthy.
    #[test]
    fn multi_digit_negative_and_decimal_values_stay_on_the_fast_path() {
        for source in [
            "export const A = () => <div sz={{ p: 12 }} />;",
            "export const A = () => <div sz={{ mt: -4 }} />;",
            "export const A = () => <div sz={{ p: 1.5 }} />;",
            "export const A = () => <div sz={{ p: 0.5, mt: -12 }} />;",
        ] {
            let file = TransformFile {
                filename: "/repo/src/App.tsx".to_string(),
                source: source.to_string(),
            };
            assert!(
                matches!(triage_source(&file), FastPathTriage::StaticIr(_)),
                "expected the AST-free lane for: {source}"
            );
        }
    }

    /// A string value has to be quoted at BOTH ends to be a string.
    ///
    /// Dropping the opening-quote requirement turns any identifier whose first
    /// and last character match — `level`, `sss`, `index`? no, but `level`
    /// yes — into a literal, and its middle characters become the class.
    #[test]
    fn a_value_is_only_a_string_when_it_opens_with_a_quote() {
        assert_eq!(
            parse_simple_string("'red-500'"),
            Some("red-500".to_string())
        );
        assert_eq!(
            parse_simple_string("\"red-500\""),
            Some("red-500".to_string())
        );
        // First and last byte match, but neither is a quote.
        assert_eq!(parse_simple_string("level"), None);
        assert_eq!(parse_simple_string("gag"), None);
        // A lone quote is not a string, and slicing it as one reads past its
        // own end.
        assert_eq!(parse_simple_string("'"), None);
        assert_eq!(parse_simple_string("\""), None);
        assert_eq!(parse_simple_string(""), None);
    }

    /// A block comment is one non-code range, ending at its own `*/`.
    ///
    /// These ranges exist to keep a commented-out `sz` prop from reaching the
    /// AST-free lane as if it were live code. Mis-measure the end and the lane
    /// either takes a file it cannot read — minting classes for markup nobody
    /// ships — or walks off the end of the source.
    #[test]
    fn a_block_comment_is_one_non_code_range() {
        let source = "const alpha = 1; const beta = 2; /* <div sz={{ p: 4 }} /> */ c();";
        let ranges = non_code_ranges(source).expect("source is scannable");

        assert_eq!(ranges.len(), 1, "{ranges:?}");
        let (start, end) = ranges[0];
        assert_eq!(&source[start..end], "/* <div sz={{ p: 4 }} /> */");
    }

    /// A block comment with no terminator is unscannable, not empty.
    ///
    /// Reporting it as scannable hands the lane a range that stops short of
    /// the end, and every `sz` past it reads as code.
    #[test]
    fn an_unterminated_block_comment_refuses_the_lane() {
        assert_eq!(non_code_ranges("const a = 1; /* sz={{ p: 4 }}"), None);
    }

    /// An escaped quote does not close the literal it sits in.
    ///
    /// Skipping the wrong number of bytes past the escape lands mid-literal,
    /// where the next quote looks like the end — so the range stops early and
    /// the rest of the string is handed to the lane as code.
    #[test]
    fn an_escaped_quote_does_not_close_a_string_range() {
        let source = r"const a = 1; const b = 2; const c = 'it\'s sz={{ p: 4 }}'; d();";
        let ranges = non_code_ranges(source).expect("source is scannable");

        assert_eq!(ranges.len(), 1, "{ranges:?}");
        let (start, end) = ranges[0];
        assert_eq!(&source[start..end], r"'it\'s sz={{ p: 4 }}'");
    }

    /// Same for a template literal, which has its own scanning loop.
    #[test]
    fn an_escaped_backtick_does_not_close_a_template_range() {
        let source = r"const alpha = 1; const beta = 2; let t = `a\` sz={{ p: 4 }}`;";
        let ranges = non_code_ranges(source).expect("source is scannable");

        assert_eq!(ranges.len(), 1, "{ranges:?}");
        let (start, end) = ranges[0];
        assert_eq!(&source[start..end], r"`a\` sz={{ p: 4 }}`");
    }

    /// A commented-out `sz` prop must not reach the AST-free lane.
    ///
    /// The lane rewrites what it finds without a parser, so it has to see the
    /// marker inside the comment and hand the file to the parser instead.
    #[test]
    fn a_commented_out_sz_prop_leaves_the_fast_lane() {
        let file = TransformFile {
            filename: "/repo/src/App.tsx".to_string(),
            source: "/* <div sz={{ p: 4 }} /> */\nexport const App = () => <div sz={{ m: 2 }} />;"
                .to_string(),
        };

        assert!(
            matches!(triage_source(&file), FastPathTriage::NeedsParser(_)),
            "a marker inside a comment must not be rewritten without a parser"
        );
    }
}
