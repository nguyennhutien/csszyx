//! Build script — sets platform-specific linker flags for the napi-rs native
//! addon, and compiles in the engine's identity: the version of
//! `@csszyx/core` it ships as and the digest of the source it was built from.
//!
//! `@csszyx/compiler` refuses an engine whose identity differs from the one it
//! was built against, so a compiler can never run silently on an engine from
//! another release or another commit. The digest MUST stay the algorithm of
//! `scripts/engine-digest.mjs`; `scripts/build-tests/engine-digest.test.mjs`
//! compares the two.
#![allow(missing_docs, clippy::missing_docs_in_private_items, clippy::cargo)]

use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

fn main() {
    if std::env::var("CARGO_FEATURE_NATIVE").is_ok()
        && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos")
    {
        println!("cargo:rustc-cdylib-link-arg=-undefined");
        println!("cargo:rustc-cdylib-link-arg=dynamic_lookup");
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repository = manifest_dir.join("../..");
    println!(
        "cargo:rustc-env=CSSZYX_ENGINE_VERSION={}",
        package_version(&manifest_dir.join("package.json"))
    );
    println!(
        "cargo:rustc-env=CSSZYX_ENGINE_DIGEST={}",
        engine_digest(&repository)
    );
    for watched in ["package.json", "src", "Cargo.toml", "../../Cargo.lock"] {
        println!("cargo:rerun-if-changed={watched}");
    }
}

/// The `version` field of `@csszyx/core`'s manifest.
fn package_version(manifest: &Path) -> String {
    let text = fs::read_to_string(manifest).expect("packages/core/package.json is readable");
    let value: serde_json::Value =
        serde_json::from_str(&text).expect("packages/core/package.json is JSON");
    value["version"]
        .as_str()
        .expect("packages/core/package.json has a version")
        .to_string()
}

/// Every Rust file under `directory`, repository-relative with `/`, leaving
/// out names that start with a dot (a `.DS_Store`, an editor's `.#lock.rs`):
/// turbo ignores them, so they must not move the digest either.
fn rust_files_under(repository: &Path, directory: &str, found: &mut Vec<String>) {
    let mut entries: Vec<_> = fs::read_dir(repository.join(directory))
        .expect("the engine source is readable")
        .map(|entry| entry.expect("a directory entry").file_name())
        .collect();
    entries.sort();
    for name in entries {
        let name = name.to_string_lossy();
        if name.starts_with('.') {
            continue;
        }
        let relative = format!("{directory}/{name}");
        if repository.join(&relative).is_dir() {
            rust_files_under(repository, &relative, found);
        } else if name.ends_with(".rs") {
            found.push(relative);
        }
    }
}

/// The digest of the engine's source; see `scripts/engine-digest.mjs`.
fn engine_digest(repository: &Path) -> String {
    let mut files = Vec::new();
    rust_files_under(repository, "packages/core/src", &mut files);
    files.push("packages/core/Cargo.toml".to_string());
    files.push("Cargo.lock".to_string());
    files.sort();
    let mut hash = Sha256::new();
    for file in files {
        let bytes = fs::read(repository.join(&file)).expect("an engine source file is readable");
        hash.update(file.as_bytes());
        hash.update([0]);
        hash.update(normalise_line_ends(&bytes));
        hash.update([0]);
    }
    hex::encode(hash.finalize())[..16].to_string()
}

/// `bytes` with every CRLF read as LF, so a Windows checkout digests the same.
fn normalise_line_ends(bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'\r' && bytes.get(index + 1) == Some(&b'\n') {
            index += 1;
            continue;
        }
        out.push(bytes[index]);
        index += 1;
    }
    out
}
