# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Mangle map checksum algorithm (SHA-256, O(n log n)) for SSR/CSR integrity verification.
- Color opacity support in transformer (e.g., `bg-red-500/50`).
- Whole number formatting in transformer (removes `.0` suffix for integers).

### Fixed

- Negative value handling in transformer (e.g., `m: -4` now correctly outputs `-m-4` instead of `-m--4`).

### Performance

- 10-15x speedup over JavaScript for checksum computation.
- Optimized WASM binary size with `wasm-opt`.
