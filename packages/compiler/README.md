# @csszyx/compiler

TypeScript compiler package for CSSzyx - handles JSX transformation, recovery token generation, and manifest creation.

## Features

- **JSX Transform**: Converts `sz` prop to Tailwind CSS `className` strings
- **Recovery Token System**: Cryptographic tokens for hydration recovery control
- **Manifest Generation**: Build-time manifest for recovery metadata
- **Type Safety**: Full TypeScript support with strict types

## Installation

```bash
pnpm add @csszyx/compiler
```

## Usage

### Basic Transform

```typescript
import { transform } from "@csszyx/compiler";

// Transform sz object to className string
const className = transform({ p: 4, bg: "red-500" });
// Returns: "p-4 bg-red-500"

// With variants
const classNameWithVariants = transform({
  p: 4,
  hover: { bg: "blue-500" },
});
// Returns: "p-4 hover:bg-blue-500"
```

### Recovery Token Generation

```typescript
import { createRecoveryToken } from "@csszyx/compiler";

const recovery = createRecoveryToken(
  {
    mode: "csr",
    component: "Button",
    filePath: "/app/Button.tsx",
    line: 10,
    column: 5,
  },
  "build-123",
);

console.log(recovery.token); // "a94f1c2e8b3d"
```

### Manifest Builder

```typescript
import { ManifestBuilder } from "@csszyx/compiler";

const builder = new ManifestBuilder("build-123");

builder.addToken("token1", {
  mode: "csr",
  component: "Button",
  filePath: "/app/Button.tsx",
  line: 10,
  column: 5,
  buildId: "build-123",
});

const manifest = builder.build();
// {
//   buildId: 'build-123',
//   checksum: '...',
//   tokens: { token1: { mode: 'csr', component: 'Button', path: '...' } }
// }
```

## API Reference

### Transform

Two layers — a pure object compile (`transform`) and two source-string
transforms (`transformSourceCode` for the Babel path, `transformOxc` for
the oxc-parser + magic-string path).

#### `transform(szProp: SzObject, prefix?: string, mangleMap?: Record<string, string>): TransformResult`

Pure compile from a sz object to `{ className, attributes }`. Browser-safe
(no parser dependency); also exposed at `@csszyx/compiler/browser` for
runtime consumers like `@csszyx/dynamic`.

#### `transformSourceCode(source: string, filename?: string, options?: TransformSourceCodeOptions): { code, transformed, usesRuntime, usesMerge, usesColorVar, classes, rawClassNames, diagnostics, recoveryTokens }`

Babel-based source transform. Parses TSX/JSX, walks the AST, rewrites
`sz`/`szRecover`/`_sz` constructs, emits the new source via Babel's
code generator. Retained as the final compatibility fallback.

#### `transformOxc(source: string, filename?: string, options?: TransformSourceCodeOptions): TransformOxcResult` _(since v0.8.0)_

oxc-parser + magic-string source transform. Same return shape as
`transformSourceCode` so consumers (and the parity harness) can diff
both implementations cleanly. JavaScript fallback when the native Rust
engine is unavailable (e.g. unsupported platform). Set
`build.parser: 'oxc'` to use this path.

#### `transformRust(source: string, filename?: string, options?: TransformSourceCodeOptions): TransformRustResult` _(default since v0.9.0)_

Native Rust engine via napi-rs. Fastest parser path. Requires the
matching optional `@csszyx/core-*` platform package. Missing native
packages surface `CsszyxNativeUnavailableError`.

All three transform paths preserve every byte the user wrote outside the
touched `sz`/`szRecover` ranges.

#### `isValidSzProp(szProp: unknown): boolean`

Validates that an sz prop object is valid.

#### `normalizeClassName(className: string): string`

Normalizes a className string by removing extra whitespace.

### Recovery

#### `generateRecoveryToken(metadata: TokenMetadata): string`

Generates a cryptographic token for a recovery declaration.

#### `createRecoveryToken(metadata, buildId): RecoveryToken`

Creates a recovery token with full metadata.

#### `isValidRecoveryMode(value: unknown): boolean`

Validates if a value is a valid recovery mode ('csr' or 'dev-only').

#### `validateSzRecover(value, componentName): { valid: boolean; error?: string }`

Validates szRecover attribute value.

#### `injectRecoveryToken(attributes, token): Record<string, unknown>`

Injects recovery token into JSX attributes.

### Manifest

#### `class ManifestBuilder`

Builder class for creating recovery manifests.

Methods:

- `addToken(token: string, metadata: TokenMetadata): void`
- `build(): RecoveryManifest`
- `size(): number`
- `hasToken(token: string): boolean`
- `clear(): void`

#### `serializeManifest(manifest, pretty?): string`

Serializes a recovery manifest to JSON string.

#### `parseManifest(json: string): RecoveryManifest`

Parses a recovery manifest from JSON string.

#### `validateManifest(manifest): { valid: boolean; error?: string }`

Validates a recovery manifest structure.

## License

MIT
