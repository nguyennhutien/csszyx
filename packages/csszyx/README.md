# csszyx

> Universal CSS-in-JS for Tailwind CSS with WASM core.

**csszyx** is a zero-runtime, framework-agnostic CSS-in-JS library that compiles your styles into atomic CSS classes at build time. It leverages a Rust-based WASM core for blisteringly fast performance and safety.

## Features

- ⚡ **Zero-Runtime Overhead**: Styles are extracted to static CSS.
- 🎨 **Tailwind Compatible**: Use your existing Tailwind config.
- 🛡️ **Type Safe**: Full TypeScript support.
- 🔒 **SSR Safe**: Built-in hydration mismatch protection.
- 📦 **WASM Power**: Core logic runs in WebAssembly.

## Installation

```bash
npm install csszyx
# or
pnpm add csszyx
# or
yarn add csszyx
```

## Quick Start

1. **Initialize your project**:

   ```bash
   npx csszyx init
   ```

2. **Start coding**:

   ```tsx
   import { _sz } from "csszyx";

   function Button() {
     return (
       <button className={_sz("bg-blue-500 text-white p-4")}>Click me</button>
     );
   }
   ```

## Packages

- **[@csszyx/unplugin](https://www.npmjs.com/package/@csszyx/unplugin)**: Integrations for Vite, Webpack, and more.
- **[@csszyx/cli](https://www.npmjs.com/package/@csszyx/cli)**: Command-line tools.
- **[@csszyx/core](https://www.npmjs.com/package/@csszyx/core)**: WASM core engine.

## License

MIT © [csszyx contributors](https://github.com/nguyennhutien/csszyx)
