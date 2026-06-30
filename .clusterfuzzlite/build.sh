#!/bin/bash -eu
# Build the cargo-fuzz targets and stage them for the fuzzing engine.

# The repo pins stable Rust via rust-toolchain.toml, but cargo-fuzz needs the
# nightly toolchain (and -Z sanitizer flags) the base image ships. Drop the pin
# inside this build copy so rustup uses the image default; the repo is untouched.
rm -f "$SRC/csszyx/rust-toolchain.toml"

cd "$SRC/csszyx/packages/core"

# -O = release; --debug-assertions keeps overflow/precondition checks active so
# the fuzzer can surface logic bugs, not just memory errors.
cargo fuzz build -O --debug-assertions

cp fuzz/target/x86_64-unknown-linux-gnu/release/transform "$OUT/"

# Seed the fuzzer with a handful of valid sz sources so it starts from parseable
# input instead of random bytes (ClusterFuzzLite unpacks <target>_seed_corpus.zip).
zip -j "$OUT/transform_seed_corpus.zip" fuzz/seed_corpus/transform/* >/dev/null
