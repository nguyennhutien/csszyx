//! A file's spans as both artifacts hand them to JavaScript.
//!
//! The spans are what `@csszyx/compiler` places against the source — each
//! diagnostic, each list a merge would read, each class-name pair — and both
//! artifacts write them as one text from [`spans_text`]: the native binding
//! as the string `spans`, the wasm build as its result's `spans` field
//! ([`WasmResult`]). Both hand over the same text, and one decoder reads it
//! (`decodeEngineSpans` in `packages/compiler/src/engine-spans.ts`). One
//! string crosses the napi boundary per file instead of an object per group
//! and a string per class and key.
//!
//! The text is length-prefixed, every number decimal:
//!
//! ```text
//! spans     = format "," issues groups groups overrides   (merge, then one-class groups)
//! issues    = count "," { str(code) num(start) } [ str(args) ]   (args when count > 0)
//! groups    = count "," { count "," { str(key) num(key_start) str(class) } }
//! overrides = count "," { num(start) count "," { str(base) } count "," { str(over) } }
//! num(n)    = digits ","          str(s) = utf16_length(s) ":" s
//! ```
//!
//! `args` is one JSON list of every issue's args, so the reader parses JSON
//! once per file. A string is counted, never escaped: any character may
//! appear in a key or a class. Lengths count UTF-16 units, as a JavaScript
//! string does. The decoder reads it with a cursor and no `split`, which made
//! it faster to read than the same spans as JSON and allocate less.

use super::merge::{MergeGroup, MergeOverride};
use super::{Issue, TransformResult};
use serde::Serialize;
use std::cell::RefCell;

/// The format [`spans_text`] writes, its first number.
///
/// The compiler keeps its own number for what it reads
/// (`ENGINE_SPANS_FORMAT`) and refuses any other; a test holds the two equal
/// in one release. Change it with any change to the grammar.
pub const SPANS_FORMAT: u32 = 1;

/// The spans of `result` as the text both artifacts hand to JavaScript.
#[must_use]
pub fn spans_text(result: &TransformResult) -> String {
    write_spans(
        &result.issues,
        &result.merge_groups,
        &result.single_class_groups,
        &result.merge_overrides,
    )
}

thread_local! {
    /// The text being written, kept between files: its capacity is the
    /// largest file's so far, so a file's spans are written without growing
    /// a buffer and handed over as one allocation of their exact length.
    static SPANS_BUFFER: RefCell<String> = const { RefCell::new(String::new()) };
}

/// The spans as text, from each list.
///
/// `O(n)` in the bytes written.
fn write_spans(
    issues: &[Issue],
    merge_groups: &[MergeGroup],
    single_class_groups: &[MergeGroup],
    merge_overrides: &[MergeOverride],
) -> String {
    SPANS_BUFFER.with(|buffer| {
        let mut out = buffer.borrow_mut();
        out.clear();
        write_lists(
            &mut out,
            issues,
            merge_groups,
            single_class_groups,
            merge_overrides,
        );
        out.clone()
    })
}

/// Each list after the format number, onto `out`.
fn write_lists(
    out: &mut String,
    issues: &[Issue],
    merge_groups: &[MergeGroup],
    single_class_groups: &[MergeGroup],
    merge_overrides: &[MergeOverride],
) {
    write_number(out, SPANS_FORMAT);
    write_count(out, issues.len());
    for issue in issues {
        write_string(out, issue.code.as_str());
        write_number(out, issue.start);
    }
    if !issues.is_empty() {
        let mut args = String::new();
        args.push('[');
        for (index, issue) in issues.iter().enumerate() {
            if index > 0 {
                args.push(',');
            }
            args.push_str(&issue.args.to_json());
        }
        args.push(']');
        write_string(out, &args);
    }
    for groups in [merge_groups, single_class_groups] {
        write_count(out, groups.len());
        for group in groups {
            write_count(out, group.keys.len());
            for ((key, &start), class_name) in
                group.keys.iter().zip(&group.key_starts).zip(&group.classes)
            {
                write_string(out, key);
                write_number(out, start);
                write_string(out, class_name);
            }
        }
    }
    write_count(out, merge_overrides.len());
    for pair in merge_overrides {
        write_number(out, pair.start);
        write_strings(out, &pair.base);
        write_strings(out, &pair.over);
    }
}

