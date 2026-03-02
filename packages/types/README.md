# @csszyx/types

Shared TypeScript type definitions for the CSSzyx framework.

## Features

- **Configuration Types**: Complete type definitions for CSSzyx configuration
- **Runtime Types**: Types for runtime operations, hydration, and recovery
- **Compiler Types**: Types for build phases, transformations, and plugins
- **Comprehensive Documentation**: All types fully documented with JSDoc
- **Tree-Shakeable**: Import only what you need

## Installation

```bash
pnpm add @csszyx/types
```

## Usage

### Import All Types

```typescript
import type {
  CsszyxConfig,
  RecoveryManifest,
  BuildResult,
} from "@csszyx/types";
```

### Import from Specific Modules

```typescript
// Configuration types only
import type { CsszyxConfig, DevelopmentConfig } from "@csszyx/types/config";

// Runtime types only
import type { RecoveryManifest, MangleMap } from "@csszyx/types/runtime";

// Compiler types only
import type { BuildResult, CompilerOptions } from "@csszyx/types/compiler";
```

## Type Categories

### Configuration Types (`/config`)

Types for configuring the CSSzyx framework:

```typescript
import type {
  CsszyxConfig, // Main configuration interface
  DevelopmentConfig, // Development mode options
  ProductionConfig, // Production mode options
  BuildConfig, // Build pipeline options
  HydrationConfig, // Hydration safety options
  PerformanceConfig, // Performance optimization options
  PartialCsszyxConfig, // Partial config for users
  Environment, // Environment type
} from "@csszyx/types/config";

import {
  DEFAULT_CSSZYX_CONFIG, // Default configuration
  getCurrentEnvironment, // Get current environment
} from "@csszyx/types/config";
```

#### Example: Using Configuration Types

```typescript
import type { CsszyxConfig, PartialCsszyxConfig } from "@csszyx/types";

const userConfig: PartialCsszyxConfig = {
  development: {
    debug: true,
    strictMode: false,
  },
  production: {
    mangle: true,
  },
};

// Merge with defaults
const config: CsszyxConfig = {
  ...DEFAULT_CSSZYX_CONFIG,
  development: {
    ...DEFAULT_CSSZYX_CONFIG.development,
    ...userConfig.development,
  },
};
```

### Runtime Types (`/runtime`)

Types for runtime operations:

```typescript
import type {
  RecoveryManifest, // Recovery token manifest
  MangleMap, // Class name mangle map
  TokenData, // Token metadata
  RecoveryMode, // 'csr' | 'dev-only'
  HydrationError, // Hydration error details
  HydrationErrorType, // Error type enum
  VerificationResult, // Token verification result
  RuntimeState, // Runtime state
  SzProp, // sz prop type
  ComponentPropsWithSz, // Component props with sz
  AuditLogEntry, // Audit log entry
  PerformanceMetrics, // Performance metrics
  CsszyxWindow, // Extended window interface
} from "@csszyx/types/runtime";

import {
  isCsszyxWindow, // Type guard for window
} from "@csszyx/types/runtime";
```

#### Example: Using Runtime Types

```typescript
import type {
    RecoveryManifest,
    MangleMap,
    ComponentPropsWithSz
} from '@csszyx/types';

// Load manifest
const manifest: RecoveryManifest = {
    buildId: 'abc123',
    checksum: 'def456',
    tokens: {
        token1: {
            mode: 'csr',
            component: 'Button',
            path: 'components/Button.tsx',
        },
    },
};

// Component with sz prop
interface ButtonProps extends ComponentPropsWithSz {
    onClick: () => void;
}

const Button: React.FC<ButtonProps> = ({ sz, szRecover, onClick }) => {
    return <button sz={sz} szRecover={szRecover} onClick={onClick} />;
};
```

### Compiler Types (`/compiler`)

Types for compilation and build:

