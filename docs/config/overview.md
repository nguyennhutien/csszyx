# Configuration Overview

CSSzyx is configured by passing options directly to the plugin in your bundler config.
There is no standalone `csszyx.config.ts` file — all config lives where your build tool is configured.

## Quick Start

### Vite

```ts
// vite.config.ts
import csszyx from "csszyx/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    // csszyx MUST come before tailwindcss and react
    ...csszyx({
      development: {
        debug: true,
      },
      production: {
        mangle: true,
        injectChecksum: true,
      },
    }),
    tailwindcss(),
    react(),
  ],
});
```

### Next.js (Webpack)

```ts
// next.config.ts
import type { NextConfig } from "next";
const csszyxWebpack = require("@csszyx/unplugin/webpack").default;

const nextConfig: NextConfig = {
  webpack(config) {
    config.plugins.push(
      csszyxWebpack({
        production: { mangle: true, injectChecksum: true },
      }),
    );
    return config;
  },
};

export default nextConfig;
```

### Webpack

```js
// webpack.config.js
const csszyxWebpack = require("@csszyx/unplugin/webpack").default;

module.exports = {
  plugins: [
    csszyxWebpack({
      production: { mangle: true, injectChecksum: true },
    }),
  ],
};
```

## TypeScript Types

Import `PartialCsszyxConfig` for full type safety:

```ts
import type { PartialCsszyxConfig } from "@csszyx/types";

const csszyxOptions: PartialCsszyxConfig = {
  exclude: ["src/generated/**"],
  development: {
    debug: true,
  },
  production: {
    mangle: true,
    injectChecksum: true,
  },
};
```

## Configuration Sections

### Development

Controls development mode behavior:

```ts
interface DevelopmentConfig {
  strictMode: boolean; // Treat warnings as errors
  debug: boolean; // Enable debug logging
}
```

**Defaults:**

- `strictMode`: `false`
- `debug`: `false`

> Recovery is now opt-in per element via the `szRecover` JSX attribute (`"csr"` or `"dev-only"`). The legacy global `autoInjectRecovery` and `allowCSRRecovery` flags were removed in 0.6.0.

### Production

Controls production build behavior:

```ts
interface ProductionConfig {
  mangle: boolean; // Obfuscate class names (z, y, x, ...) — opt-in, default false
  injectChecksum: boolean; // Add hydration checksum to HTML
  minify: boolean; // Minify output
}
```

**Defaults:**

- `mangle`: `false`
- `injectChecksum`: `true`
- `minify`: `true`

### Build

Controls build pipeline:

```ts
interface BuildConfig {
  buildId?: string; // Build identifier (auto-generated if omitted)
  outputDir?: string; // Output directory
  cacheDir?: string; // Cache directory
  astBudgetLimit?: number; // Max AST nodes per file before the transform skips it (warned; safelist prescan runs at 10x)
  scanCss?: string | string[]; // CSS files/globs with @theme blocks
  parser?: "rust" | "oxc" | "babel"; // Source-transform parser (default: 'rust' since v0.9.0)
}
```

**Defaults:**

- `buildId`: Auto-generated timestamp
- `outputDir`: `'.csszyx'`
- `cacheDir`: `'.csszyx/cache'`
- `astBudgetLimit`: `50000`
- `parser`: `'rust'` (since v0.9.0; was `'oxc'` before)

#### `parser` — source-transform engine

Since v0.9.0, csszyx uses the native Rust engine by default. The engine
parses your source, extracts `sz` attributes, and rewrites them via
surgical `magic-string` edits that preserve the developer's exact
formatting outside the touched ranges.

- `'rust'` (default) — native napi-rs addon. Fastest parser path (6-8x
  faster than oxc in microbenchmarks). Requires the matching optional
  `@csszyx/core-*` platform package (declared as `optionalDependencies`,
  installed automatically on supported platforms). Missing native
  packages surface `CsszyxNativeUnavailableError` with the expected
  package name and fallback guidance.
- `'oxc'` — JavaScript fallback. Uses `oxc-parser` + `magic-string`
  for the same surgical rewrite approach. No native addon required.
  Use on platforms without native binaries or when debugging parser
  differences.
- `'babel'` — final compatibility escape hatch. Routes prescan,
  transform, and HMR discovery through the legacy Babel implementation.
  Use only if you hit a corner case the other parsers reject.

The `CSSZYX_PARSER=rust|oxc|babel` environment variable overrides this
setting per build (useful for CI debugging without editing project
config). Parser paths are expected to produce the same class output;
formatting differences are limited to the ranges each parser rewrites.

### File Filters

Top-level `include` / `exclude` control which source files csszyx parses.
Both accept glob patterns (string or `RegExp`).

```ts
csszyx({
  // Optional: restrict scanning to a subset (falsy = scan all matching extensions)
  include: ["src/**/*.{tsx,jsx}"],

  // Optional: skip files that would otherwise match. Useful for large
  // generated files that contain an incidental `sz` marker but should
  // not enter the AST budget guard.
  exclude: ["src/generated/**", /icon-dump\.tsx$/],
});
```

Filters run BEFORE the parser is invoked — excluded files cost nothing
in IO or AST work. Defence-in-depth angle: operators can quarantine
suspect paths via `exclude` while keeping `build.astBudgetLimit` at its
conservative default of 50000 nodes.

### Extra sources (`compileSources`)

csszyx hard-ignores `/packages/` by default (a published library ships
pre-extracted CSS) and pre-scans only the build root. In a monorepo, a
design-system you author — under `/packages/` or a sibling outside the
build root — is first-class source that should compile alongside app code.
Opt it in **by path**:

```ts
csszyx({
  compileSources: ["packages/vui", "../libs/ui"],
});
```

Paths resolve like Vite config paths: relative to the resolved project
root (`config.root`, default the build cwd); absolute paths pass through;
pnpm symlinks are matched after realpath resolution. Each entry exempts
that directory from the ignore AND adds it as a pre-scan root.
`node_modules` and `.next` stay ignored unless a listed path points into
them. A `/packages/` file using csszyx and not under any `compileSources`
directory is skipped (no CSS); csszyx warns at build end listing those
files. A path that does not resolve to a directory is reported in a
build warning. A non-`/packages/` lib inside the build root needs no
config — it is compiled and scanned automatically.

Opting a package in is also what makes the cross-module `szv` precompile
work inside it. The pre-scan is what records a module's exported
factories, so a skipped module keeps its factories out of the registry
and every importer — including its own siblings — falls back to the
runtime path. That case is reported in production builds too, because
the cost is not a style nudge but csszyx output the build did not
produce; a skip that only affects one file's own classes stays
development-only.

### Hydration

Controls SSR hydration behavior:

```ts
interface HydrationConfig {
  strict: boolean; // Enable strict checks
}
```

**Defaults:**

- `strict`: `true`

## See Also

- [Development Config](/config/development) - Development options
- [Production Config](/config/production) - Production options
- [Types API](/api/types) - Configuration types
