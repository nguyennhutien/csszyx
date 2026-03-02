# Vite + React Example

Complete example demonstrating CSSzyx with Vite and React.

## Overview

This example showcases:

- Runtime className composition with `_sz()` helpers
- Dynamic styling based on state
- Conditional className application
- Dark mode support
- Interactive components

## Source Code

Full source available at [`playground/vite-react`](https://github.com/nguyennhutien/csszyx/tree/main/playground/vite-react)

## Live Demo

[View Live Demo →](https://csszyx-vite-react.vercel.app)

## Project Structure

```
playground/vite-react/
├── src/
│   ├── components/
│   │   ├── Button.tsx          # Button with variants
│   │   ├── Card.tsx            # Card component
│   │   └── DynamicExample.tsx  # Dynamic styling demo
│   ├── App.tsx                 # Main app
│   ├── main.tsx               # Entry point
│   └── index.css              # Global styles
├── index.html
├── vite.config.ts
├── tailwind.config.js
└── package.json
```

## Key Components

### Button Component

Demonstrates variant-based styling:

```tsx
import { _sz, _szSwitch } from "@csszyx/runtime";

type ButtonVariant = "primary" | "secondary" | "danger";

function Button({ variant = "primary", disabled = false }) {
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
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
      )}
      disabled={disabled}
    >
      Click me
    </button>
  );
}
```

### Dynamic Example

Shows state-driven styling:

```tsx
import { useState } from "react";
import { _sz, _szIf } from "@csszyx/runtime";

function DynamicExample() {
  const [isActive, setIsActive] = useState(false);
  const [size, setSize] = useState<"small" | "medium" | "large">("medium");

  const getSizeClasses = () => {
    switch (size) {
      case "small":
        return "text-sm p-2";
      case "medium":
        return "text-base p-3";
      case "large":
        return "text-lg p-4";
    }
  };

  return (
    <div
      className={_sz(
        "rounded-lg border-2 transition-all",
        getSizeClasses(),
        _szIf(
          isActive,
          "bg-green-100 border-green-500",
          "bg-gray-100 border-gray-300",
        ),
      )}
    >
      Status: {isActive ? "Active" : "Inactive"}
    </div>
  );
}
```

## Running Locally

### Install Dependencies

```bash
pnpm install
```

### Start Development Server

```bash
cd playground/vite-react
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

### Build for Production

```bash
pnpm build
```

### Preview Production Build

```bash
pnpm preview
```

## Features Demonstrated

### 1. Basic Concatenation

```tsx
<div className={_sz("p-4", "bg-red-500", "text-white")} />
```

### 2. Conditional Styling

```tsx
<div className={_sz("base", _szIf(isActive, "active", "inactive"))} />
```

### 3. Switch-like Selection

```tsx
const className = _szSwitch(
  [
    [status === "success", "text-green-500"],
    [status === "error", "text-red-500"],
  ],
  "text-gray-500",
);
```

### 4. Dark Mode

```tsx
const [darkMode, setDarkMode] = useState(false);

<div
  className={_sz(
    "min-h-screen",
    _szIf(darkMode, "bg-gray-900 text-white", "bg-gray-50 text-gray-900"),
  )}
/>;
```

### 5. Responsive Design

```tsx
<div className="text-sm md:text-base lg:text-lg">Responsive text</div>
```

## Performance

- **Bundle Size**: ~45KB (minified + gzipped)
- **Runtime Overhead**: Minimal (< 1KB for helpers)
- **First Paint**: < 100ms
- **Time to Interactive**: < 200ms

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## Next Steps

- [Next.js Example](/examples/nextjs) - SSR example
- [Runtime API](/api/runtime) - Complete API reference
- [Getting Started](/guide/getting-started) - Setup guide
