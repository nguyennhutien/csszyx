//! `class="…"` to `sz="…"` in plain HTML, with the runtime's first-paint
//! guard and script injected on request.
//!
//! A `class` attribute is found as the HTML tokenizer finds one
//! (`html_text`), its value decoded, converted, and the classes migrate does
//! not know stay in `class`. The guard goes before
//! `</head>` once, the script before `</body>` once.

use std::borrow::Cow;

use crate::html_text::{decode_attribute_value, html_class_attributes};

use serde::{Deserialize, Deserializer};

use super::line_endings::{detect_line_ending, with_line_ending};
use super::source::{TransformResult, TransformStats};
use super::sz_codegen::sz_html_value;
use super::value::is_class_space;
use super::variant_parser::{class_name_to_sz_object_with, Lookup};

use super::verdict::{Judge, ServedAnswers, TableVerdicts, UnderscoreAnswers, UnderscoreQuestions};

/// Where the runtime script comes from, when it is injected at all.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum InjectRuntime {
    /// No script.
    #[default]
    Off,
    /// `<script src>` pointing at the CDN.
    Cdn,
    /// `<script src>` pointing at a local path.
    Local,
}

impl<'de> Deserialize<'de> for InjectRuntime {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        // The TypeScript option is `'local' | 'cdn' | false`.
        match serde_json::Value::deserialize(deserializer)? {
            serde_json::Value::String(kind) if kind == "cdn" => Ok(Self::Cdn),
            serde_json::Value::String(kind) if kind == "local" => Ok(Self::Local),
            serde_json::Value::Bool(false) => Ok(Self::Off),
            other => Err(serde::de::Error::custom(format!(
                "injectRuntime must be 'cdn', 'local' or false, got {other}"
            ))),
        }
    }
}

/// Options for the HTML transformation.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HtmlTransformOptions {
    /// Wrap the sz attribute value in outer braces.
    pub braces: bool,
    /// Inject the first-paint guard before `</head>`.
    pub inject_fouc: bool,
    /// Inject the runtime script before `</body>`.
    pub inject_runtime: InjectRuntime,
    /// The script URL for `InjectRuntime::Cdn`.
    pub cdn_url: Option<String>,
    /// The script path for `InjectRuntime::Local`.
    pub local_path: Option<String>,
    /// What the project's Tailwind answered for classes one of migrate's
    /// tables would otherwise decide. Handed in by the caller, never read
    /// from the options JSON.
    #[serde(skip)]
    pub served: Option<ServedAnswers>,
    /// What the project's Tailwind answered about the `_` of arbitrary
    /// values. Handed in by the caller, as `served` is.
    #[serde(skip)]
    pub underscores: Option<UnderscoreAnswers>,
    /// The project's Tailwind prefix, read off the front of each class.
    /// Handed in by the caller, as `served` is.
    #[serde(skip)]
    pub prefix: Option<String>,
    /// The page's path, which each warning starts with, as a JSX file's do.
    pub file_path: Option<String>,
}

impl Default for HtmlTransformOptions {
    fn default() -> Self {
        Self {
            braces: false,
            inject_fouc: true,
            inject_runtime: InjectRuntime::Off,
            cdn_url: None,
            local_path: None,
            served: None,
            underscores: None,
            prefix: None,
            file_path: None,
        }
    }
}

const DEFAULT_CDN_URL: &str = "https://cdn.csszyx.com/runtime.js";
const DEFAULT_LOCAL_PATH: &str = "csszyx-runtime.js";

const FOUC_CSS: &str = "<style>\n  /* csszyx: hide [sz] elements until runtime processes them */\n  [sz] { visibility: hidden; }\n  body.sz-ready [sz] { visibility: visible; }\n</style>";

/// The marker the guard carries, so a second run does not add it twice.
const FOUC_MARKER: &str = "csszyx: hide [sz]";

