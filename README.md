# csszyx

CSS-in-JS framework for the AI era with Tailwind object syntax, automatic minification, and SSR safety.

> **Pronunciation:** "css-zyx" — Class names are encoded in reversed order z→y→x.

[![npm version](https://img.shields.io/npm/v/csszyx.svg)](https://www.npmjs.com/package/csszyx)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://img.shields.io/github/actions/workflow/status/nguyennhutien/csszyx/test.yml)](https://github.com/nguyennhutien/csszyx/actions)

## ⚡ Quick Start

```tsx
// Write
<div sz={{ p: 4, bg: 'red-500', hover: { bg: 'blue-600' } }} />

// Ship (reversed encoding: z→y→x)
<div className="z y x" />  // 42% smaller bundle
```

## ✨ Features

- **Type Safety**: Full TypeScript autocomplete for Tailwind classes
- **Auto Minification**: `p-4` → `z`, `bg-red-500` → `y` (reversed tier encoding)
- **SSR Safe**: SHA-256 checksum validation prevents hydration mismatches
- **Zero Runtime**: Static cases compile to string literals
- **CSS Variable Auto-Compile**: Automatically converts static values to CSS variables
- **Container Queries**: Full `@container` and named container support
- **`:has()` Selector**: Support for relational pseudo-class via `has` variant
- **Migration CLI**: Convert Tailwind `className="..."` to `sz={...}` props
- **AI-Native**: Structured object syntax designed for LLM code generation

> **Tailwind CSS v4 only.** Tailwind CSS v3 is not supported. v3 support is planned for a future release.

**Platform support:**

| Platform         | Status                                    |
| ---------------- | ----------------------------------------- |
| React (Vite)     | Production-ready                          |
| Next.js (SSR)    | Production-ready                          |
| Vue 3            | Experimental (adapter included, untested) |
| Svelte 4/5       | Experimental (adapter included, untested) |
| esbuild / Rollup | Plugin available via `@csszyx/unplugin`   |

## 📦 Bundle Size

| App Size | Classes | Variables | Reduction |
| -------- | ------- | --------- | --------- |
| Small    | 500     | 20        | 31%       |
| Medium   | 2,000   | 100       | 42%       |
| Large    | 5,000   | 250       | 41%       |

**Network Impact (Medium App):**

- Uncompressed: 4.6KB (42% smaller)
- Gzipped: 1.4KB (56% smaller)
- 3G Download: 36ms faster

## 🎯 How It Works

### 1. Object Syntax

```tsx
sz({
  p: 4, // padding: 1rem
  bg: "red-500", // background: #ef4444
  hover: { bg: "blue" }, // hover:bg-blue-500
  md: { p: 8 }, // md:p-8
});
```

### 2. Reversed Tier-Based Encoding

```plaintext
z, y, x, ..., A      → 52 classes (1 char)
z9, z8, ..., A0      → 520 classes (2 chars)
zz, zy, ..., AA      → 2,704 classes (2 chars)
───────────────────────────────────────
Total < 3 chars      → 3,276 classes
```

**Examples:**

```typescript
encode(0)    → 'z'
encode(1)    → 'y'
encode(51)   → 'A'
encode(52)   → 'z9'
encode(571)  → 'A0'
encode(572)  → 'zz'
```

### 3. CSS Variable Optimization

```tsx
// Same value → same variable → auto reuse
<div sz={{ bg: 'var(--primary)' }} />
<span sz={{ bg: 'var(--primary)' }} />

// Output
<parent style="--ca3f2: #ff0000">
  <div style="background: var(--ca3f2)" />
  <span style="background: var(--ca3f2)" />
</parent>
```

### 4. Build Pipeline

```plaintext
Type Gen → JSX Transform → Tailwind JIT → Mangling → Emit
   ↓           ↓               ↓              ↓         ↓
  .d.ts    className=""     CSS bundle      z,y,x    +checksum
```

## 🔒 Safety Guarantees

### SSR Hydration

```html
<!-- Server -->
<html data-sz-checksum="abc123">
  <div class="a b">Content</div>
  <script id="__SZ_RECOVERY_MANIFEST__">
    {"tokens":{"a94f1c...":{"mode":"csr"}}}
  </script>
</html>

<!-- Client -->
Checksum match? → Hydrate ✓ Checksum mismatch? → Abort (preserve server HTML) ✓

<!-- Recovery (if declared) -->
<Component szRecover="csr" data-sz-recovery-token="a94f1c..." />
Token valid? → One-time CSR recovery ✓ Token invalid/missing? → Security error,
stay aborted ✓
```

**Token-Based Security:**

```tsx
// Developer writes
<Component szRecover="csr" />

// Build adds cryptographic token
<Component szRecover="csr" data-sz-recovery-token="a94f1c..." />

// Runtime verifies before recovery
✅ Token exists?
✅ Token in manifest?
✅ Mode matches?
→ Allow recovery
```

**Progressive Workflow:**

```tsx
// Week 1-2: Explore
{ auto_inject: true } → Auto-recovery everywhere

// Week 3-4: Fix
<Component szRecover="dev-only" /> → Explicit per-component

// Week 5+: Validate
{ strict_mode: true } → Test exact prod behavior
```

### RSC Boundary Guard

```tsx
// ✅ Client Component
"use client";
import { _sz } from "csszyx/runtime";

// ❌ Server Component
("use server");
import { _sz } from "csszyx/runtime"; // Fatal Build Error!
```

### Collision Prevention

```typescript
SHA-256 Checksum:
  • Single hash algorithm for all operations
  • Build-time: Rust (packages/core)
  • Server-side: Node.js crypto
  • Browser runtime: zero hashing (string passthrough)
  • Fatal error on collision
```

## 🛠️ Advanced Features

### Sugar Syntax

```tsx
// Negative values
{ m: -4 } → '-m-4'

// Opacity
{ opacity: 0.5 } → 'opacity-50'

// Color with opacity (object form)
{ text: { color: 'red-500', op: 50 } } → 'text-red-500/50'

// Auto brackets
{ w: 'calc(100% - 20px)' } → 'w-[calc(100%-20px)]'
```

### Variant Nesting

```tsx
{
  group: 'sidebar',
  'group-hover/sidebar': {
    bg: 'blue-500'
  }
}
```

### GPU Optimization (Planned)

> **Note:** GPU optimization features are planned for a future release and are not yet implemented.

```tsx
// Planned: Automatic will-change management
// Planned: Viewport quota, cleanup, priority scheduling
```

## 📊 Performance

### Runtime

```plaintext
Static Mode:    0ns (compiled to string literal)
Dynamic 0-4:    5ns (zero allocation)
Dynamic 5+:     30ns (single allocation)
```

### Build Time

```plaintext
Class encoding:     ~25ns per class
Variable hashing:   ~20ns per variable
Collision check:    O(1) hash lookup
```

### Memory

```plaintext
Class names:    38% fewer bytes in DOM
CSS variables:  56% fewer bytes
CSSOM:          Proportionally smaller
```

## 🎓 Usage Examples

### Basic

```tsx
<button
  sz={{
    p: 4,
    bg: "blue-500",
    text: "white",
    rounded: "lg",
    hover: { bg: "blue-600" },
  }}
>
  Click me
</button>
```

### Responsive

```tsx
<div
  sz={{
    p: 2, // Mobile
    md: { p: 4 }, // Tablet
    lg: { p: 8 }, // Desktop
  }}
/>
```

### Dynamic

```tsx
<div
  sz={{
    p: 4,
    bg: isActive ? "green-500" : "gray-500",
  }}
/>
```

### With className

```tsx
// ss wins conflicts, className preserved otherwise
<div
  className="mb-4 text-lg"
  sz={{ mb: 2 }} // Overrides mb-4
/>
// → className="text-lg mb-2"
```

## 🔧 Configuration

### tailwind.config.js

```javascript
export default {
  theme: {
    colors: {
      primary: "#ff0000", // Auto-promoted to global CSS var
    },
  },
};
```

### TypeScript

```typescript
// Auto-generated from config
type csszyxProps = {
  p?: 0 | 1 | 2 | 3 | 4 | 8 | 12 | ...
  bg?: 'red-500' | 'blue-600' | ...
  // ... all Tailwind utilities
}
```

## 🐛 Debugging

### Development Tools

```typescript
// Debug helper (dev only)
window.__csszyx.decode("z"); // → 'p-4'
window.__csszyx.encode("p-4"); // → 'z'
window.__csszyx.decodeAll(element); // → ['p-4', 'bg-red-500']
window.__csszyx.mangleMap; // { 'p-4': 'z', 'bg-red-500': 'y' }
window.__csszyx.checksum; // 'a1b2c3d4...' (SHA-256 hex)
```

### Audit Logging

```json
// .csszyx/audit.log
{
  "level": "error",
  "type": "collision",
  "file": "/src/Button.tsx",
  "line": 42
}
```

## 📖 Documentation

- **Complete Guide**: `csszyx-guide.md` - Full implementation details
- **Spec**: `csszyx-spec.json` - AI-executable specification

## 🎯 Design Principles

1. **Type Safety First**: TypeScript catches errors at compile time
2. **Zero Ambiguity**: Every decision has exactly one outcome
3. **Deterministic**: Same input always produces same output
4. **Performance**: Optimize bundle size without runtime cost
5. **SSR Safe**: Never break hydration, always preserve server HTML

## 📈 Project Status

- **Version**: 0.1.0 (pre-release)
- **Tailwind**: v4 only (v3 planned)
- **Test Coverage**: 890 tests (873 vitest + 17 Playwright E2E)
- **Lite Runtime**: <400B gzipped
- **Determinism**: 100% guaranteed

## License

MIT
