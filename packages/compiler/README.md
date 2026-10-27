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

The engine lives in `@csszyx/core`, an optional peer: the `sz` types, the
TypeScript lowering and the tables need nothing else. To call the engine
(`@csszyx/compiler/engine`, `@csszyx/compiler/migrate`) install it beside the
compiler, at the same version:

```bash
pnpm add @csszyx/compiler @csszyx/core
```

`@csszyx/unplugin`, `@csszyx/cli` and `csszyx` install it for you.

## Usage

### Basic Transform

```typescript
import { transform } from "@csszyx/compiler";

// Transform sz object to className string
const { className } = transform({ p: 4, bg: "red-500" });
// className: "p-4 bg-red-500"

// With variants
const { className: classNameWithVariants } = transform({
  p: 4,
  hover: { bg: "blue-500" },
});
// classNameWithVariants: "p-4 hover:bg-blue-500"
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

Two layers — a pure object compile (`transform`, from `@csszyx/compiler`)
and the source-string transform of the ONE engine, from
`@csszyx/compiler/engine`: `transformRust` (native addon), `transformWasm`
(the same engine compiled to WebAssembly) or `transformSource` (picks
whichever this host can run).

```typescript
import { transformSource } from "@csszyx/compiler/engine";

transformSource("export const A = () => <div sz={{ p: 4 }} />;", {
  filename: "a.tsx",
}).code;
// export const A = () => <div className="p-4" />;
```

#### `transform(szProp: SzObject, options?: TransformOptions): TransformResult`

Pure compile from a sz object to `{ className, attributes }`. Browser-safe
(no parser dependency); also exposed at `@csszyx/compiler/browser` for
runtime consumers like `@csszyx/dynamic`.

Pass `prefix` and `mangleMap` in the options object; both are optional. The
previous positional calls now throw. For example, replace
`transform(sz, "", map)` with `transform(sz, { mangleMap: map })`.

```typescript
import { transform, type TransformOptions } from "@csszyx/compiler";

const options: TransformOptions = { prefix: "hover:" };
transform({ p: 4 }, options).className; // "hover:p-4"
transform({ p: 4 }, { mangleMap: { "p-4": "x" } }).className; // "x"
```

#### `transformSource(source: string, options?: TransformSourceOptions): SourceTransformResult`

Runs the engine through whichever artifact this host can load: the
native addon when present, the WebAssembly build otherwise. The file name
goes in the options as `filename`, beside the compiler options; a file name
passed as a second string throws `options-object-required`.

#### `transformRust(source: string, options?: TransformSourceOptions): SourceTransformResult` _(default since v0.9.0)_

The native addon via napi-rs. Fastest path. Requires the matching
optional `@csszyx/core-*` platform package; a missing package surfaces
`RustTransformUnavailableError`. An engine from another release than the
compiler throws `EngineVersionSkewError` (`engine-version-skew`).

#### `transformWasm(source: string, options?: TransformSourceOptions): SourceTransformResult`

The same engine compiled to WebAssembly, shipped inside `@csszyx/core`
itself — identical output to the native addon, loaded lazily only when
asked for.

Both artifacts preserve every byte the user wrote outside the touched
`sz`/`szRecover` ranges.

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

#### `serializeManifest(manifest, options?): string`

Serializes a recovery manifest to JSON string. `options.pretty` indents it by
two spaces.

#### `parseManifest(json: string): RecoveryManifest`

Parses a recovery manifest from JSON string.

#### `validateManifest(manifest): { valid: boolean; error?: string }`

Validates a recovery manifest structure.

## License

MIT