struct HtmlState<'a> {
    eol: &'static str,
    lookup: Lookup<'a>,
    braces: bool,
    transformed: u32,
    skipped: u32,
    unrecognized: Vec<String>,
    warnings: Vec<String>,
    /// What each warning starts with: `[path] `, or nothing.
    warning_prefix: String,
    changed: bool,
    _source: &'a str,
}

/// Transform an HTML source, replacing `class` attributes with `sz` and
/// injecting the guard and the runtime script as the options ask.
#[must_use]
pub fn transform_html_source(source: &str, options: &HtmlTransformOptions) -> TransformResult {
    let eol = detect_line_ending(source);
    let asked = TableVerdicts::default();
    let asked_underscores = UnderscoreQuestions::default();
    let mut state = HtmlState {
        eol,
        lookup: Lookup {
            custom_map: None,
            judge: Judge::new(options.served.as_ref(), Some(&asked))
                .with_underscores(options.underscores.as_ref(), Some(&asked_underscores)),
            prefix: options.prefix.as_deref(),
        },
        braces: options.braces,
        transformed: 0,
        skipped: 0,
        unrecognized: Vec::new(),
        warnings: Vec::new(),
        warning_prefix: options
            .file_path
            .as_ref()
            .map_or_else(String::new, |path| format!("[{path}] ")),
        changed: false,
        _source: source,
    };

    let mut output = replace_class_attributes(source, &mut state);

    if options.inject_fouc && output.contains("</head>") && !output.contains(FOUC_MARKER) {
        let guard = with_line_ending(&format!("{FOUC_CSS}\n"), eol);
        output = output.replacen("</head>", &format!("{guard}</head>"), 1);
        state.changed = true;
    }

    if options.inject_runtime != InjectRuntime::Off && output.contains("</body>") {
        let script_src = match options.inject_runtime {
            InjectRuntime::Cdn => options.cdn_url.as_deref().unwrap_or(DEFAULT_CDN_URL),
            _ => options.local_path.as_deref().unwrap_or(DEFAULT_LOCAL_PATH),
        };
        if !output.contains(script_src) {
            let tag = format!("<script src=\"{script_src}\"></script>{eol}</body>");
            output = output.replacen("</body>", &tag, 1);
            state.changed = true;
        }
    }

    let changed = state.changed;
    let (transformed, skipped, unrecognized, warnings) = (
        state.transformed,
        state.skipped,
        state.unrecognized,
        state.warnings,
    );
    TransformResult {
        code: output,
        changed,
        warnings,
        stats: TransformStats {
            class_names_transformed: transformed,
            class_names_skipped: skipped,
            class_names_skipped_component: 0,
            classes_unrecognized: unrecognized,
            sz_keys_normalized: None,
            table_verdicts: asked.into_sorted(),
            underscore_questions: asked_underscores.into_sorted(),
        },
        potentially_unused_imports: Vec::new(),
    }
}

/// Every `class` attribute the tokenizer reads replaced left to right
/// (`html_text::html_class_attributes`).
fn replace_class_attributes(text: &str, state: &mut HtmlState<'_>) -> String {
    let mut output = String::with_capacity(text.len());
    let mut cursor = 0;
    // The line `counted_to` is on, counted on from the last warning's.
    let (mut line, mut counted_to) = (1, 0);
    for attribute in html_class_attributes(text) {
        output.push_str(&text[cursor..attribute.start]);
        if attribute.repeated {
            // A browser reads the first `class` and drops the rest; replacing
            // the first would make the next one the element's class.
            line += text[counted_to..attribute.start].matches('\n').count();
            counted_to = attribute.start;
            state.skipped += 1;
            let prefix = &state.warning_prefix;
            state.warnings.push(format!(
                "{prefix}An element on line {line} has more than one `class` attribute, and a browser reads only the first: it is left as written. Remove the others, then run migrate again."
            ));
            output.push_str(&text[attribute.start..attribute.end]);
            cursor = attribute.end;
            continue;
        }
        output.push_str(&process_class_attribute(
            &text[attribute.start..attribute.end],
            &text[attribute.value_start..attribute.value_end],
            attribute.quote.map_or('"', char::from),
            state,
        ));
        cursor = attribute.end;
    }
    output.push_str(&text[cursor..]);
    output
}

