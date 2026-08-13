# @csszyx/unplugin

> Vite, Webpack, and esbuild integration for CSSzyx.

Build-time plugin that transforms `sz` props into Tailwind classes, generates static CSS, optionally mangles class names in production (opt-in), and injects hydration scripts for SSR.

## Installation

```bash
pnpm add -D @csszyx/unplugin
```

Or install the umbrella package which includes this:

```bash
pnpm add csszyx
```

## Vite

```ts
// vite.config.ts
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import csszyx from "csszyx/vite";

export default defineConfig({
  plugins: [...csszyx(), tailwindcss(), react()],
});
```

The direct import also works:

```ts
import csszyx from "@csszyx/unplugin/vite";
```

## Webpack (Next.js)

```js
// next.config.js
const csszyx = require("@csszyx/unplugin/webpack").default;

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    config.plugins.push(...csszyx());
    return config;
  },
};

module.exports = nextConfig;
```

## Webpack (standalone)

```js
// webpack.config.js
const csszyx = require("@csszyx/unplugin/webpack").default;

module.exports = {
  plugins: [...csszyx()],
};
```

## Features

- **sz prop transform** -- Compiles `sz={{ }}` objects into `className` strings with ONE engine that ships as two artifacts: the **native Rust addon** (default, through the optional `@csszyx/core-*` platform package) and the same engine compiled to **WebAssembly** (shipped inside `@csszyx/core`, the automatic fallback when the native binary is absent — pin it with `build.parser: "wasm"`).
- **HTML injection** -- Injects mangle maps and checksums for SSR hydration
- **HMR support** -- Updates styles instantly during development
- **CSS mangling** -- Compresses owned class names (e.g., `text-center` -> `z`) while retaining names shared with source-visible `class`/`className` strings and template quasis
- **File filters** -- Top-level `include` / `exclude` (glob or RegExp) skip large generated files before the AST budget guard fires; see [Config Overview](https://csszyx.com/config/overview#file-filters)

Class mangling runs in Vite, Webpack, and Rollup final-output hooks. The esbuild
adapter supports source transforms and safelist generation but disables class
mangling because esbuild does not expose a mutable final-output hook when writing
directly to disk; explicit `production.mangle: true` emits a warning.

## Parser selection

The default parser is `rust`, which runs through the native engine in the
matching optional `@csszyx/core-*` platform package. When that package is
missing, csszyx fails loudly instead of silently falling back to another
parser; reinstall to pick up the optional dependency for your platform, or
opt into the JavaScript engine explicitly.

Per project:

```ts
csszyx({
  build: { parser: "wasm" }, // the engine's WebAssembly build, no native addon
});
```

Per build:

```bash
CSSZYX_PARSER=wasm pnpm build
```

Both values run the same engine, so output is identical; only parse speed
differs. The former `"oxc"` and `"babel"` TypeScript lanes were removed —
a config still naming them is ignored like an invalid env value and the
build runs on the default.

## License

MIT
