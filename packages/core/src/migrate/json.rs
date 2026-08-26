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

use super::{class_name_to_sz_object, parse_class, SzObject};

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

/// Convert one whole `className` attribute to an sz object.
///
/// The class-level question the file-level entry points cannot answer: the
/// corpus round-trip, the per-key matrix and the sz golden all ask what a
/// class becomes, with no source file around it.
///
/// # Errors
///
/// Returns the decode message when the resolution map is not a JSON object.
pub fn migrate_class_name(
    class_name: &str,
    custom_map_json: Option<&str>,
) -> Result<String, String> {
    let custom_map: Option<SzObject> = custom_map_json
        .map(|text| decode("the resolution map", text))
        .transpose()?;
    encode(&class_name_to_sz_object(class_name, custom_map.as_ref()))
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

    fn json(text: &str) -> serde_json::Value {
        serde_json::from_str(text).expect("the answer is JSON")
    }

    #[test]
    fn migrate_class_name_answers_the_whole_attribute() {
        let value =
            json(&migrate_class_name("p-4 not-a-tailwind-class", None).expect("the class parses"));

        assert_eq!(value["szObject"]["p"], 4);
        assert_eq!(value["unrecognized"][0], "not-a-tailwind-class");
        assert!(value["keepInClassName"].as_array().unwrap().is_empty());
    }

    #[test]
    fn migrate_class_name_reads_a_resolution_map_and_names_a_bad_one() {
        let value =
            json(&migrate_class_name("btn", Some(r#"{"btn":{"p":4}}"#)).expect("the map answers"));
        assert_eq!(value["szObject"]["p"], 4);
        assert!(value["unrecognized"].as_array().unwrap().is_empty());

        assert!(migrate_class_name("btn", Some("not json"))
            .unwrap_err()
            .starts_with("the resolution map is not the JSON migrate expects"));
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