```typescript
import type {
  CompilerOptions, // Compiler options
  TransformOptions, // Transform options
  BuildResult, // Build result
  BuildStatistics, // Build statistics
  BuildPhase, // Build phase enum
  BuildPhaseResult, // Phase result
  BuildPhaseStatus, // Phase status
  FileCompilationResult, // File compilation result
  TokenMetadata, // Token metadata
  GeneratedToken, // Generated token
  MangleMapEntry, // Mangle map entry
  CollisionResult, // Collision detection result
  ValidationResult, // Validation result
  ValidationError, // Validation error
  NodeLocation, // AST node location
  CompilerPlugin, // Plugin interface
  CompilerContext, // Plugin context
  CacheManager, // Cache manager interface
  CacheEntry, // Cache entry
} from "@csszyx/types/compiler";
```

#### Example: Using Compiler Types

```typescript
import type {
  CompilerOptions,
  BuildResult,
  CompilerPlugin,
} from "@csszyx/types";

const options: CompilerOptions = {
  buildId: "v1.0.0",
  development: true,
  strictMode: false,
  sourceRoot: "./src",
  outDir: "./dist",
};

// Custom compiler plugin
const myPlugin: CompilerPlugin = {
  name: "my-plugin",
  version: "1.0.0",
  transform(code, filePath, options) {
    // Transform code
    return code;
  },
};
```

## Type Definitions

### Key Interfaces

#### CsszyxConfig

Main configuration for the CSSzyx framework:

```typescript
interface CsszyxConfig {
  development: DevelopmentConfig;
  production: ProductionConfig;
  build: BuildConfig;
  hydration: HydrationConfig;
  performance: PerformanceConfig;
}
```

#### RecoveryManifest

Recovery token manifest embedded in build output:

```typescript
interface RecoveryManifest {
  buildId: string;
  checksum: string;
  tokens: Record<string, TokenData>;
}
```

#### MangleMap

Maps original class names to minified versions:

```typescript
interface MangleMap {
  [originalClass: string]: string;
}
```

#### BuildResult

Result of a complete build:

```typescript
interface BuildResult {
  success: boolean;
  stats: BuildStatistics;
  phases: BuildPhaseResult[];
  errors: Error[];
  warnings: string[];
  artifacts: Record<string, string>;
}
```

## Enums and Literal Types

### RecoveryMode

```typescript
type RecoveryMode = "csr" | "dev-only";
```

### BuildPhase

```typescript
type BuildPhase =
  | "type_generation"
  | "jsx_transform"
  | "tailwind_jit"
  | "global_mangling"
  | "output_emit";
```

### HydrationErrorType

```typescript
type HydrationErrorType =
  | "checksum_mismatch"
  | "map_missing"
  | "invalid_token"
  | "abort_failed";
```

### Environment

```typescript
type Environment = "development" | "production" | "test";
```

## Default Values

The package exports default configurations:

```typescript
import {
  DEFAULT_CSSZYX_CONFIG,
  DEFAULT_DEVELOPMENT_CONFIG,
  DEFAULT_PRODUCTION_CONFIG,
  DEFAULT_BUILD_CONFIG,
  DEFAULT_HYDRATION_CONFIG,
  DEFAULT_PERFORMANCE_CONFIG,
} from "@csszyx/types";
```

## Type Guards

### isCsszyxWindow

Check if window has CSSzyx extensions:

```typescript
import { isCsszyxWindow } from "@csszyx/types";

if (typeof window !== "undefined" && isCsszyxWindow(window)) {
  // Access csszyx-specific properties
  console.log(window.__SZ_RUNTIME_STATE__);
}
```

## Best Practices

1. **Import Only What You Need**: Use specific imports to improve tree-shaking
2. **Use Type Imports**: Use `import type` for type-only imports
3. **Extend Interfaces**: Create custom interfaces by extending base types
4. **Leverage Defaults**: Use default configurations as starting points

## Contributing

When adding new types:

1. Add JSDoc comments to all types
2. Group related types in the appropriate module
3. Export from the main index
4. Update this README with examples

## License

MIT