/// `count ","` then each string.
fn write_strings(out: &mut String, strings: &[String]) {
    write_count(out, strings.len());
    for text in strings {
        write_string(out, text);
    }
}

/// `utf16_length ":" text`.
fn write_string(out: &mut String, text: &str) {
    let units = if text.is_ascii() {
        text.len()
    } else {
        text.encode_utf16().count()
    };
    write_digits(out, units);
    out.push(':');
    out.push_str(text);
}

/// A list's length as a number. A list the engine built from one file is
/// far below `u32::MAX` items.
fn write_count(out: &mut String, count: usize) {
    write_digits(out, count);
    out.push(',');
}

/// `digits ","`.
fn write_number(out: &mut String, value: u32) {
    write_digits(out, value as usize);
    out.push(',');
}

/// `value` in decimal.
fn write_digits(out: &mut String, value: usize) {
    let mut digits = [b'0'; 20];
    let mut at = digits.len();
    let mut rest = value;
    loop {
        at -= 1;
        digits[at] += u8::try_from(rest % 10).unwrap_or_default();
        rest /= 10;
        if rest == 0 {
            break;
        }
    }
    for &digit in &digits[at..] {
        out.push(char::from(digit));
    }
}

/// One result as the wasm artifact writes it: the result's own fields, then
/// its `spans`, the text [`spans_text`] writes for it.
#[derive(Serialize)]
pub struct WasmResult<'a> {
    #[serde(flatten)]
    result: &'a TransformResult,
    spans: String,
}

