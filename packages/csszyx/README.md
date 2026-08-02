# csszyx

> CSS-in-JS for Tailwind CSS v4 — object syntax at build time, class mangling
> in production, SSR-safe hydration.

## Features

- **Build-time transforms** — the `sz` prop compiles to atomic Tailwind classes; static styles cost zero runtime
- **Production mangling** — opt-in class-name obfuscation (`p-4` → `z`) with a native Rust engine driving the build
- **SSR hydration safety** — SHA-256 checksum validation, abort-and-preserve on mismatch
- **Variant authoring** — `szv` factories for finite enum props, extracted and safelisted at build time
- **Mangle-aware merging** — `szcn` resolves last-wins overrides even on mangled classes
- **Tailwind CSS v4** — full compatibility with Tailwind's JIT engine, including custom `@theme` tokens
- **TypeScript** — fully typed `sz` prop with autocomplete for utilities, variants, and your theme

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

Webpack (including Next.js) uses `csszyx/webpack`; other bundlers go through
[`@csszyx/unplugin`](https://www.npmjs.com/package/@csszyx/unplugin).

### 2. Use the `sz` prop

```tsx
function Button() {
  return (
    <button sz={{ bg: "blue-500", color: "white", p: 4 }}>Click me</button>
  );
}
```

At build time this compiles to `className="bg-blue-500 text-white p-4"`. Turn on
`production.mangle` and those classes become short tokens backed by the same CSS.

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

## Variants with `szv`

For a finite enum prop (severity, size, intent), declare the variants once —
every combination is compiled and safelisted at build time:

```tsx
import { szv } from "csszyx";

const calloutSz = szv({
  variants: {
    severity: {
      info: { bg: { color: "sky-500", op: 10 }, color: "sky-700" },
      warning: { bg: { color: "amber-500", op: 10 }, color: "amber-700" },
    },
  },
  defaultVariants: { severity: "info" },
});

<div sz={calloutSz({ severity })} />;
```

## Runtime composition

For dynamic class composition use the public helpers from
[`@csszyx/runtime`](https://www.npmjs.com/package/@csszyx/runtime):

```tsx
import { szr, szcn } from "@csszyx/runtime";

// Concatenate (mangle-aware, filters falsy)
<div className={szr("p-4", isActive && "bg-blue-500")} />;

// Merge with last-wins override per utility (survives production mangling)
<div className={szcn("gap-2 p-4", overrideClasses)} />;
```

## Packages

| Package                                                                  | Description                                           |
| ------------------------------------------------------------------------ | ----------------------------------------------------- |
| [`csszyx`](https://www.npmjs.com/package/csszyx)                         | Umbrella package (re-exports all)                     |
| [`@csszyx/unplugin`](https://www.npmjs.com/package/@csszyx/unplugin)     | Vite + Webpack + esbuild + Rollup plugin              |
| [`@csszyx/compiler`](https://www.npmjs.com/package/@csszyx/compiler)     | sz object to Tailwind class transform                 |
| [`@csszyx/runtime`](https://www.npmjs.com/package/@csszyx/runtime)       | szr / szcn / szv / splitBox + SSR hydration           |
| [`@csszyx/core`](https://www.npmjs.com/package/@csszyx/core)             | Rust core: native transform engine, encoder, checksum |
| [`@csszyx/dynamic`](https://www.npmjs.com/package/@csszyx/dynamic)       | Runtime CSS injection for API/CMS-driven styling      |
| [`@csszyx/cli`](https://www.npmjs.com/package/@csszyx/cli)               | Migration CLI, project doctor, collision scanner      |
| [`@csszyx/vars`](https://www.npmjs.com/package/@csszyx/vars)             | CSS custom-property helpers for runtime values        |
| [`@csszyx/mcp-server`](https://www.npmjs.com/package/@csszyx/mcp-server) | MCP server for AI agents (Cursor, Claude, …)          |
| [`@csszyx/types`](https://www.npmjs.com/package/@csszyx/types)           | Shared TypeScript types                               |

## Documentation

Guides, full sz-prop reference, SSR, and migration:
<https://csszyx.com>

## License

MIT
