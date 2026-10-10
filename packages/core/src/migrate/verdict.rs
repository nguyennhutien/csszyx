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
use crate::transform::lower::lower_static_sz_object;
use crate::transform::{StaticSzObject, StaticSzProperty, StaticSzValue, TextSpan};

/// The project's answers, by utility as written with its sign and without
/// variants or `!`: `true` when its Tailwind serves the class.
pub type ServedAnswers = HashMap<String, bool>;

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
}

impl<'a> Judge<'a> {
    /// A judge with the project's answers, recording into `asked` every
    /// class it had to leave to the table.
    #[must_use]
    pub const fn new(answers: Option<&'a ServedAnswers>, asked: Option<&'a TableVerdicts>) -> Self {
        Self { answers, asked }
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
