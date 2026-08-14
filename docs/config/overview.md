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
  parser?: "rust" | "wasm"; // Source-transform engine artifact (default: 'rust' since v0.9.0)
}
```

**Defaults:**

- `buildId`: Auto-generated timestamp
- `outputDir`: `'.csszyx'`
- `cacheDir`: `'.csszyx/cache'`
- `astBudgetLimit`: `50000`
- `parser`: `'rust'` (since v0.9.0)

#### `parser` — which artifact of the engine to load

There is one engine. It parses your source, extracts `sz` attributes, and
rewrites them surgically, preserving the developer's exact formatting
outside the touched ranges. This setting picks which build of it runs, so
it decides load behaviour and parse speed — never the classes emitted.

- `'rust'` (default) — native napi-rs addon, the fastest path. Requires
  the matching optional `@csszyx/core-*` platform package (declared as
  `optionalDependencies`, installed automatically on supported
  platforms). A missing package surfaces `CsszyxNativeUnavailableError`
  with the expected package name.
- `'wasm'` — the same engine compiled to WebAssembly, shipped inside
  `@csszyx/core` itself, so it needs no per-platform download. Pin it
  where native addons cannot load at all.

An inherited default degrades from `'rust'` to `'wasm'` when the native
package is absent; an explicit `'rust'` fails loudly instead, because an
explicit choice is never silently swapped.

The `CSSZYX_PARSER=rust|wasm` environment variable overrides this setting
per build, which is useful for CI debugging without editing project
config.

The `'oxc'` and `'babel'` TypeScript lanes were removed in v0.14.0. A
config still naming them is ignored the way an invalid env value is: the
build runs on the default and says which lane it actually used.

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
