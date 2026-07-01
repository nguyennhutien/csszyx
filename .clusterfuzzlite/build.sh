#!/bin/bash -eu
# Build the cargo-fuzz targets and stage them for the fuzzing engine.

# cargo-fuzz needs nightly (-Z sanitizer flags), but the dependency tree (oxc
# 0.131) requires rustc >= 1.93, and the base image's bundled nightly can lag
# behind that (it shipped 1.91-nightly). Drop the repo's stable pin and install a
# current nightly so the floor is met; cargo-fuzz uses whatever nightly is default.
rm -f "$SRC/csszyx/rust-toolchain.toml"
# `install` is a no-op when a (stale) nightly already exists, so `update` to pull
# the current one, and pin via RUSTUP_TOOLCHAIN in case the image sets its own.
rustup update nightly --no-self-update
rustup component add rust-src --toolchain nightly
export RUSTUP_TOOLCHAIN=nightly

cd "$SRC/csszyx/packages/core"

# -O = release; --debug-assertions keeps overflow/precondition checks active so
# the fuzzer can surface logic bugs, not just memory errors.
cargo fuzz build -O --debug-assertions

cp fuzz/target/x86_64-unknown-linux-gnu/release/transform "$OUT/"

# Seed the fuzzer with a handful of valid sz sources so it starts from parseable
# input instead of random bytes (ClusterFuzzLite unpacks <target>_seed_corpus.zip).
zip -j "$OUT/transform_seed_corpus.zip" fuzz/seed_corpus/transform/* >/dev/null
