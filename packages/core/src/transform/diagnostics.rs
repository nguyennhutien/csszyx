//! The engine's diagnostics: each rendered line beside its code and position.
//!
//! The text is for people and stays exactly as it was. A gate, a config rule
//! or an editor needs to know which kind of problem a line reports and where,
//! and reading either back out of the English breaks the day a message is
//! reworded. Every diagnostic therefore goes through [`Diagnostics::push_issue`],
//! which records the [`Issue`] beside the text, so the two lists stay
//! index-parallel by construction.
//!
//! Positions are byte offsets into the source. Turning one into a line costs a
//! pass over the file, which the consumer pays only when it reads one (ADR 0011).
//!
//! Each issue also carries its named [`Args`]: what the sentence says, as
//! data, so a consumer reads the key or the value it names without parsing the
//! English (ADR 0031). The generated constructors in
//! `generated::diagnostic_codes::issue` are the only way to build them, so the
//! names and their order are the registry's.

use super::contract::{Args, Issue};
use super::generated::diagnostic_codes::DiagnosticCode;

/// Rendered diagnostics with the [`Issue`] of each, index-parallel.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Diagnostics {
    texts: Vec<String>,
    issues: Vec<Issue>,
}

impl Diagnostics {
    /// Record one diagnostic: what it reports, where, and its text.
    ///
    /// # Arguments
    /// * `issue` - The kind of problem and its args, from a generated
    ///   constructor.
    /// * `start` - Byte offset in the source the diagnostic points at; `0`
    ///   for one about the whole file.
    /// * `text` - The rendered message.
    pub fn push_issue(&mut self, (code, args): (DiagnosticCode, Args), start: u32, text: String) {
        self.texts.push(text);
        self.issues.push(Issue { code, start, args });
    }

    /// Append every diagnostic of `other`, in order.
    pub fn extend(&mut self, other: Self) {
        self.texts.extend(other.texts);
        self.issues.extend(other.issues);
    }

    /// Whether nothing was recorded.
    pub const fn is_empty(&self) -> bool {
        self.texts.is_empty()
    }

    /// The rendered texts, in order.
    #[cfg(test)]
    pub fn texts(&self) -> &[String] {
        &self.texts
    }

    /// The texts and their issues, index-parallel.
    pub fn into_parts(self) -> (Vec<String>, Vec<Issue>) {
        (self.texts, self.issues)
    }
}

impl super::TransformResult {
    /// Record one diagnostic on a finished result, beside its [`Issue`].
    ///
    /// For the few reported after the per-file pass: a file the nesting guard
    /// refused, or a merge table the engine could not read.
    pub(crate) fn push_issue(
        &mut self,
        (code, args): (DiagnosticCode, Args),
        start: u32,
        text: String,
    ) {
        self.diagnostics.push(text);
        self.issues.push(Issue { code, start, args });
    }
}

impl FromIterator<((DiagnosticCode, Args), u32, String)> for Diagnostics {
    fn from_iter<I: IntoIterator<Item = ((DiagnosticCode, Args), u32, String)>>(iter: I) -> Self {
        let mut diagnostics = Self::default();
        for (issue, start, text) in iter {
            diagnostics.push_issue(issue, start, text);
        }
        diagnostics
    }
}

#[cfg(test)]
mod tests {
    use super::Diagnostics;
    use crate::transform::contract::Issue;
    use crate::transform::generated::diagnostic_codes::{issue, DiagnosticCode, DIAGNOSTIC_CODES};

    #[test]
    fn every_text_keeps_its_issue_at_the_same_index() {
        let mut diagnostics: Diagnostics =
            std::iter::once((issue::unknown_key("a", None), 7, "a".to_string())).collect();
        assert!(!diagnostics.is_empty());
        diagnostics.extend(
            std::iter::once((
                issue::parse_error_summary(None, Some(1)),
                0,
                "b".to_string(),
            ))
            .collect(),
        );
        assert_eq!(diagnostics.texts(), ["a", "b"]);
        let (texts, issues) = diagnostics.into_parts();
        assert_eq!(texts, ["a", "b"]);
        assert_eq!(
            issues
                .iter()
                .map(|issue| (issue.code, issue.start))
                .collect::<Vec<_>>(),
            [
                (DiagnosticCode::UnknownKey, 7),
                (DiagnosticCode::ParseError, 0)
            ]
        );
        assert!(Diagnostics::default().is_empty());
    }

    #[test]
    fn args_serialize_in_registry_order_with_absent_ones_left_out() {
        let (_, args) = issue::fallback_missing_css("szr", Some("call"), Some("f()"), None, None);
        assert_eq!(
            args.to_json(),
            r#"{"site":"szr","shape":"call","detail":"f()"}"#
        );
        let (_, args) = issue::property_object("p", vec!["x".to_string(), "y".to_string()]);
        assert_eq!(args.to_json(), r#"{"key":"p","nestedKeys":["x","y"]}"#);
        let (_, args) = issue::duplicate_sz("div", 2);
        assert_eq!(args.to_json(), r#"{"elementName":"div","count":2}"#);
        assert_eq!(
            args.get("count"),
            Some(&crate::transform::ArgValue::Count(2))
        );
        assert_eq!(args.get("nope"), None);
        let (_, args) = issue::style_override();
        assert_eq!(args.to_json(), "{}");
        let issue = Issue {
            code: DiagnosticCode::StyleOverride,
            start: 3,
            args,
        };
        assert_eq!(
            serde_json::to_string(&issue).expect("an issue serializes"),
            r#"{"code":"style-override","start":3,"args":{}}"#
        );
        let read: Issue =
            serde_json::from_str(r#"{"code":"style-override","start":3}"#).expect("reads back");
        assert_eq!(read, issue);
    }

    #[test]
    fn every_code_serializes_as_its_public_id() {
        for code in DIAGNOSTIC_CODES {
            assert_eq!(
                serde_json::to_string(&code).expect("a code serializes"),
                format!("\"{}\"", code.as_str())
            );
        }
    }
}
