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
  mangle: boolean; // Minify class names (z, y, x, ...)
  contentHashing: boolean; // Hash for immutable caching
  injectChecksum: boolean; // Add hydration checksum to HTML
  incrementalBuild: boolean; // Enable build caching
  minify: boolean; // Minify output
}
```

**Defaults:**

- `mangle`: `true`
- `contentHashing`: `true`
- `injectChecksum`: `true`
- `incrementalBuild`: `true`
- `minify`: `true`

### Build

Controls build pipeline:

```ts
interface BuildConfig {
  buildId?: string; // Build identifier (auto-generated if omitted)
  tailwindConfig?: string; // Path to Tailwind config file
  outputDir?: string; // Output directory
  cacheDir?: string; // Cache directory
  astBudgetLimit?: number; // Max AST nodes per file before warning
}
```

**Defaults:**

- `buildId`: Auto-generated timestamp
- `tailwindConfig`: `'tailwind.config.js'`
- `outputDir`: `'.csszyx'`
- `cacheDir`: `'.csszyx/cache'`
- `astBudgetLimit`: `50000`

### Hydration

Controls SSR hydration behavior:

```ts
interface HydrationConfig {
  strict: boolean; // Enable strict checks
  defaultRecoveryMode?: "csr" | "dev-only"; // Default recovery mode
  auditLog: boolean; // Log hydration events
}
```

**Defaults:**

- `strict`: `true`
- `defaultRecoveryMode`: `null` (no recovery)
- `auditLog`: `true`

### Performance

Controls performance optimizations:

```ts
interface PerformanceConfig {
  parallel: boolean; // Parallel processing during build
  workers?: number; // Worker thread count (auto-detected)
  optimizeVariables: boolean; // CSS variable optimization
  zeroRuntime: boolean; // Static optimization for zero-runtime cases
}
```

**Defaults:**

- `parallel`: `true`
- `workers`: Auto-detected (CPU cores)
- `optimizeVariables`: `true`
- `zeroRuntime`: `true`

## See Also

- [Development Config](/config/development) - Development options
- [Production Config](/config/production) - Production options
- [Types API](/api/types) - Configuration types
