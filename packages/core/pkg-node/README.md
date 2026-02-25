# <p align="center">🌊 @csszyx/core</p>

<p align="center">
  <img src="https://img.shields.io/badge/WASM-Powered-624de3?style=for-the-badge&logo=webassembly" alt="WASM Powered" />
  <img src="https://img.shields.io/badge/Rust-Core-dea584?style=for-the-badge&logo=rust" alt="Rust Core" />
  <img src="https://img.shields.io/badge/TypeScript-Ready-3178c6?style=for-the-badge&logo=typescript" alt="TypeScript Ready" />
</p>

---

## ✨ The Engine of csszyx

`@csszyx/core` is a high-performance, precision-engineered Rust core for the **csszyx** ecosystem. Compiled to WebAssembly, it brings near-native performance to Node.js, Browsers, and Edge environments.

### 🔥 Why Core?

- **Blazing Speed**: Offloads performance-critical operations (Hashing, Transformation, Encoding) to optimized Rust.
- **Universal Integrity**: Ensures bit-perfect mangle map consistency between SSR and hydration.
- **Security-First**: Uses SHA-256 and Base62 for tamper-proof tokens and collision-free variable names.
- **Zero Dependencies**: Lightweight WASM binary with no external runtimes required.

---

## 🚀 Quick Start

```bash
pnpm add @csszyx/core
```

### Initialization

```typescript
import { init } from "@csszyx/core";

async function bootstrap() {
  await init();
  // Core is ready to flow 🌊
}
```

---

## 🛠 Modules

### 🗺️ Mangle Map Integrity

Deterministic SHA-256 checksums to synchronize server-side class names with client-side hydration.

```typescript
import { compute_mangle_checksum, verify_mangle_checksum } from "@csszyx/core";

const mangleMap = { "p-4": "z", "m-2": "y" };
const checksum = compute_mangle_checksum(mangleMap);
// Results in a deterministic 16-char hex hash
```

### 🎭 Transformer

Universal conversion of object-based Tailwind syntax into optimized class strings.

```typescript
import { transform_sz } from "@csszyx/core";

// Supports: Negatives, Nesting, Integers
// ❌ String slash opacity not supported: bg: 'blue-500/20'
// ✅ Use @csszyx/compiler with object form: { bg: { color: 'blue-500', op: 20 } }
transform_sz({
  m: -4,
  bg: "blue-500",
  hover: { scale: 110 },
});
// "-m-4 bg-blue-500 hover:scale-110"
```

### 🔢 Tiered Encoder

The world's smallest CSS-compliant class name generator.

| Tier       | Range      | Format            | Example       |
| :--------- | :--------- | :---------------- | :------------ |
| **Tier 1** | 0 - 51     | \[z-aZ-A\]        | `z`, `y`, `x` |
| **Tier 2** | 52 - 571   | \[z-aZ-A\]\[9-0\] | `z9`, `y8`    |
| **Tier 3** | 572 - 3275 | \[z-aZ-A\]{2}     | `zz`, `zy`    |

### 🛡️ Collision Detector

Dual-hash resolution strategy for unique CSS variable names.

```typescript
import { WasmCollisionDetector } from "@csszyx/core";

const detector = new WasmCollisionDetector();
const varId = detector.add("#ff0000"); // "--v-a1b2c3"
```

---

## ⚡ Performance Matrix

Benchmarks performed on Apple M2 (WASM Node v20 target)

| Operation           | WASM (Rust) | Pure JS (Legacy) | Improvement    |
| :------------------ | :---------- | :--------------- | :------------- |
| **Integrity Check** | < 1ms       | ~15ms            | **15x faster** |
| **ID Encoding**     | ~5ns        | ~50ns            | **10x faster** |
| **Token Auth**      | ~25ns       | ~250ns           | **10x faster** |
| **Transformer**     | Optimized   | Variable         | Stable 🌊      |

> **Tech Tip**: WASM excels in consistency. Unlike JS which relies on JIT optimization, WASM provides deterministic, high-speed execution from the very first call.

---

## 📄 License

MIT © 2026 csszyx Team
