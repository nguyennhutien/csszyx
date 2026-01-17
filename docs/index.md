---
layout: home

hero:
  name: csszyx
  text: CSS-in-JS with Tailwind
  tagline: Type-safe, performant, SSR-safe CSS-in-JS using Tailwind object syntax
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/nguyennhutien/csszyx

features:
  - icon: ✨
    title: Object Syntax
    details: Write Tailwind CSS using JavaScript objects with full TypeScript autocomplete and type safety.

  - icon: ⚡
    title: Zero Runtime
    details: Static cases compile to string literals with zero runtime overhead. Dynamic cases use optimized helpers.

  - icon: 🔒
    title: SSR Safety
    details: Deterministic hydration with checksum validation and automatic abort protocol for mismatches.

  - icon: 🎯
    title: Auto Minification
    details: Class names automatically minified to single characters (a, b, c) in production builds.

  - icon: 🚀
    title: Performance
    details: 10-15x faster than runtime CSS-in-JS solutions thanks to Rust-powered encoding.

  - icon: 🛡️
    title: Type Safety
    details: Auto-generated TypeScript types from your Tailwind config with full IDE support.

  - icon: 🔄
    title: Framework Agnostic
    details: Works with React, Next.js, Vite, and any bundler supporting AST transforms.

  - icon: 📦
    title: Tiny Bundle
    details: Minimal runtime footprint with tree-shakeable helpers and zero dependencies.

  - icon: 🎨
    title: Developer Experience
    details: Familiar Tailwind syntax with better refactoring, easier maintenance, and clearer intent.
---

## Quick Start

### Installation

```bash
pnpm add @csszyx/compiler @csszyx/runtime @csszyx/types
```

### Basic Usage

```tsx
import { _sz } from "@csszyx/runtime";

function Button({ isActive }) {
  return (
    <button
      className={_sz(
        "px-4 py-2 rounded-lg",
        isActive ? "bg-blue-600" : "bg-gray-200",
      )}
    >
      Click me
    </button>
  );
}
```

### Object Syntax

```tsx
// Coming soon: sz prop with object syntax
<div sz={{ p: 4, bg: 'red-500', hover: { bg: 'blue-600' } }} />

// Compiles to:
<div className="p-4 bg-red-500 hover:bg-blue-600" />

// Production output (minified):
<div className="a b c" />
```

## Why csszyx?

### Type Safety

Full TypeScript support with autocomplete for all Tailwind classes:

```tsx
// ✅ TypeScript knows all valid Tailwind classes
<div sz={{ p: 4, bg: 'red-500' }} />

// ❌ TypeScript error: 'red-999' is not a valid color
<div sz={{ bg: 'red-999' }} />
```

### Performance

- **Zero runtime overhead** for static cases
- **10-15x faster** than runtime CSS-in-JS
- **Rust-powered** encoding for blazing fast builds
- **Minimal bundle size** with tree-shakeable helpers

### SSR Safety

- **Deterministic hydration** ensures server/client consistency
- **Checksum validation** detects mangle map mismatches
- **Abort protocol** preserves SSR HTML when errors occur
- **Recovery tokens** for explicit CSR recovery control

### Developer Experience

```tsx
// Before (string literals)
<div className={`p-4 ${isActive ? 'bg-blue-600' : 'bg-gray-200'} hover:bg-blue-700`} />

// After (csszyx)
<div className={_sz('p-4', isActive ? 'bg-blue-600' : 'bg-gray-200', 'hover:bg-blue-700')} />

// Or with object syntax (coming soon)
<div sz={{ p: 4, bg: isActive ? 'blue-600' : 'gray-200', hover: { bg: 'blue-700' } }} />
```

## Architecture

csszyx uses a 5-phase build pipeline:

1. **Type Generation** - Scan Tailwind config → generate TypeScript types
2. **JSX Transform** - Transform `sz` prop → `className` strings
3. **Tailwind JIT** - Scan classes → generate CSS
4. **Global Mangling** - Minify class names → `a`, `b`, `c`
5. **Output/Emit** - Inject checksum + embed manifests

## Examples

Check out our example projects:

- [Vite + React](/examples/vite-react) - Client-side rendering example
- [Next.js](/examples/nextjs) - SSR with App Router

## Community

- [GitHub Issues](https://github.com/nguyennhutien/csszyx/issues)
- [Discussions](https://github.com/nguyennhutien/csszyx/discussions)

## License

MIT © 2024-present csszyx contributors
