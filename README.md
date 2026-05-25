# CSSzyx

CSS-in-JS framework for the AI era — Tailwind-v4 object syntax, build-time class mangling, and SSR-safe hydration.

> **Pronunciation:** "css-zyx". Class names are encoded in reversed tier order `z → y → x → … → A` for maximum compression of the most common utilities.

[![npm version](https://img.shields.io/npm/v/csszyx.svg)](https://www.npmjs.com/package/csszyx)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI](https://img.shields.io/github/actions/workflow/status/nguyennhutien/csszyx/ci.yml?branch=main)](https://github.com/nguyennhutien/csszyx/actions/workflows/ci.yml)

## Quick Start

Install:

```bash
pnpm add -D csszyx
```

Wire the plugin (Vite shown — Webpack, esbuild, Rollup, Next.js all supported via `@csszyx/unplugin`):

```ts
// vite.config.ts
import { defineConfig } from "vite";
import csszyx from "csszyx/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [...csszyx(), tailwindcss(), react()],
});
```

Use the `sz` prop in your components:

```tsx
<div sz={{ p: 4, bg: "red-500", hover: { bg: "blue-600" } }} />
```

At build time, the plugin transforms `sz` to `className`, lets Tailwind JIT emit CSS, then mangles both together:

```html
<div class="z y" />
<style>
  .z{padding:1rem}.y{background:#ef4444}...
</style>
```

Full walkthrough: <https://csszyx.com>

## Features

- **Type-safe `sz` prop** — full TypeScript autocomplete for every Tailwind v4 utility and variant
- **Class-name mangling** — reversed-tier encoding (`p-4` → `z`, `bg-red-500` → `y`) drives ~40% bundle reduction on typical apps
- **SSR-safe hydration** — SHA-256 checksum validation detects mangle-map mismatch between server and client and preserves server HTML
- **Zero-runtime static path** — fully-static `sz` objects compile to string literals; dynamic objects stay light (5ns zero-alloc for 0–4 keys)
- **Arbitrary CSS via `css: {}`** — escape hatch for properties Tailwind doesn't cover
- **Container queries & `:has()`** — first-class support via `container` and `has` variants
- **Variant nesting** — `hover`, `md`, `dark`, `group-hover/name`, `peer-*`, `data-*`, `aria-*`, `supports-*`
- **Runtime injection (`@csszyx/dynamic`)** — inject styles from API/CMS data at runtime; SSR-safe
- **Migration CLI (`@csszyx/cli`)** — convert existing Tailwind `className="..."` to `sz={...}` props
- **MCP server (`@csszyx/mcp-server`)** — expose sz spec + compiler to AI agents (Cursor, Claude Code, etc.)
- **VS Code extension** — IntelliSense, hover previews, and diagnostics inside `sz={{...}}` (in the Marketplace)

**Tailwind CSS v4 only.** v3 support is not implemented yet.

## Platform Support

| Platform            | Status           | Via                        |
| ------------------- | ---------------- | -------------------------- |
| React + Vite        | Production-ready | `csszyx/vite`              |
| Next.js (SSR + RSC) | Production-ready | `@csszyx/unplugin/webpack` |
| esbuild / Rollup    | Supported        | `@csszyx/unplugin`         |
| Vue 3               | Experimental     | `@csszyx/vue-adapter`      |
| Svelte 4/5          | Experimental     | `@csszyx/svelte-adapter`   |

## Packages

| Package                  | Description                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `csszyx`                 | Umbrella — re-exports all; provides `csszyx/vite`, `csszyx/webpack`, `csszyx/lite` |
| `@csszyx/compiler`       | `sz` object → Tailwind className transform (TypeScript)                            |
| `@csszyx/runtime`        | `_sz`, `_szIf`, `_szSwitch`, `_szMerge` + SSR hydration validator                  |
| `@csszyx/core`           | Rust/WASM core: encoder, SHA-256 checksum, collision detection                     |
| `@csszyx/unplugin`       | Build plugin — Vite + Webpack + esbuild + Rollup + Next.js                         |
| `@csszyx/dynamic`        | Runtime CSS injection for API/CMS-driven styling                                   |
| `@csszyx/cli`            | Migration CLI (Tailwind → `sz`) + type generator                                   |
| `@csszyx/vars`           | CSS custom-property helpers (`applySzVars`, React `useSzVars`)                     |
| `@csszyx/mcp-server`     | Model Context Protocol server for AI agents                                        |
| `@csszyx/vscode`         | VS Code extension — IntelliSense, hover, diagnostics                               |
| `@csszyx/types`          | Shared TypeScript types + `CsszyxConfig`                                           |
| `@csszyx/vue-adapter`    | Vue SFC support (experimental)                                                     |
| `@csszyx/svelte-adapter` | Svelte support (experimental)                                                      |

## Examples

**Responsive + variants:**

```tsx
<button
  sz={{
    p: 2,
    bg: "blue-500",
    rounded: "lg",
    hover: { bg: "blue-600" },
    md: { p: 4 },
  }}
>
  Click me
</button>
```

**Runtime helpers:**

```tsx
import { _sz, _szIf } from "@csszyx/runtime";

<div className={_sz("base", _szIf(isActive, "active", "inactive"))} />;
```

**Dynamic (runtime-injected styles):**

```tsx
import { dynamic } from "@csszyx/dynamic";

const cls = dynamic({ p: 4, bg: "blue-500" }); // injects CSS if not already in bundle
<div className={cls} />;
```

**Merging with existing `className` (`sz` wins conflicts, rest preserved):**

```tsx
<div className="mb-4 text-lg" sz={{ mb: 2 }} />
// → className="text-lg mb-2"
```

## Debugging

In development the plugin attaches a debug helper to `window`:

```ts
window.__csszyx.decode("z"); // → 'p-4'
window.__csszyx.encode("p-4"); // → 'z'
window.__csszyx.decodeAll(element); // → ['p-4', 'bg-red-500']
window.__csszyx.mangleMap; // full map
window.__csszyx.checksum; // SHA-256 hex
```

## Documentation

- **Docs site:** <https://csszyx.com> — installation, sz props, variants, SSR, migration, `@csszyx/dynamic`, MCP server, VS Code extension
- **llms.txt / llms-full.txt:** generated for Cursor, Claude, and other AI tools — see `apps/docs/public/`

## Project Status

- **Version:** 0.9.0 (pre-release)
- **Tests:** 2479 unit (vitest) + 34 E2E (Playwright) across 14 workspace packages
- **Tailwind:** v4 only (v3 planned)
- **Release cadence:** automated via [release-please](https://github.com/googleapis/release-please-action); see [CHANGELOG](./packages/csszyx/CHANGELOG.md)
- **Build pipeline:** source transform uses the native Rust engine (`@csszyx/core-*` napi-rs addon) by default since v0.9.0. The JavaScript `oxc-parser` path is available via `build.parser: 'oxc'` or `CSSZYX_PARSER=oxc` for platforms without native binaries. Babel remains as a final compatibility escape hatch via `build.parser: 'babel'`.

## Contributing

Issues, discussions, and PRs welcome:

- **Issues / feature requests:** <https://github.com/nguyennhutien/csszyx/issues>
- **Contact:** <hello@csszyx.com>

## License

MIT — see [LICENSE](./LICENSE).
