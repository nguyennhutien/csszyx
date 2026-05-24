# @csszyx/core

> Rust/WASM core for CSSzyx -- encoder, checksum, collision detection, and recovery tokens.

Compiled to WebAssembly, this package provides the performance-critical operations for the CSSzyx ecosystem. It runs in Node.js, browsers, and edge environments.

The future Node-native transform boundary is documented in
[NATIVE-TRANSFORM.md](./NATIVE-TRANSFORM.md). Existing WASM exports stay stable.

## Installation

```bash
pnpm add @csszyx/core
```

## Initialization

```typescript
import { init } from "@csszyx/core";

await init();
```

## Modules

### Mangle Map Integrity

Deterministic SHA-256 checksums to synchronize server-side class names with client-side hydration.

```typescript
import { compute_mangle_checksum, verify_mangle_checksum } from "@csszyx/core";

const mangleMap = { "p-4": "z", "m-2": "y" };
const checksum = compute_mangle_checksum(mangleMap);
// Returns a deterministic 16-char hex hash
```

### Transformer

Converts object-based Tailwind syntax into class strings.

```typescript
import { transform_sz } from "@csszyx/core";

// ❌ String slash opacity not supported: bg: 'blue-500/20'
// ✅ Use @csszyx/compiler with object form: { bg: { color: 'blue-500', op: 20 } }
transform_sz({
  m: -4,
  bg: "blue-500",
  hover: { scale: 110 },
});
// "-m-4 bg-blue-500 hover:scale-110"
```

### Tiered Encoder

CSS-compliant class name generator using reversed tier encoding (z -> y -> x).

| Tier   | Range      | Format            | Example       |
| :----- | :--------- | :---------------- | :------------ |
| Tier 1 | 0 - 51     | \[z-aZ-A\]        | `z`, `y`, `x` |
| Tier 2 | 52 - 571   | \[z-aZ-A\]\[9-0\] | `z9`, `y8`    |
| Tier 3 | 572 - 3275 | \[z-aZ-A\]{2}     | `zz`, `zy`    |

### Collision Detector

Dual-hash resolution strategy for unique CSS variable names.

```typescript
import { WasmCollisionDetector } from "@csszyx/core";

const detector = new WasmCollisionDetector();
const varId = detector.add("#ff0000"); // "--v-a1b2c3"
```

## Performance

Benchmarks on Apple M2 (WASM, Node v20):

| Operation       | WASM (Rust) | Pure JS | Speedup |
| :-------------- | :---------- | :------ | :------ |
| Integrity Check | < 1ms       | ~15ms   | 15x     |
| ID Encoding     | ~5ns        | ~50ns   | 10x     |
| Token Auth      | ~25ns       | ~250ns  | 10x     |

## License

MIT
