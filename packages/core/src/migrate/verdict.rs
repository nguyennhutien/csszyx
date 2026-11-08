//! The project's own Tailwind, where one of migrate's tables would decide.
//!
//! A few of migrate's refusals read what csszyx knows of the Tailwind this
//! repository pins: whether a sign applies to a keyword (`-z-auto`), whether
//! a key has a fraction utility (`m-1/2`), whether a sign applies to that
//! fraction (`-inset-1/2`), whether a value that is not a colour takes a
//! modifier (`m-2/50`). Whether a class is served is the project's Tailwind's
//! answer (PROJECT-RULES §4, ADR 0012), and migrate runs in Node, where that
//! Tailwind loads: `csszyx migrate` asks the oracle `csszyx check` asks and
//! hands the answers in. The table answers only a class nobody asked about,
//! and every such class is written down, so the caller can ask about it and
//! run the file again.
//!
//! An answer never makes the parser invent a reading. A class the project
//! serves where the table refused it migrates only to an sz value the
//! lowering writes back as exactly that class; otherwise it stays in
//! `className`, as it did.

use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};

use serde::Serialize;

use super::value::{ParsedClass, SzObject, SzValue};
use crate::transform::lower::{has_bare_underscore, lower_static_sz_object};
use crate::transform::{StaticSzObject, StaticSzProperty, StaticSzValue, TextSpan};

/// The project's answers, by utility as written with its sign and without
/// variants or `!`: `true` when its Tailwind serves the class.
pub type ServedAnswers = HashMap<String, bool>;

/// The project's answers about an arbitrary value's `_`.
///
/// Keyed by the value as the class writes it: the value an sz object writes,
/// each `_` the project's Tailwind reads as a space written as one and every
/// other `_` kept.
///
/// csszyx lowers a space to `_`, so both spellings write the class back; the
/// answer decides which one says what the page shows. `url(/a_b.png)` keeps
/// its `_` in Tailwind, and `bg: 'url(/a b.png)'` would name a file that is
/// not there (PROJECT-RULES §4: the project's Tailwind says so, not a table).
pub type UnderscoreAnswers = HashMap<String, String>;

/// An arbitrary value with a bare `_` that no answer covered.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnderscoreQuestion {
    /// The utility it was read from, as [`ServedAnswers`] keys a class.
    pub class: String,
    /// The value as the class writes it, as [`UnderscoreAnswers`] keys it.
    pub value: String,
    /// What was written for it: [`spaced_underscores`], so a caller tells an
    /// answer that changes the file from one that does not.
    pub reading: String,
}

/// The values read with no answer during one conversion, each once.
#[derive(Debug, Default)]
pub struct UnderscoreQuestions(RefCell<BTreeMap<String, String>>);

impl UnderscoreQuestions {
    /// The questions, sorted by value; the first class each was read from.
    #[must_use]
    pub fn into_sorted(self) -> Vec<UnderscoreQuestion> {
        self.0
            .into_inner()
            .into_iter()
            .map(|(value, class)| UnderscoreQuestion {
                class,
                reading: spaced_underscores(&value),
                value,
            })
            .collect()
    }
}

/// The value with each `_` no backslash precedes written as a space.
///
/// What an arbitrary value says when nobody asked the project. `\_` is an underscore
/// to Tailwind wherever it sits, so it stays as written. Both spellings lower
/// back to the same class.
#[must_use]
pub fn spaced_underscores(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut previous = '\0';
    for character in value.chars() {
        out.push(if character == '_' && previous != '\\' {
            ' '
        } else {
            character
        });
        previous = character;
    }
    out
}

/// A class a table decided because nobody had asked the project about it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableVerdict {
    /// The utility, as [`ServedAnswers`] keys it.
    pub class: String,
    /// What the table said: whether migrate took the class as served.
    pub served: bool,
}

/// The classes a table decided during one conversion, each once.
#[derive(Debug, Default)]
pub struct TableVerdicts(RefCell<BTreeMap<String, bool>>);

impl TableVerdicts {
    /// The verdicts, sorted by class.
    #[must_use]
    pub fn into_sorted(self) -> Vec<TableVerdict> {
        self.0
            .into_inner()
            .into_iter()
            .map(|(class, served)| TableVerdict { class, served })
            .collect()
    }
}

