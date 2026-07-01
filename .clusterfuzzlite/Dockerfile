# ClusterFuzzLite / OSS-Fuzz build image for the native transform engine.
# base-builder-rust ships a nightly toolchain plus cargo-fuzz preinstalled.
FROM gcr.io/oss-fuzz-base/base-builder-rust

COPY . $SRC/csszyx
WORKDIR $SRC/csszyx
COPY .clusterfuzzlite/build.sh $SRC/build.sh
