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

- **sz prop transform** -- Compiles `sz={{ }}` objects into `className` strings. Defaults to the **native Rust engine** through the optional `@csszyx/core-*` platform package; opt back into the previous oxc-parser JavaScript path with `build.parser: "oxc"`, or fall through to Babel with `build.parser: "babel"`.
- **HTML injection** -- Injects mangle maps and checksums for SSR hydration
- **HMR support** -- Updates styles instantly during development
- **CSS mangling** -- Compresses class names (e.g., `text-center` -> `z`) in production builds
- **File filters** -- Top-level `include` / `exclude` (glob or RegExp) skip large generated files before the AST budget guard fires; see [Config Overview](https://csszyx.com/config/overview#file-filters)

## Parser selection

The default parser is `rust`, which runs through the native engine in the
matching optional `@csszyx/core-*` platform package. When that package is
missing, csszyx fails loudly instead of silently falling back to another
parser; reinstall to pick up the optional dependency for your platform, or
opt into the JavaScript engine explicitly.

Per project:

```ts
csszyx({
  build: { parser: "oxc" }, // JavaScript oxc parser, no native addon
});
```

Per build:

```bash
CSSZYX_PARSER=oxc pnpm build
```

The default `rust` path uses the native engine and shares the same
`className` output shape as the JavaScript parsers. `build.parser: "oxc"`
uses the previous JavaScript oxc-parser path with surgical magic-string
edits to preserve source formatting outside touched ranges.
`build.parser: "babel"` routes prescan, transform, and HMR discovery
through the legacy Babel implementation as a final compatibility escape
hatch.

## License

MIT
