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
    // classes but silently drop those extras — the exact classes the JS engines
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

    // An `sz=` occurrence inside a comment or string literal must never build
    // static IR: the textual scan below cannot tell it from a real attribute,
    // so `// <Box sz={{ mb: 10 }} />` used to ship the commented-out classes
    // into the build (field-reported — babel/oxc parse and ignore comments).
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
    let mut element_spans = Vec::<TextSpan>::new();
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
        if opening.contains("class=")
            || opening.contains("className=")
            || opening.contains("szs=")
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
        if attribute_end > opening_end {
            return None;
        }

        let object = parse_flat_static_object(&file.source[inner_start..inner_end], inner_start)?;
        if object.is_empty() {
            return None;
        }

        let opening_span = span(opening_start, opening_end)?;
        if element_spans.contains(&opening_span) {
            return None;
        }
        element_spans.push(opening_span);

        let attribute_index = ir.sz_attributes.len();
        ir.sz_attributes.push(SzAttributeIr {
            attribute_span: span(attribute_start, attribute_end)?,
            value_span: span(attribute_start + "sz=".len(), attribute_end)?,
            object,
            literal_class_name: None,
            rewrites_empty_class: false,
            ternary: None,
            array_parts: Vec::new(),
            runtime_fallback: false,
            runtime_fallback_spread: false,
            candidate_classes: Vec::new(),
            dynamic_css_vars: Vec::new(),
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
    use super::{triage_source, FastPathBailoutReason, FastPathTriage};
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
        // diverging from the JS engines that DO collect it (field-reported as a
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
        // (mb-10) into the build while babel/oxc correctly ignored them.
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
}
