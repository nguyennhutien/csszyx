//! `class="…"` to `sz="…"` in plain HTML, with the runtime's first-paint
//! guard and script injected on request.
//!
//! There is no parser here, as there is none in the TypeScript: a
//! `class="…"` or `class='…'` attribute is found by text, converted, and the
//! classes migrate does not know stay in `class`. The guard goes before
//! `</head>` once, the script before `</body>` once.

use serde::{Deserialize, Deserializer};

use super::line_endings::{detect_line_ending, with_line_ending};
use super::source::{TransformResult, TransformStats};
use super::sz_codegen::sz_html_value;
use super::value::is_js_whitespace;
use super::variant_parser::class_name_to_sz_object;

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
}

impl Default for HtmlTransformOptions {
    fn default() -> Self {
        Self {
            braces: false,
            inject_fouc: true,
            inject_runtime: InjectRuntime::Off,
            cdn_url: None,
            local_path: None,
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
    braces: bool,
    transformed: u32,
    skipped: u32,
    unrecognized: Vec<String>,
    changed: bool,
    _source: &'a str,
}

/// Transform an HTML source, replacing `class` attributes with `sz` and
/// injecting the guard and the runtime script as the options ask.
#[must_use]
pub fn transform_html_source(source: &str, options: &HtmlTransformOptions) -> TransformResult {
    let eol = detect_line_ending(source);
    let mut state = HtmlState {
        eol,
        braces: options.braces,
        transformed: 0,
        skipped: 0,
        unrecognized: Vec::new(),
        changed: false,
        _source: source,
    };

    let mut output = replace_class_attributes(source, '"', &mut state);
    output = replace_class_attributes(&output, '\'', &mut state);

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

    TransformResult {
        code: output,
        changed: state.changed,
        warnings: Vec::new(),
        stats: TransformStats {
            class_names_transformed: state.transformed,
            class_names_skipped: state.skipped,
            class_names_skipped_component: 0,
            classes_unrecognized: state.unrecognized,
            sz_keys_normalized: None,
        },
        potentially_unused_imports: Vec::new(),
    }
}

/// Every `class=<quote>…<quote>` attribute, as `\bclass="([^"]*)"` finds
/// them, replaced left to right without overlap.
fn replace_class_attributes(text: &str, quote: char, state: &mut HtmlState<'_>) -> String {
    let opener = format!("class={quote}");
    let bytes = text.as_bytes();
    let mut output = String::with_capacity(text.len());
    let mut cursor = 0;
    let mut search_from = 0;

    while let Some(found) = text[search_from..].find(&opener) {
        let start = search_from + found;
        // `\b` before `class`: the previous character is not a word character.
        let word_before = start > 0 && is_word_byte(bytes[start - 1]);
        let value_start = start + opener.len();
        let Some(value_len) = text[value_start..].find(quote) else {
            break;
        };
        if word_before {
            search_from = start + 1;
            continue;
        }
        let value_end = value_start + value_len;
        let end = value_end + quote.len_utf8();
        output.push_str(&text[cursor..start]);
        output.push_str(&process_class_attribute(
            &text[start..end],
            &text[value_start..value_end],
            quote,
            state,
        ));
        cursor = end;
        search_from = end;
    }
    output.push_str(&text[cursor..]);
    output
}

const fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

/// One `class` attribute: the converted `sz` attribute, with the classes
/// migrate did not know kept in `class`, or the attribute as it was.
fn process_class_attribute(
    matched: &str,
    class_text: &str,
    quote: char,
    state: &mut HtmlState<'_>,
) -> String {
    let trimmed = class_text.trim_matches(is_js_whitespace);
    if trimmed.is_empty() {
        state.skipped += 1;
        return matched.to_string();
    }

    let converted = class_name_to_sz_object(trimmed, None);
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

    if converted.unrecognized.is_empty() {
        return format!("sz=\"{sz_value}\"");
    }
    let remaining = converted.unrecognized.join(" ");
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
}
