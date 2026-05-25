//! Build script — sets platform-specific linker flags for napi-rs native addon.
#![allow(missing_docs, clippy::missing_docs_in_private_items, clippy::cargo)]

fn main() {
    if std::env::var("CARGO_FEATURE_NATIVE").is_ok()
        && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos")
    {
        println!("cargo:rustc-cdylib-link-arg=-undefined");
        println!("cargo:rustc-cdylib-link-arg=dynamic_lookup");
    }
}