impl<'a> WasmResult<'a> {
    /// `result` as the wasm artifact writes it.
    #[must_use]
    pub fn new(result: &'a TransformResult) -> Self {
        Self {
            result,
            spans: spans_text(result),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{write_spans, SPANS_FORMAT};
    use crate::transform::merge::{MergeGroup, MergeOverride};
    use crate::transform::test_rng::Rng;
    use crate::transform::{Args, DiagnosticCode, Issue, DIAGNOSTIC_CODES};

    /// A second reader of the text, written from the grammar for this test:
    /// the property below holds the writer to it. Works in UTF-16 units, as
    /// the JavaScript decoder does.
    struct Reader {
        units: Vec<u16>,
        at: usize,
    }

    impl Reader {
        fn digits(&mut self, end: u16) -> usize {
            let mut value = 0;
            let mut seen = false;
            while let Some(&unit) = self.units.get(self.at) {
                self.at += 1;
                if unit == end && seen {
                    return value;
                }
                assert!(
                    (u16::from(b'0')..=u16::from(b'9')).contains(&unit),
                    "digit at {}",
                    self.at
                );
                value = value * 10 + usize::from(unit - u16::from(b'0'));
                seen = true;
            }
            panic!("text ends inside a number");
        }

        fn number(&mut self) -> usize {
            self.digits(u16::from(b','))
        }

        fn string(&mut self) -> String {
            let length = self.digits(u16::from(b':'));
            let text = String::from_utf16(&self.units[self.at..self.at + length]).expect("utf16");
            self.at += length;
            text
        }

        fn strings(&mut self) -> Vec<String> {
            (0..self.number()).map(|_| self.string()).collect()
        }

        fn groups(&mut self) -> Vec<(Vec<String>, Vec<usize>, Vec<String>)> {
            (0..self.number())
                .map(|_| {
                    let mut group = (Vec::new(), Vec::new(), Vec::new());
                    for _ in 0..self.number() {
                        group.0.push(self.string());
                        group.1.push(self.number());
                        group.2.push(self.string());
                    }
                    group
                })
                .collect()
        }
    }

    /// The text read back: format, issues (code, start, args JSON), both
    /// group lists and the pairs.
    type Read = (
        usize,
        Vec<(String, usize, serde_json::Value)>,
        Vec<(Vec<String>, Vec<usize>, Vec<String>)>,
        Vec<(Vec<String>, Vec<usize>, Vec<String>)>,
        Vec<(usize, Vec<String>, Vec<String>)>,
    );

    fn read(text: &str) -> Read {
        let mut reader = Reader {
            units: text.encode_utf16().collect(),
            at: 0,
        };
        let format = reader.number();
        let mut issues: Vec<(String, usize, serde_json::Value)> = (0..reader.number())
            .map(|_| (reader.string(), reader.number(), serde_json::Value::Null))
            .collect();
        if !issues.is_empty() {
            let args: Vec<serde_json::Value> =
                serde_json::from_str(&reader.string()).expect("args JSON");
            assert_eq!(args.len(), issues.len());
            for (issue, args) in issues.iter_mut().zip(args) {
                issue.2 = args;
            }
        }
        let merge_groups = reader.groups();
        let single_class_groups = reader.groups();
        let pairs = (0..reader.number())
            .map(|_| (reader.number(), reader.strings(), reader.strings()))
            .collect();
        assert_eq!(reader.at, reader.units.len(), "text after the last list");
        (format, issues, merge_groups, single_class_groups, pairs)
    }

    /// What `read` should give back for the lists written.
    fn expected(
        issues: &[Issue],
        merge_groups: &[MergeGroup],
        single_class_groups: &[MergeGroup],
        merge_overrides: &[MergeOverride],
    ) -> Read {
        let group = |group: &MergeGroup| {
            (
                group.keys.clone(),
                group
                    .key_starts
                    .iter()
                    .map(|&start| start as usize)
                    .collect(),
                group.classes.clone(),
            )
        };
        (
            SPANS_FORMAT as usize,
            issues
                .iter()
                .map(|issue| {
                    (
                        issue.code.as_str().to_string(),
                        issue.start as usize,
                        serde_json::from_str(&issue.args.to_json()).expect("args"),
                    )
                })
                .collect(),
            merge_groups.iter().map(group).collect(),
            single_class_groups.iter().map(group).collect(),
            merge_overrides
                .iter()
                .map(|pair| (pair.start as usize, pair.base.clone(), pair.over.clone()))
                .collect(),
        )
    }

    /// Characters the grammar gives a meaning to, ones JSON escapes, and
    /// one-, two-, three- and four-byte UTF-8.
    const ALPHABET: [&str; 16] = [
        "a", "p", "-", "4", "0", ":", ",", "\"", "'", "\\", "\u{0}", "\u{1f}", "é", "日", "😀", " ",
    ];

    fn text(rng: &mut Rng) -> String {
        let length = if rng.below(8) == 0 {
            rng.below(300)
        } else {
            rng.below(8)
        };
        (0..length).map(|_| *rng.pick(&ALPHABET)).collect()
    }

    fn offset(rng: &mut Rng) -> u32 {
        let any = rng.next_u32();
        *rng.pick(&[0, 1, 9, 10, 99, u32::MAX, any])
    }

    fn group(rng: &mut Rng) -> MergeGroup {
        let len = rng.below(5);
        MergeGroup {
            keys: (0..len).map(|_| text(rng)).collect(),
            key_starts: (0..len).map(|_| offset(rng)).collect(),
            classes: (0..len).map(|_| text(rng)).collect(),
        }
    }

    /// Whatever the lists hold, the text reads back to them.
    #[test]
    fn the_text_reads_back_to_every_list_written() {
        let mut rng = Rng::new(0x5eed_05a1);
        for case in 0..2000 {
            let issues: Vec<Issue> = (0..rng.below(4))
                .map(|_| Issue {
                    code: *rng.pick(&DIAGNOSTIC_CODES),
                    start: offset(&mut rng),
                    args: if rng.below(3) == 0 {
                        Args::default()
                    } else {
                        Args::default()
                            .text("key", &text(&mut rng))
                            .count("count", u64::from(rng.next_u32()))
                            .list("list", (0..rng.below(3)).map(|_| text(&mut rng)).collect())
                    },
                })
                .collect();
            let merge_groups: Vec<MergeGroup> =
                (0..rng.below(4)).map(|_| group(&mut rng)).collect();
            let single_class_groups: Vec<MergeGroup> =
                (0..rng.below(3)).map(|_| group(&mut rng)).collect();
            let merge_overrides: Vec<MergeOverride> = (0..rng.below(3))
                .map(|_| MergeOverride {
                    start: offset(&mut rng),
                    base: (0..rng.below(4)).map(|_| text(&mut rng)).collect(),
                    over: (0..rng.below(4)).map(|_| text(&mut rng)).collect(),
                })
                .collect();
            let text = write_spans(
                &issues,
                &merge_groups,
                &single_class_groups,
                &merge_overrides,
            );
            assert_eq!(
                read(&text),
                expected(
                    &issues,
                    &merge_groups,
                    &single_class_groups,
                    &merge_overrides
                ),
                "case {case}: {text:?}"
            );
        }
    }

    /// A file with nothing to report is its format and four empty lists.
    #[test]
    fn a_file_with_nothing_to_report_is_four_empty_lists() {
        assert_eq!(
            write_spans(&[], &[], &[], &[]),
            format!("{SPANS_FORMAT},0,0,0,0,")
        );
    }

    /// A length counts UTF-16 units: an astral character is two.
    #[test]
    fn a_length_counts_utf16_units() {
        let pair = MergeOverride {
            start: 7,
            base: vec!["é😀".to_string(), String::new()],
            over: vec!["a:1,".to_string()],
        };
        assert_eq!(
            write_spans(&[], &[], &[], &[pair]),
            format!("{SPANS_FORMAT},0,0,0,1,7,2,3:é😀0:1,4:a:1,")
        );
    }

    /// Every issue's args are one JSON list, after the codes and offsets.
    #[test]
    fn the_args_of_every_issue_are_one_json_list() {
        let issues = [
            Issue {
                code: DiagnosticCode::UnknownKey,
                start: 3,
                args: Args::default().text("key", "wrok"),
            },
            Issue {
                code: DiagnosticCode::UnknownKey,
                start: 12,
                args: Args::default(),
            },
        ];
        assert_eq!(
            write_spans(&issues, &[], &[], &[]),
            format!(
                "{SPANS_FORMAT},2,11:unknown-key3,11:unknown-key12,19:[{{\"key\":\"wrok\"}},{{}}]0,0,0,"
            )
        );
    }

    #[cfg(feature = "native-engine")]
    mod engine {
        use super::super::{spans_text, WasmResult, SPANS_FORMAT};
        use crate::transform::{transform_batch_with_options, TransformFile, TransformOptions};

        fn run(source: &str) -> crate::TransformResult {
            let file = TransformFile {
                filename: "/repo/src/A.tsx".to_string(),
                source: source.to_string(),
            };
            let mut results = transform_batch_with_options(
                std::slice::from_ref(&file),
                TransformOptions::default(),
            )
            .expect("engine");
            results.remove(0)
        }

        #[test]
        fn the_spans_of_a_file_are_one_length_prefixed_text() {
            // Multi-byte text before the keys: offsets count bytes.
            let source = "const t = 'é — 😀';\nexport const A = () => <div sz={{ pb: 2, 'p': 4, wrokBreak: 1 }} />;";
            let result = run(source);
            let at = |marker: &str| source.find(marker).unwrap();
            let args = format!("[{}]", result.issues[0].args.to_json());
            assert_eq!(
                spans_text(&result),
                format!(
                    "{SPANS_FORMAT},1,11:unknown-key{},{}:{args}1,3,2:pb{},4:pb-21:p{},3:p-49:wrokBreak{},12:wrok-break-10,0,",
                    result.issues[0].start,
                    args.encode_utf16().count(),
                    at("pb"),
                    at("'p'"),
                    at("wrokBreak"),
                )
            );
        }

        #[test]
        fn a_wasm_result_carries_the_text_the_binding_returns() {
            let source = "const App = () => <div className=\"card pb-2\" sz={{ p: 4, m: 1 }} />;";
            let result = run(source);
            let text = spans_text(&result);
            assert!(text.ends_with(",1,23,2,4:card4:pb-22,3:p-43:m-1"), "{text}");
            let written = serde_json::to_string(&WasmResult::new(&result)).unwrap();
            let value: serde_json::Value = serde_json::from_str(&written).unwrap();
            assert_eq!(value["spans"], serde_json::Value::String(text));
            for field in [
                "issues",
                "merge_groups",
                "single_class_groups",
                "merge_overrides",
            ] {
                assert!(value.get(field).is_none(), "{field} is written twice");
            }
        }
    }
}
