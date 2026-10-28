//! The class-level migrate questions, as JSON in and JSON out.
//!
//! `migrateBatch` and `migrateHtml` answer for a whole file, which is what
//! the CLI needs and what napi carries as typed objects. The corpus
//! round-trip, the per-key matrix and the sz golden ask a different question
//! — what does THIS class become — with no source file around it, and they
//! ask it from JavaScript.
//!
//! The answer crosses as JSON rather than as a napi object because an sz
//! value is recursive and order-sensitive: `serde_json` already writes the
//! shape the generators compare against, and a hand-built napi mirror of it
//! would be a second encoding to keep in step.

use super::variant_parser::{class_name_to_sz_object_with, Conversion, Lookup};
use super::verdict::{Judge, ServedAnswers, TableVerdict, TableVerdicts};
use super::{parse_class, SzObject};

/// Decode a payload, naming the field that would not parse.
fn decode<T: serde::de::DeserializeOwned>(what: &str, text: &str) -> Result<T, String> {
    serde_json::from_str(text)
        .map_err(|error| format!("{what} is not the JSON migrate expects: {error}"))
}

/// Encode a payload.
fn encode<T: serde::Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value)
        .map_err(|error| format!("migrate could not encode its answer: {error}"))
}

/// A conversion, with the classes one of migrate's tables decided because
/// the project's Tailwind had not been asked about them.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct JudgedConversion {
    #[serde(flatten)]
    conversion: Conversion,
    /// Each class once, sorted; left out when there is none, as the file
    /// entry points leave `stats.tableVerdicts` out.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    table_verdicts: Vec<TableVerdict>,
}

/// Convert one whole `className` attribute to an sz object.
///
/// The class-level question the file-level entry points cannot answer: the
/// corpus round-trip, the per-key matrix and the sz golden all ask what a
/// class becomes, with no source file around it, and the MCP `reverse` tool
/// asks it for an assistant. `served` carries the project's Tailwind answers
/// as `migrate` asks them; a class a table decides without one is named in
/// `tableVerdicts`, so the caller can ask and convert again.
///
/// Cost: one hash lookup per class a table would decide, on top of the
/// conversion itself, which is linear in the tokens of `class_name`.
///
/// # Errors
///
/// Returns the decode message when the resolution map is not a JSON object.
pub fn migrate_class_name(
    class_name: &str,
    custom_map_json: Option<&str>,
    served: Option<&ServedAnswers>,
) -> Result<String, String> {
    let custom_map: Option<SzObject> = custom_map_json
        .map(|text| decode("the resolution map", text))
        .transpose()?;
    let asked = TableVerdicts::default();
    let conversion = class_name_to_sz_object_with(
        class_name,
        Lookup {
            custom_map: custom_map.as_ref(),
            judge: Judge::new(served, Some(&asked)),
        },
    );
    encode(&JudgedConversion {
        conversion,
        table_verdicts: asked.into_sorted(),
    })
}

/// Read one Tailwind utility as an sz prop and value, encoded as `null` when
/// the parser does not know it.
///
/// # Errors
///
/// Returns the encode message, which a parsed class cannot produce.
pub fn migrate_parse_class(class: &str) -> Result<String, String> {
    encode(&parse_class(class))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrate::verdict::ServedAnswers;

    fn json(text: &str) -> serde_json::Value {
        serde_json::from_str(text).expect("the answer is JSON")
    }

    #[test]
    fn migrate_class_name_answers_the_whole_attribute() {
        let value = json(
            &migrate_class_name("p-4 not-a-tailwind-class", None, None).expect("the class parses"),
        );

        assert_eq!(value["szObject"]["p"], 4);
        assert_eq!(value["unrecognized"][0], "not-a-tailwind-class");
        assert!(value["keepInClassName"].as_array().unwrap().is_empty());
    }

    #[test]
    fn migrate_class_name_reads_a_resolution_map_and_names_a_bad_one() {
        let value = json(
            &migrate_class_name("btn", Some(r#"{"btn":{"p":4}}"#), None).expect("the map answers"),
        );
        assert_eq!(value["szObject"]["p"], 4);
        assert!(value["unrecognized"].as_array().unwrap().is_empty());

        assert!(migrate_class_name("btn", Some("not json"), None)
            .unwrap_err()
            .starts_with("the resolution map is not the JSON migrate expects"));
    }

    #[test]
    fn migrate_class_name_names_the_classes_a_table_decided_and_takes_the_projects_answer() {
        // Unasked: the table refuses `-z-auto`, and says it decided.
        let value =
            json(&migrate_class_name("p-4 -z-auto", None, None).expect("the classes parse"));
        assert_eq!(value["szObject"], serde_json::json!({ "p": 4 }));
        assert_eq!(value["unrecognized"], serde_json::json!(["-z-auto"]));
        assert_eq!(
            value["tableVerdicts"],
            serde_json::json!([{ "class": "-z-auto", "served": false }])
        );

        // The project serves it: it migrates, and nothing is left to ask.
        let served: ServedAnswers = [("-z-auto".to_string(), true)].into_iter().collect();
        let value = json(
            &migrate_class_name("p-4 -z-auto", None, Some(&served)).expect("the classes parse"),
        );
        assert_eq!(
            value["szObject"],
            serde_json::json!({ "p": 4, "z": "-auto" })
        );
        assert!(value["unrecognized"].as_array().unwrap().is_empty());
        assert!(value.get("tableVerdicts").is_none(), "{value}");
    }

    #[test]
    fn migrate_parse_class_answers_one_class_and_says_when_it_cannot() {
        let value = json(&migrate_parse_class("p-4").expect("the class parses"));
        assert_eq!(value["prop"], "p");
        assert_eq!(value["value"], 4);

        assert_eq!(
            migrate_parse_class("not-a-tailwind-class").expect("an unknown class encodes"),
            "null"
        );
    }
}
