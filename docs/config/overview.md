# Configuration Overview

csszyx provides comprehensive configuration options for both development and production environments.

## Quick Start

Create a `csszyx.config.js` file in your project root:

```js
/** @type {import('@csszyx/types').CsszyxConfig} */
export default {
  development: {
    autoInjectRecovery: false,
    strictMode: false,
    debug: true,
    allowCSRRecovery: true,
  },
  production: {
    mangle: true,
    contentHashing: true,
    injectChecksum: true,
    incrementalBuild: true,
    minify: true,
  },
  build: {
    buildId: undefined, // Auto-generated
    tailwindConfig: "tailwind.config.js",
    outputDir: ".csszyx",
    cacheDir: ".csszyx/cache",
    astBudgetLimit: 50000,
  },
  hydration: {
    strict: true,
    defaultRecoveryMode: null,
    auditLog: true,
  },
  performance: {
    parallel: true,
    workers: undefined, // Auto-detected
    optimizeVariables: true,
    zeroRuntime: true,
  },
};
```

## Configuration Sections

### Development

Controls development mode behavior:

```ts
interface DevelopmentConfig {
  autoInjectRecovery: boolean; // Auto-inject recovery tokens
  strictMode: boolean; // Treat warnings as errors
  debug: boolean; // Enable debug logging
  allowCSRRecovery: boolean; // Allow client-side recovery
}
```

**Defaults:**

- `autoInjectRecovery`: `false`
- `strictMode`: `false`
- `debug`: `false`
- `allowCSRRecovery`: `true`

### Production

Controls production build behavior:

```ts
interface ProductionConfig {
  mangle: boolean; // Minify class names
  contentHashing: boolean; // Hash for immutable caching
  injectChecksum: boolean; // Add hydration checksum
  incrementalBuild: boolean; // Enable build caching
  minify: boolean; // Minify output (class names and attributes)
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
  buildId?: string; // Build identifier
  tailwindConfig?: string; // Tailwind config path
  outputDir?: string; // Output directory
  cacheDir?: string; // Cache directory
  astBudgetLimit?: number; // Max AST nodes per file
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
  defaultRecoveryMode?: "csr" | "dev-only"; // Default recovery
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
  parallel: boolean; // Parallel processing
  workers?: number; // Worker thread count
  optimizeVariables: boolean; // CSS variable optimization
  zeroRuntime: boolean; // Static optimization
}
```

**Defaults:**

- `parallel`: `true`
- `workers`: Auto-detected (CPU cores)
- `optimizeVariables`: `true`
- `zeroRuntime`: `true`

## Environment-Specific Config

Use environment variables to customize behavior:

```js
export default {
  development: {
    debug: process.env.DEBUG === "true",
    allowCSRRecovery: process.env.NODE_ENV === "development",
  },
  production: {
    mangle: process.env.NODE_ENV === "production",
  },
};
```

## TypeScript Support

For type safety, use TypeScript config:

```ts
// csszyx.config.ts
import type { CsszyxConfig } from "@csszyx/types";

const config: CsszyxConfig = {
  development: {
    autoInjectRecovery: false,
    strictMode: false,
    debug: true,
    allowCSRRecovery: true,
  },
  // ... other config
};

export default config;
```

## Runtime Configuration

Configure runtime behavior separately:

```tsx
import { initRuntime } from "@csszyx/runtime";

initRuntime({
  development: process.env.NODE_ENV === "development",
  allowCSRRecovery: true,
  strictHydration: true,
  debug: false,
});
```

## See Also

- [Development Config](/config/development) - Development options
- [Production Config](/config/production) - Production options
- [Types API](/api/types) - Configuration types
