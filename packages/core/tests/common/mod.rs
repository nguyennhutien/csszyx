//! Shared corpus IO for the migrate golden harnesses.
//!
//! Both harnesses read a megabyte-scale fixture and one of them writes it
//! back, and the reasons for how are the same on both sides — so they live
//! here rather than in two copies that can drift apart.

/// Read a corpus at run time rather than `include_str!`.
///
/// These files are megabytes. Embedding them puts the whole text in the test
/// binary as a literal, which rustc then carries through codegen with full
/// debug info — several test binaries compile at once, and on a 16 GB machine
/// that was enough to push the whole `cargo test` compile into swap. Reading
/// the file costs a syscall and keeps the binary small.
pub fn read_corpus(name: &str) -> String {
    let path = corpus_path(name);
    std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("reading {path}: {error}"))
}

/// Write a corpus back in the formatting the committed file already uses.
///
/// One-space indent and a trailing newline, so a re-baseline diffs as the
/// answers that moved rather than as the whole file reflowed. Serde writes a
/// struct's fields in declaration order, which is why the harness structs
/// declare them in the order the file has them.
pub fn write_corpus<T: serde::Serialize>(name: &str, value: &T) {
    let mut out = Vec::new();
    let mut serializer = serde_json::Serializer::with_formatter(
        &mut out,
        serde_json::ser::PrettyFormatter::with_indent(b" "),
    );
    value
        .serialize(&mut serializer)
        .unwrap_or_else(|error| panic!("encoding {name}: {error}"));
    out.push(b'\n');
    let path = corpus_path(name);
    std::fs::write(&path, out).unwrap_or_else(|error| panic!("writing {path}: {error}"));
}

fn corpus_path(name: &str) -> String {
    format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))
}