/// Who answers a table's question: the project, when it was asked, and the
/// table otherwise.
#[derive(Clone, Copy, Debug, Default)]
pub struct Judge<'a> {
    answers: Option<&'a ServedAnswers>,
    asked: Option<&'a TableVerdicts>,
    underscores: Option<&'a UnderscoreAnswers>,
    asked_underscores: Option<&'a UnderscoreQuestions>,
    /// The utility being read, which a question names.
    class: &'a str,
}

impl<'a> Judge<'a> {
    /// A judge with the project's answers, recording into `asked` every
    /// class it had to leave to the table.
    #[must_use]
    pub const fn new(answers: Option<&'a ServedAnswers>, asked: Option<&'a TableVerdicts>) -> Self {
        Self {
            answers,
            asked,
            underscores: None,
            asked_underscores: None,
            class: "",
        }
    }

    /// This judge, with the project's answers about `_` in arbitrary values,
    /// recording into `asked` every value it had to leave to the default.
    #[must_use]
    pub const fn with_underscores(
        self,
        answers: Option<&'a UnderscoreAnswers>,
        asked: Option<&'a UnderscoreQuestions>,
    ) -> Self {
        Self {
            underscores: answers,
            asked_underscores: asked,
            ..self
        }
    }

    /// This judge, reading `class`, which a question about its value names.
    #[must_use]
    pub const fn reading(self, class: &'a str) -> Self {
        Self { class, ..self }
    }

    /// An arbitrary value as an sz object writes it: the project's answer
    /// when there is one, [`spaced_underscores`] otherwise, written down for
    /// the caller to ask about.
    ///
    /// Cost: linear in `value`; one map lookup for a value with a bare `_`.
    #[must_use]
    pub fn spaces(self, value: &str) -> String {
        if !has_bare_underscore(value) {
            return value.to_string();
        }
        if let Some(answer) = self.underscores.and_then(|answers| answers.get(value)) {
            return answer.clone();
        }
        if let Some(asked) = self.asked_underscores {
            asked
                .0
                .borrow_mut()
                .entry(value.to_string())
                .or_insert_with(|| self.class.to_string());
        }
        spaced_underscores(value)
    }

    /// Whether `class` is served: the project's answer when there is one,
    /// `table` otherwise, written down for the caller to ask about.
    #[must_use]
    pub fn served(self, class: &str, table: bool) -> bool {
        if let Some(answer) = self.answers.and_then(|answers| answers.get(class)) {
            return *answer;
        }
        if let Some(asked) = self.asked {
            asked.0.borrow_mut().insert(class.to_string(), table);
        }
        table
    }
}

/// Whether the lowering writes `parsed` back as exactly `class`, and nothing
/// beside it.
#[must_use]
pub fn lowers_back_to(parsed: &ParsedClass, class: &str) -> bool {
    lowered_class(parsed).is_some_and(|lowered| lowered == class)
}

/// The one class the lowering writes for `parsed`; `None` when it writes
/// none or several, or the value is a kind only a resolution map supplies.
#[must_use]
pub fn lowered_class(parsed: &ParsedClass) -> Option<String> {
    let mut properties = Vec::with_capacity(2);
    for (key, value) in std::iter::once((&parsed.prop, &parsed.value))
        .chain(parsed.extra.iter().map(|extra| (&extra.prop, &extra.value)))
    {
        properties.push(StaticSzProperty {
            key: key.clone(),
            span: TextSpan { start: 0, end: 0 },
            value: static_value(value)?,
        });
    }
    let mut classes = lower_static_sz_object(&StaticSzObject { properties });
    (classes.len() == 1).then(|| classes.remove(0))
}

/// A parsed value as the lowering's IR holds it; `None` for the kinds only a
/// resolution map supplies.
fn static_value(value: &SzValue) -> Option<StaticSzValue> {
    Some(match value {
        SzValue::String(text) => StaticSzValue::String(text.clone()),
        SzValue::Number(number) => StaticSzValue::Number(*number),
        SzValue::Bool(flag) => StaticSzValue::Boolean(*flag),
        SzValue::Object(object) => StaticSzValue::Object(static_object(object)?),
        SzValue::Array(_) | SzValue::Null => return None,
    })
}

