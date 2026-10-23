//! Placing `szRecover` elements: where each token says it is, and what placing
//! them costs as a file grows.
//!
//! Each element's recovery token hashes the line and column its attribute is
//! written on, and both the token list and the rewrite place every element.
//! The tokens are part of the output, so a change to how they are placed must
//! leave every one byte-identical; and the cost has to grow with the file, not
//! with the file times its elements, up to the most elements a file under the
//! AST budget can hold.
#![cfg(feature = "native-engine")]

use std::time::{Duration, Instant};

use csszyx_core::transform::{transform_batch, TransformFile, TransformResult};

fn run(file: &TransformFile) -> TransformResult {
    transform_batch(std::slice::from_ref(file))
        .expect("transform")
        .remove(0)
}

/// Elements after multibyte text, a CRLF line and a tab, two on one line.
fn mixed() -> TransformFile {
    TransformFile {
        filename: "/repo/src/Mixed.tsx".to_string(),
        source: concat!(
            "// Thẻ hiển thị 👋 người dùng\r\n",
            "export const Mixed = () => (\n",
            "  <section szRecover=\"csr\">\n",
            "\t<p>日本語</p><span szRecover=\"dev-only\" sz={{ p: 2 }}>é</span>\n",
            "    <Card.Body szRecover=\"csr\" />\n",
            "  </section>\n",
            ");\n",
        )
        .to_string(),
    }
}

/// Pinned before the placing changed: the column counts UTF-8 bytes from 0,
/// so `日本語` is nine and the tab one, and a token moves if that does.
#[test]
fn each_token_hashes_its_own_line_and_byte_column() {
    let result = run(&mixed());
    let placed: Vec<(&str, &str)> = result
        .recovery_tokens
        .iter()
        .map(|token| (token.token.as_str(), token.path.as_str()))
        .collect();
    assert_eq!(
        placed,
        [
            ("24d7acd6fbb3", "/repo/src/Mixed.tsx:3:11"),
            ("243077443c6a", "/repo/src/Mixed.tsx:4:23"),
            ("54858dbdfc95", "/repo/src/Mixed.tsx:5:15"),
        ]
    );
    for (token, _) in placed {
        assert!(
            result
                .code
                .contains(&format!("data-sz-recovery-token=\"{token}\"")),
            "the rewrite carries {token}: {}",
            result.code
        );
    }
}

/// A component of `rows` recovered elements, one per line.
fn page(rows: usize) -> TransformFile {
    let body = (0..rows)
        .map(|row| {
            format!(
                "    <li szRecover=\"csr\" sz={{{{ p: {} }}}}>row {row}</li>",
                row % 8
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    TransformFile {
        filename: "/repo/src/List.tsx".to_string(),
        source: format!("export const List = () => (\n  <ul>\n{body}\n  </ul>\n);\n"),
    }
}

fn timed(file: &TransformFile, rows: usize) -> Duration {
    let started = Instant::now();
    let result = run(file);
    let elapsed = started.elapsed();
    assert_eq!(result.recovery_tokens.len(), rows);
    elapsed
}

/// A relation between two sizes in one run, not a time (tdd.md TDD-6): ten
/// times the elements in ten times the source costs about ten times as much
/// when each is placed by a lookup, and about a hundred when each is placed by
/// scanning the source before it (70x measured on that code, debug build).
/// The fastest of three interleaved runs per size, so a slow stretch of the
/// runner falls on both.
#[test]
fn placing_recovered_elements_grows_with_the_file() {
    let (small, large) = (page(200), page(2000));
    let (mut small_best, mut large_best) = (Duration::MAX, Duration::MAX);
    for _ in 0..3 {
        small_best = small_best.min(timed(&small, 200));
        large_best = large_best.min(timed(&large, 2000));
    }
    let ratio = large_best.as_secs_f64() / small_best.as_secs_f64();
    assert!(
        ratio < 30.0,
        "10x the elements cost {ratio:.1}x ({small_best:?} -> {large_best:?}); linear is about 10x"
    );
}
