# Getting Started

Get up and running with csszyx in minutes.

## Installation

Install the csszyx umbrella package (includes compiler, runtime, types, and unplugin):

```bash
pnpm add csszyx
```

Or with npm:

```bash
npm install csszyx
```

## Setup

### 1. Configure Tailwind CSS v4

Create a CSS entry point with Tailwind v4 import:

```css
/* src/index.css */
@import "tailwindcss";
```

### 2. Add the csszyx Plugin

#### Vite + React

```ts
// vite.config.ts
import react from "@vitejs/plugin-react";
import csszyx from "csszyx/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [...csszyx(), react()],
});
```

#### Next.js (Webpack)

```js
// next.config.js
const withCsszyx = require("csszyx/webpack");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

module.exports = withCsszyx(nextConfig);
```

### 3. Initialize Runtime

In your app entry point:

```tsx
// main.tsx or app/layout.tsx
import { initRuntime } from "@csszyx/runtime";

initRuntime({
  development: process.env.NODE_ENV === "development",
  allowCSRRecovery: true,
  strictHydration: true,
  debug: false,
});
```

### 4. Start Using csszyx

Use the `sz` prop for type-safe styling:

```tsx
function Button({ isActive }) {
  return (
    <button
      sz={{
        px: 4,
        py: 2,
        rounded: "lg",
        fontWeight: "medium",
        bg: isActive ? "blue-600" : "gray-200",
        color: isActive ? "white" : "gray-900",
        hover: { bg: isActive ? "blue-700" : "gray-300" },
      }}
    >
      Click me
    </button>
  );
}
```

Or use runtime helpers for className composition:

```tsx
import { _sz, _szIf } from "@csszyx/runtime";

function Button({ isActive }) {
  return (
    <button
      className={_sz(
        "px-4 py-2 rounded-lg font-medium",
        _szIf(isActive, "bg-blue-600 text-white", "bg-gray-200 text-gray-900"),
      )}
    >
      Click me
    </button>
  );
}
```

## Framework-Specific Setup

See setup instructions above for both Vite + React and Next.js configurations.

## Basic Usage

### Concatenating Classes

Use `_sz()` to combine multiple class names:

```tsx
import { _sz } from "@csszyx/runtime";

<div className={_sz("p-4", "bg-red-500", "text-white")} />;
// Output: "p-4 bg-red-500 text-white"
```

### Conditional Classes

Use `_szIf()` for conditional styling:

```tsx
import { _szIf } from "@csszyx/runtime";

<div className={_szIf(isActive, "bg-blue-600", "bg-gray-200")} />;
// If isActive: "bg-blue-600"
// If not: "bg-gray-200"
```

### Switch-like Selection

Use `_szSwitch()` for multiple conditions:

```tsx
import { _szSwitch } from "@csszyx/runtime";

const variant = "primary";
const className = _szSwitch(
  [
    [variant === "primary", "bg-blue-600"],
    [variant === "secondary", "bg-gray-200"],
    [variant === "danger", "bg-red-600"],
  ],
  "bg-gray-500",
); // default
```

### Combining Helpers

Mix and match for complex scenarios:

```tsx
import { _sz, _szIf, _szSwitch } from "@csszyx/runtime";

function Button({ variant, isActive, fullWidth }) {
  return (
    <button
      className={_sz(
        "px-4 py-2 rounded-lg font-medium",
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

## Complete Example

Here's a complete button component:

```tsx
import { type ReactNode } from "react";
import { _sz, _szSwitch, _szIf } from "@csszyx/runtime";

type ButtonVariant = "primary" | "secondary" | "danger";

interface ButtonProps {
  children: ReactNode;
  variant?: ButtonVariant;
  onClick?: () => void;
  disabled?: boolean;
  fullWidth?: boolean;
}

export function Button({
  children,
  variant = "primary",
  onClick,
  disabled = false,
  fullWidth = false,
}: ButtonProps) {
  const baseClasses = "px-4 py-2 rounded-lg font-medium transition-all";

  const variantClasses = _szSwitch([
    [variant === "primary", "bg-blue-600 text-white hover:bg-blue-700"],
    [variant === "secondary", "bg-gray-200 text-gray-900 hover:bg-gray-300"],
    [variant === "danger", "bg-red-600 text-white hover:bg-red-700"],
  ]);

  return (
    <button
      className={_sz(
        baseClasses,
        variantClasses,
        _szIf(disabled, "opacity-50 cursor-not-allowed", "cursor-pointer"),
        _szIf(fullWidth, "w-full"),
      )}
      onClick={onClick}
      disabled={disabled}
      type="button"
    >
      {children}
    </button>
  );
}
```

## Next Steps

- [Runtime Helpers](/guide/runtime-helpers) - Learn all helper functions
- [SSR Safety](/guide/ssr-safety) - Understand hydration guards
- [API Reference](/api/runtime) - Complete API documentation
- [Examples](/examples/vite-react) - See real-world examples

## Troubleshooting

### Classes not applying

Make sure your CSS entry point imports Tailwind v4:

```css
/* src/index.css */
@import "tailwindcss";
```

### TypeScript errors

Ensure you're importing from the correct packages:

```tsx
import { _sz } from "@csszyx/runtime"; // ✅ Correct
import { _sz } from "@csszyx/compiler"; // ❌ Wrong package
```

### Hydration warnings in Next.js

Initialize the runtime in your root layout:

```tsx
// app/layout.tsx
import { initRuntime } from "@csszyx/runtime";

initRuntime({
  development: process.env.NODE_ENV === "development",
});
```

## Get Help

- [GitHub Issues](https://github.com/nguyennhutien/csszyx/issues)
- [Discussions](https://github.com/nguyennhutien/csszyx/discussions)
