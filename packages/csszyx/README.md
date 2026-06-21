# csszyx

> Universal CSS-in-JS for Tailwind CSS with WASM core.

## Features

- **Build-time transforms** -- `sz` prop compiles to atomic Tailwind classes
- **Zero-runtime overhead** -- Styles extracted to static CSS at build time
- **SSR hydration safety** -- SHA-256 checksum validation, abort on mismatch
- **Tailwind CSS v4** -- Full compatibility with Tailwind's JIT engine
- **Production minification** -- Class names mangled (`p-4` -> `z`) for smaller output
- **TypeScript support** -- Fully typed `sz` prop with autocomplete

## Installation

```bash
pnpm add csszyx
```

## Quick Start

### 1. Configure your build tool

```ts
// vite.config.ts
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import csszyx from "csszyx/vite";

export default defineConfig({
  plugins: [...csszyx(), tailwindcss(), react()],
});
```

### 2. Use the `sz` prop

```tsx
function Button() {
  return (
    <button sz={{ bg: "blue-500", color: "white", p: 4 }}>Click me</button>
  );
}
```

At build time, `sz={{ bg: 'blue-500', color: 'white', p: 4 }}` compiles to `className="bg-blue-500 text-white p-4"`.

## Object Syntax

The `sz` prop accepts an object where keys are Tailwind property names and values are their arguments.

```tsx
// Basic utilities
<div sz={{ p: 4, m: 2, bg: "blue-500" }} />
// -> className="p-4 m-2 bg-blue-500"

// Text color uses `color`, not `text`
<div sz={{ color: "white" }} />
// -> className="text-white"

// Font weight and family
<div sz={{ weight: "bold", fontFamily: "mono" }} />
// -> className="font-bold font-mono"

// Hover state
<button sz={{ bg: "blue-500", hover: { bg: "blue-600" } }} />
// -> className="bg-blue-500 hover:bg-blue-600"

// Responsive breakpoints
<div sz={{ p: 4, md: { p: 8 }, lg: { p: 12 } }} />
// -> className="p-4 md:p-8 lg:p-12"

// Negative values
<div sz={{ m: -4 }} />
// -> className="-m-4"

// Opacity modifier (use object form)
<div sz={{ bg: { color: "blue-500", op: 20 } }} />
// -> className="bg-blue-500/20"
```

## Runtime Helpers

For dynamic class composition, use the runtime helpers from `@csszyx/runtime` (re-exported by `csszyx`):

```tsx
import { _sz, _szIf, _szSwitch } from "@csszyx/runtime";

<div className={_sz("p-4", _szIf(isActive, "bg-blue-500", "bg-gray-200"))} />;
```

## Packages

| Package                                                              | Description                             |
| -------------------------------------------------------------------- | --------------------------------------- |
| [`csszyx`](https://www.npmjs.com/package/csszyx)                     | Umbrella package (re-exports all)       |
| [`@csszyx/unplugin`](https://www.npmjs.com/package/@csszyx/unplugin) | Vite + Webpack + esbuild plugin         |
| [`@csszyx/compiler`](https://www.npmjs.com/package/@csszyx/compiler) | sz object to Tailwind class transform   |
| [`@csszyx/runtime`](https://www.npmjs.com/package/@csszyx/runtime)   | Runtime helpers + SSR hydration         |
| [`@csszyx/core`](https://www.npmjs.com/package/@csszyx/core)         | Rust/WASM: encoder, checksum, collision |
| [`@csszyx/cli`](https://www.npmjs.com/package/@csszyx/cli)           | Migration CLI + type generator          |
| [`@csszyx/types`](https://www.npmjs.com/package/@csszyx/types)       | Shared TypeScript types                 |

## License

MIT
