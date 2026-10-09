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

use super::contract::Issue;
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
    /// * `code` - The kind of problem.
    /// * `start` - Byte offset in the source the diagnostic points at; `0`
    ///   for one about the whole file.
    /// * `text` - The rendered message.
    pub fn push_issue(&mut self, code: DiagnosticCode, start: u32, text: String) {
        self.texts.push(text);
        self.issues.push(Issue { code, start });
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
    pub(crate) fn push_issue(&mut self, code: DiagnosticCode, start: u32, text: String) {
        self.diagnostics.push(text);
        self.issues.push(Issue { code, start });
    }
}

impl FromIterator<(DiagnosticCode, u32, String)> for Diagnostics {
    fn from_iter<I: IntoIterator<Item = (DiagnosticCode, u32, String)>>(iter: I) -> Self {
        let mut diagnostics = Self::default();
        for (code, start, text) in iter {
            diagnostics.push_issue(code, start, text);
        }
        diagnostics
    }
}

#[cfg(test)]
mod tests {
    use super::Diagnostics;
    use crate::transform::contract::Issue;
    use crate::transform::generated::diagnostic_codes::{DiagnosticCode, DIAGNOSTIC_CODES};

    #[test]
    fn every_text_keeps_its_issue_at_the_same_index() {
        let mut diagnostics: Diagnostics =
            std::iter::once((DiagnosticCode::UnknownKey, 7, "a".to_string())).collect();
        assert!(!diagnostics.is_empty());
        diagnostics
            .extend(std::iter::once((DiagnosticCode::ParseError, 0, "b".to_string())).collect());
        assert_eq!(diagnostics.texts(), ["a", "b"]);
        assert_eq!(
            diagnostics.into_parts(),
            (
                vec!["a".to_string(), "b".to_string()],
                vec![
                    Issue {
                        code: DiagnosticCode::UnknownKey,
                        start: 7
                    },
                    Issue {
                        code: DiagnosticCode::ParseError,
                        start: 0
                    },
                ]
            )
        );
        assert!(Diagnostics::default().is_empty());
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
