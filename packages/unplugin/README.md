# @csszyx/unplugin

> Vite, Webpack, and esbuild integration for CSSzyx.

Build-time plugin that transforms `sz` props into Tailwind classes, generates static CSS, mangles class names in production, and injects hydration scripts for SSR.

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

- **sz prop transform** -- Compiles `sz={{ }}` objects into `className` strings. Defaults to **oxc-parser + magic-string** (surgical edits, preserves source formatting) since v0.8.0; falls back to Babel automatically on unexpected oxc failures.
- **HTML injection** -- Injects mangle maps and checksums for SSR hydration
- **HMR support** -- Updates styles instantly during development
- **CSS mangling** -- Compresses class names (e.g., `text-center` -> `z`) in production builds
- **File filters** -- Top-level `include` / `exclude` (glob or RegExp) skip large generated files before the AST budget guard fires; see [Config Overview](https://csszyx.com/config/overview#file-filters)

## Parser selection

Per project:

```ts
csszyx({
  build: { parser: "babel" }, // compatibility escape hatch
});
```

Per build:

```bash
CSSZYX_PARSER=babel pnpm build
```

`build.parser: "rust"` opts into the native Rust engine. It requires the
matching optional `@csszyx/core-*` platform package; when that package is
missing, csszyx fails loudly instead of silently falling back to another parser.

Either path routes prescan, transform, and HMR discovery through the
legacy Babel implementation. Both paths produce identical class output;
the only difference is whether magic-string preserves your original
formatting (oxc) or Babel's code generator pretty-prints it.

## License

MIT