fn static_object(object: &SzObject) -> Option<StaticSzObject> {
    let properties = object
        .js_ordered()
        .map(|(key, value)| {
            Some(StaticSzProperty {
                key: key.clone(),
                span: TextSpan { start: 0, end: 0 },
                value: static_value(value)?,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    Some(StaticSzObject { properties })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unasked_value_reads_each_bare_underscore_as_a_space() {
        assert_eq!(spaced_underscores("1fr_2fr"), "1fr 2fr");
        assert_eq!(spaced_underscores("_a_"), " a ");
        // `\_` is an underscore to Tailwind, a backslash before it included.
        assert_eq!(spaced_underscores("a\\_b"), "a\\_b");
        assert_eq!(spaced_underscores("a\\\\_b"), "a\\\\_b");
        assert_eq!(spaced_underscores("é_😀"), "é 😀");
    }

    #[test]
    fn an_underscore_answer_wins_and_only_an_unanswered_value_is_written_down() {
        let answers = UnderscoreAnswers::from([("url(a_b)".to_string(), "url(a_b)".to_string())]);
        let asked = UnderscoreQuestions::default();
        let judge = Judge::default().with_underscores(Some(&answers), Some(&asked));

        assert_eq!(
            judge.reading("bg-[url(a_b)]").spaces("url(a_b)"),
            "url(a_b)"
        );
        assert_eq!(judge.reading("w-[a_b]").spaces("a_b"), "a b");
        assert_eq!(judge.reading("h-[a_b]").spaces("a_b"), "a b");
        assert_eq!(judge.reading("p-[1px]").spaces("1px"), "1px");
        assert_eq!(judge.reading("m-[a\\_b]").spaces("a\\_b"), "a\\_b");
        assert_eq!(
            asked.into_sorted(),
            [UnderscoreQuestion {
                class: "w-[a_b]".to_string(),
                value: "a_b".to_string(),
                reading: "a b".to_string(),
            }]
        );
        assert_eq!(Judge::default().spaces("a_b"), "a b");
    }

    #[test]
    fn an_answer_wins_and_only_an_unanswered_class_is_written_down() {
        let answers = ServedAnswers::from([("-m-1/2".to_string(), true)]);
        let asked = TableVerdicts::default();
        let judge = Judge::new(Some(&answers), Some(&asked));

        assert!(judge.served("-m-1/2", false));
        assert!(!judge.served("-z-auto", false));
        assert!(judge.served("-inset-1/2", true));
        assert!(judge.served("-inset-1/2", true));

        assert_eq!(
            asked.into_sorted(),
            [
                TableVerdict {
                    class: "-inset-1/2".to_string(),
                    served: true
                },
                TableVerdict {
                    class: "-z-auto".to_string(),
                    served: false
                },
            ]
        );
        assert!(Judge::default().served("w-1/2", true));
    }

    #[test]
    fn a_reading_counts_only_when_it_lowers_to_the_class_alone() {
        assert!(lowers_back_to(&ParsedClass::new("z", "-auto"), "-z-auto"));
        assert!(!lowers_back_to(&ParsedClass::new("z", "auto"), "-z-auto"));
        assert!(lowers_back_to(&ParsedClass::new("border", true), "border"));
        let mut sized = ParsedClass::new("text", "sm");
        sized.extra = Some(super::super::value::Extra {
            prop: "leading".to_string(),
            value: SzValue::Number(6.0),
        });
        assert!(lowers_back_to(&sized, "text-sm/6"));
        let mut colour = SzObject::new();
        colour.insert("color".to_string(), SzValue::from("red-500"));
        colour.insert("op".to_string(), SzValue::Number(50.0));
        assert!(lowers_back_to(
            &ParsedClass::new("bg", SzValue::Object(colour)),
            "bg-red-500/50"
        ));
        assert!(!lowers_back_to(
            &ParsedClass::new("bg", SzValue::Array(Vec::new())),
            "bg-red-500"
        ));
        let mut nested = SzObject::new();
        nested.insert("x".to_string(), SzValue::Null);
        assert!(!lowers_back_to(
            &ParsedClass::new("bg", SzValue::Object(nested)),
            "bg-red-500"
        ));
    }
}
