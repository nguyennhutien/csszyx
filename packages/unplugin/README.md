# @csszyx/unplugin

> Vite, Webpack, and Rollup integration for csszyx.

This package provides the build-time transformations needed to make csszyx work. It handles:

- 🔍 Extracting styles from your code.
- 🎨 Generating static CSS.
- 🧩 Mangling class names for production.
- ⚡ Injecting hydration scripts.

## Installation

```bash
npm install -D @csszyx/unplugin
```

## Usage

### Vite

```ts
// vite.config.ts
import { defineConfig } from "vite";
import csszyx from "@csszyx/unplugin/vite";

export default defineConfig({
  plugins: [csszyx()],
});
```

### Webpack

```js
// webpack.config.js
import csszyx from "@csszyx/unplugin/webpack";

export default {
  plugins: [csszyx()],
};
```

## Features

- **Universal Support**: Works with standard unplugin hooks.
- **HTML Injection**: Automatically injects mangle maps and checksums.
- **Hot Module Replacement**: Updates styles instantly in dev.
- **CSS Mangling**: Compresses class names (e.g., `text-center` -> `a`) in production.

## License

MIT © [csszyx contributors](https://github.com/nguyennhutien/csszyx)