/// A decoded value written back inside `quote`: an `&` and the quote are the
/// two characters that would read as something else there.
fn escape_attribute_value(value: &str, quote: char) -> Cow<'_, str> {
    if !value.contains(['&', quote]) {
        return Cow::Borrowed(value);
    }
    let escaped_quote = if quote == '"' { "&quot;" } else { "&#39;" };
    let mut escaped = String::with_capacity(value.len() + 8);
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            c if c == quote => escaped.push_str(escaped_quote),
            c => escaped.push(c),
        }
    }
    Cow::Owned(escaped)
}

/// One `class` attribute: the converted `sz` attribute, with the classes
/// migrate did not know kept in `class`, or the attribute as it was.
fn process_class_attribute(
    matched: &str,
    class_text: &str,
    quote: char,
    state: &mut HtmlState<'_>,
) -> String {
    // A class list holding a named reference the reader does not decode is
    // left as written rather than read wrong.
    let Some(class_text) = decode_attribute_value(class_text) else {
        state.skipped += 1;
        return matched.to_string();
    };
    let trimmed = class_text.trim_matches(is_class_space);
    if trimmed.is_empty() {
        state.skipped += 1;
        return matched.to_string();
    }

    let converted = class_name_to_sz_object_with(trimmed, state.lookup);
    if converted.sz_object.is_empty() {
        state.skipped += 1;
        state.unrecognized.extend(converted.unrecognized);
        return matched.to_string();
    }

    let sz_value = with_line_ending(
        &sz_html_value(&converted.sz_object, state.braces),
        state.eol,
    );
    state.changed = true;
    state.transformed += 1;

    let sz_value = escape_attribute_value(&sz_value, '"');
    if converted.unrecognized.is_empty() {
        return format!("sz=\"{sz_value}\"");
    }
    let remaining = converted.unrecognized.join(" ");
    let remaining = escape_attribute_value(&remaining, quote);
    state.unrecognized.extend(converted.unrecognized);
    format!("class={quote}{remaining}{quote} sz=\"{sz_value}\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_runtime_option_as_the_typescript_spells_it() {
        let read = |json: &str| serde_json::from_str::<HtmlTransformOptions>(json);
        assert_eq!(
            read(r#"{"injectRuntime":"cdn"}"#).unwrap().inject_runtime,
            InjectRuntime::Cdn
        );
        assert_eq!(
            read(r#"{"injectRuntime":"local"}"#).unwrap().inject_runtime,
            InjectRuntime::Local
        );
        assert_eq!(
            read(r#"{"injectRuntime":false}"#).unwrap().inject_runtime,
            InjectRuntime::Off
        );
        assert_eq!(read("{}").unwrap().inject_runtime, InjectRuntime::Off);
        assert!(read(r#"{"injectRuntime":true}"#).is_err());
        assert!(read(r#"{"injectRuntime":"remote"}"#).is_err());
    }

    /// A browser splits a `class` attribute on ASCII whitespace: a NEL joins
    /// two names into one class that styles nothing, and migrate keeps it so.
    #[test]
    fn keeps_a_class_a_nel_joins_as_the_browser_reads_it() {
        let options = HtmlTransformOptions::default();
        for html in [
            "<div class=\"p-4\u{0085}m-2\"></div>",
            "<div class=\"\u{0085}p-4\"></div>",
            "<div class=\"p-4\u{0085}\"></div>",
        ] {
            let result = transform_html_source(html, &options);
            assert!(!result.changed, "{html:?} became {:?}", result.code);
        }
        let control = transform_html_source("<div class=\"p-4 m-2\"></div>", &options);
        assert!(control.changed);
    }

    /// Only a `class` the tokenizer reads is converted: one in a comment, a
    /// script or another attribute's value is text, and a second `class` on
    /// an element is dropped by the parser, so it stays as written.
    #[test]
    fn converts_only_the_class_attributes_the_tokenizer_reads() {
        let options = HtmlTransformOptions::default();
        for html in [
            "<!-- <div class=\"p-4\"> --><p>x</p>",
            "<script>var s = ' class=\"p-4\"';</script>",
            "<a href=/class=p-4>x</a>",
            "<p>write class=\"p-4\" here</p>",
        ] {
            let result = transform_html_source(html, &options);
            assert!(!result.changed, "{html:?} became {:?}", result.code);
        }
        // Two `class` attributes: a browser reads the first. Converting it
        // would leave the second as the element's class, so the element is
        // left as written and named in a warning.
        let html = "<p class=\"m-2\">a</p>\n<div class=\"p-4\" class=\"m-2\">x</div>";
        let named = HtmlTransformOptions {
            file_path: Some("src/page.html".to_string()),
            ..HtmlTransformOptions::default()
        };
        let result = transform_html_source(html, &named);
        assert!(
            result
                .code
                .ends_with("<div class=\"p-4\" class=\"m-2\">x</div>"),
            "{:?}",
            result.code
        );
        assert_eq!(result.stats.class_names_skipped, 1);
        assert_eq!(result.warnings.len(), 1, "{:?}", result.warnings);
        assert!(
            result.warnings[0].starts_with("[src/page.html] An element on line 2 "),
            "{:?}",
            result.warnings
        );
        // Each one names its own line, counted on from the one before.
        let html = "<i class=a class=b></i>\n\n<i class=c class=d></i>";
        let lines: Vec<String> = transform_html_source(html, &options).warnings;
        assert!(lines[0].starts_with("An element on line 1 "), "{lines:?}");
        assert!(lines[1].starts_with("An element on line 3 "), "{lines:?}");
        // A script string that opens a quote does not hide the next element.
        let result = transform_html_source(
            "<script>var s = '<b class=\"';</script><p class=\"p-4\">x</p>",
            &options,
        );
        assert!(
            result
                .code
                .starts_with("<script>var s = '<b class=\"';</script><p sz="),
            "{:?}",
            result.code
        );
    }

    /// The class list is read as the parser decodes it.
    #[test]
    fn converts_a_class_list_written_with_character_references() {
        let options = HtmlTransformOptions::default();
        let result = transform_html_source("<div class=\"p-4&#32;m-2\">x</div>", &options);
        assert!(result.changed, "{:?}", result.code);
        assert!(!result.code.contains("class"), "{:?}", result.code);
        // The classes kept in `class` are written back escaped in their quote.
        let result = transform_html_source("<div class=\"p-4 a&amp;b\">x</div>", &options);
        assert!(
            result.code.starts_with("<div class=\"a&amp;b\" sz="),
            "{:?}",
            result.code
        );
        let result = transform_html_source("<div class='p-4 it&#39;s'>x</div>", &options);
        assert!(
            result.code.starts_with("<div class='it&#39;s' sz="),
            "{:?}",
            result.code
        );
        // A named reference outside the set the reader decodes leaves the
        // attribute as written rather than guess at it.
        let result = transform_html_source("<div class=\"p-4&foo;m-2\">x</div>", &options);
        assert!(!result.changed, "{:?}", result.code);
        assert_eq!(result.stats.class_names_skipped, 1);
    }

    /// HTML allows whitespace around an attribute's `=`.
    #[test]
    fn reads_a_class_attribute_with_space_around_its_equals_sign() {
        let options = HtmlTransformOptions::default();
        for html in [
            "<div class = \"flex p-4\">x</div>",
            "<div class\n=\t'flex p-4'>x</div>",
        ] {
            let result = transform_html_source(html, &options);
            assert!(result.changed, "{html:?} was left as it was");
            assert!(!result.code.contains("class"), "{:?}", result.code);
        }
        // Another attribute that only holds the word stays as it was.
        for html in [
            "<div data-xclass = \"flex\">x</div>",
            "<div classy = \"flex\">x</div>",
        ] {
            let result = transform_html_source(html, &options);
            assert!(!result.changed, "{html:?} became {:?}", result.code);
        }
    }
}
