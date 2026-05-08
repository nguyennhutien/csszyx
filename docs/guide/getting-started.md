# Getting Started

Get up and running with CSSzyx in minutes.

## Installation

```bash
npm install csszyx
```

This installs the umbrella package which includes compiler, runtime, types, and unplugin.

## Setup by Platform

### Vite + React

```ts
// vite.config.ts
import { defineConfig } from "vite";
import csszyx from "csszyx/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    // Order matters: csszyx → tailwindcss → react
    ...csszyx(),
    tailwindcss(),
    react(),
  ],
});
```

**Why this order?** CSSzyx transforms `sz` props into `className` strings first. Then Tailwind scans those strings to generate CSS. Finally React handles JSX.

### Next.js

```ts
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    const csszyxWebpack = require("@csszyx/unplugin/webpack").default;
    config.plugins.push(csszyxWebpack());
    return config;
  },
};

export default nextConfig;
```

### Webpack + React

```js
// webpack.config.js
import csszyx from "csszyx/webpack";

export default {
  // ... your config
  plugins: [
    csszyx(),
    // ... other plugins
  ],
};
```

Make sure you have `postcss-loader` with Tailwind CSS configured in your module rules.

## Tailwind CSS v4

CSSzyx requires Tailwind CSS v4. Create a CSS entry point:

```css
/* src/index.css */
@import "tailwindcss";
```

Import this file in your app entry point.

## Usage

### The `sz` Prop

Use the `sz` prop for type-safe, object-based styling:

```tsx
<div
  sz={{
    p: 4,
    bg: "blue-500",
    color: "white",
    rounded: "lg",
    hover: { bg: "blue-600" },
  }}
>
  Hello World
</div>
```

At build time, CSSzyx transforms this into:

```html
<div class="p-4 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
  Hello World
</div>
```

### Runtime Helpers

For className-based composition, use runtime helpers:

```tsx
import { _sz, _szIf, _szSwitch } from "csszyx";

// Concatenate classes
<div className={_sz("p-4", "bg-red-500", "text-white")} />

// Conditional classes
<div className={_szIf(isActive, "bg-blue-600", "bg-gray-200")} />

// Switch-like selection
const className = _szSwitch(
  [
    [variant === "primary", "bg-blue-600 text-white"],
    [variant === "secondary", "bg-gray-200 text-gray-900"],
    [variant === "danger", "bg-red-600 text-white"],
  ],
  "bg-gray-500", // default
);
```

### Combining Helpers

```tsx
import { _sz, _szIf, _szSwitch } from "csszyx";

function Button({ variant, isActive, fullWidth }) {
  return (
    <button
      className={_sz(
        "px-4 py-2 rounded-lg",
        _szSwitch([
          [variant === "primary", "bg-blue-600 text-white"],
          [variant === "secondary", "bg-gray-200 text-gray-900"],
        ]),
        _szIf(isActive, "ring-2 ring-blue-400"),
        _szIf(fullWidth, "w-full"),
      )}
    >
      Button
    </button>
  );
}
```

## Plugin Options

Pass options to customize behavior:

```ts
csszyx({
  development: {
    debug: true, // Enable debug logging
    strictMode: false, // Treat warnings as errors
  },
  build: {
    astBudgetLimit: 50_000, // Abort transform past this AST node count
  },
  production: {
    injectChecksum: true, // Inject SSR hydration checksum
  },
});
```

> Recovery is now controlled per-element via the `szRecover` JSX attribute (`"csr"` or `"dev-only"`). See [SSR Safety](/guide/ssr-safety) for details.

## Optional: Initialize Runtime

For SSR hydration safety features, initialize the runtime in your app entry:

```tsx
import { initRuntime } from "@csszyx/runtime";

initRuntime({
  development: process.env.NODE_ENV === "development",
  strictHydration: true,
  debug: false,
});
```

This is optional — CSSzyx works without it, but SSR hydration guards require initialization.

## Troubleshooting

### Classes not applying

Make sure your CSS entry point imports Tailwind v4:

```css
@import "tailwindcss";
```

### Plugin order matters

CSSzyx must be **before** Tailwind and React plugins. If classes aren't being generated, check your plugin order.

### TypeScript errors with `sz` prop

The `sz` prop types come from `@csszyx/types`. If you get type errors, make sure `csszyx` is installed (it re-exports the types).

### Hydration warnings in Next.js

Initialize the runtime in your root layout, then mark the elements that should accept client-side recovery with `<section szRecover="csr">…</section>`. Without `szRecover`, hydration mismatches abort the affected subtree (safe default).

## Next Steps

- [Runtime Helpers](/guide/runtime-helpers) - All helper functions
- [SSR Safety](/guide/ssr-safety) - Hydration guards
- [API Reference](/api/runtime) - Complete API docs
- [Examples](/examples/vite-react) - Real-world examples

## Get Help

- [GitHub Issues](https://github.com/nguyennhutien/csszyx/issues)
