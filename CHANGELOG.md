# Changelog

## v0.1.0 (2026-02-12)

First public release of **csszyx** - The Zero-Runtime Generic CSS-in-JS Library.

### 🚀 Core Features

- **Zero-Runtime Overhead**: Compiler pre-processes styles into static CSS.
- **Universal Framework Support**: Works with React, Vue, Svelte, and vanilla JS via generic adapters.
- **TypeScript First**: Full type safety for styles and configuration.
- **Atomic CSS Engine**: Generates minimal, atomic CSS classes.
- **Smart Mangling**: Advanced class name mangling (Tier 1-5) for smallest possible HTML size.
- **SSR Hydration Safety**: SHA-256 checksum verification to prevent hydration mismatches.

### ✨ Key Capabilities

- **CSS Variable Auto-Compile**: Automatically converts static values to CSS variables where appropriate.
- **Color Opacity**: Support for color opacity using object syntax (e.g., `{ color: { value: 'red', opacity: 0.5 } }`).
- **Debug Helper**: `__csszyx` global helper for runtime inspection.
- **Mangle Pipeline**: Efficient `z->y->x` class name generation strategy.
- **Vite Integration**: Seamless integration with Vite via `@csszyx/unplugin`.

### 📦 Packages

- `csszyx`: Main entry point (umbrella package).
- `@csszyx/compiler`: Core transformation logic.
- `@csszyx/runtime`: Runtime helpers and hydration guards.
- `@csszyx/unplugin`: Build tool integration (Vite, Webpack, etc.).
- `@csszyx/cli`: Project initialization and diagnostics CLI.
