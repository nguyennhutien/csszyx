# What is csszyx?

csszyx is a modern CSS-in-JS framework that combines the power of Tailwind CSS with object syntax, providing type safety, automatic minification, and SSR safety.

## The Problem

Traditional approaches to styling React applications have tradeoffs:

### String Literals (Current Tailwind)

```tsx
<div className="p-4 bg-red-500 hover:bg-blue-600" />
```

**Issues:**

- ❌ No type safety
- ❌ Hard to refactor
- ❌ String concatenation errors
- ❌ No autocomplete for variants

### Runtime CSS-in-JS

```tsx
<div css={{ padding: "1rem", backgroundColor: "red" }} />
```

**Issues:**

- ❌ Runtime overhead
- ❌ Larger bundle size
- ❌ SSR complexity
- ❌ No Tailwind integration

## The Solution

csszyx provides the best of both worlds:

```tsx
// Coming soon: Object syntax
<div sz={{ p: 4, bg: 'red-500', hover: { bg: 'blue-600' } }} />

// Current: Runtime helpers
<div className={_sz('p-4', 'bg-red-500', 'hover:bg-blue-600')} />
```

**Benefits:**

- ✅ Full type safety with TypeScript
- ✅ Zero runtime overhead for static cases
- ✅ Automatic minification in production
- ✅ SSR safety with hydration guards
- ✅ Familiar Tailwind syntax

## Key Features

### 1. Object Syntax

Write Tailwind using JavaScript objects:

```tsx
<div
  sz={{
    p: 4,
    m: 2,
    bg: "red-500",
    color: "white",
    hover: {
      bg: "blue-600",
    },
  }}
/>
```

### 2. Type Safety

Auto-generated types from your Tailwind config:

```tsx
// ✅ Valid - TypeScript knows all Tailwind classes
<div sz={{ p: 4, bg: 'red-500' }} />

// ❌ Error - 'red-999' doesn't exist
<div sz={{ bg: 'red-999' }} />
```

### 3. Auto Minification

Production builds automatically minify class names:

```tsx
// Development
<div className="p-4 bg-red-500 hover:bg-blue-600" />

// Production (42% smaller)
<div className="z y x" />
```

### 4. SSR Safety

Deterministic hydration with checksum validation:

```tsx
// Server-rendered HTML includes checksum
<html data-sz-checksum="abc123">
  <div className="z y x">Content</div>
</html>

// Client validates before hydration
// Mismatch → Abort protocol → Preserve SSR HTML
```

### 5. Zero Runtime

Static cases compile to string literals:

```tsx
// Input
<div sz={{ p: 4, bg: 'red-500' }} />

// Output (zero runtime)
<div className="p-4 bg-red-500" />

// Production output (minified)
<div className="z y" />
```

### 6. Runtime Helpers

Dynamic cases use optimized helpers:

```tsx
import { _sz, _szIf } from "@csszyx/runtime";

<div className={_sz("base-class", _szIf(isActive, "active", "inactive"))} />;
```

## How It Works

csszyx uses a 5-phase build pipeline:

```
1. Type Generation
   ↓ tailwind.config.js → csszyx.d.ts

2. JSX Transform
   ↓ sz={{ p: 4 }} → className="p-4"

3. Tailwind JIT
   ↓ Scan all classes → Generate CSS

4. Global Mangling
   ↓ p-4 → a, bg-red-500 → b

5. Output/Emit
   ↓ Inject checksum + embed manifests
```

Each phase is cached for incremental builds.

## Architecture Highlights

### Rust/WASM Hot Paths

Performance-critical operations use Rust compiled to WASM:

- Reversed tier-based encoding (z→y→x)
- SHA-256 checksum & token generation
- SHA-256 dual-hash collision detection

Compiler and runtime core remain TypeScript for fast iteration.

### Framework Agnostic

Works with any bundler via unified unplugin architecture:

- React (CSR)
- Next.js (SSR/RSC)
- Vite
- Webpack
- esbuild
- Vue (via adapter)
- Svelte (via adapter)

### Monorepo Structure

```
csszyx/
├── packages/
│   ├── csszyx/          # Umbrella package (csszyx/vite, csszyx/webpack)
│   ├── unplugin/        # Unified plugin (Vite + Webpack + esbuild)
│   ├── compiler/        # TypeScript compiler (sz → Tailwind classes)
│   ├── runtime/         # Runtime helpers + SSR hydration
│   ├── core/            # Rust/WASM (encoder, checksum, collision)
│   ├── types/           # Shared TypeScript types
│   ├── vue-adapter/     # Vue SFC support
│   └── svelte-adapter/  # Svelte support
└── playground/
    ├── vite-react/      # Vite + React example
    ├── nextjs-ssr/      # Next.js SSR example
    └── webpack-react/   # Webpack example
```

## When to Use csszyx

### ✅ Great For

- New projects starting fresh
- Projects wanting better type safety
- Teams prioritizing maintainability
- SSR applications (Next.js, Remix)
- Large-scale applications

### ⚠️ Consider Alternatives If

- You prefer string literals
- Project uses inline styles heavily
- No build step available
- Team not comfortable with object syntax

## Next Steps

- [Getting Started](/guide/getting-started) - Install and setup
- [Installation](/guide/installation) - Detailed installation guide
- [API Reference](/api/runtime) - Explore the API
