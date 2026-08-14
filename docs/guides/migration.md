# Migrating from Tailwind CSS

CSSzyx provides a powerful CLI tool to automatically migrate your existing Tailwind CSS projects. This tool converts your `className` attributes into type-safe `sz` prop objects.

## Using the Migration CLI

The CLI parses your codebase, identifies Tailwind classes, and generates the equivalent `sz` prop logic.

### 1. Run the Migration

Run the migration command on your project directory:

```bash
npx csszyx migrate ./src
```

### 2. Options

| Option                | Description                                                       |
| --------------------- | ----------------------------------------------------------------- |
| `--dry-run`           | Preview changes without modifying files (recommended first step). |
| `--verbose`           | Show detailed logs of every transformation.                       |
| `--exclude <pattern>` | Glob pattern to exclude specific files (e.g. `**/*.test.tsx`).    |

### 3. Review Changes

The CLI will modify your files in place (unless `--dry-run` is used).

**Before:**

```tsx
<div className="p-4 bg-red-500 hover:bg-red-600">
  <span className="text-white font-bold">Hello</span>
</div>
```

**After:**

```tsx
<div sz={{ p: 4, bg: "red-500", hover: { bg: "red-600" } }}>
  <span sz={{ color: "white", weight: "bold" }}>Hello</span>
</div>
```

## Manual Migration

If you prefer to migrate manually or have complex dynamic classes, use the recommended mapping patterns:

- **Padding/Margin**: `p-4` -> `p: 4`, `mx-2` -> `mx: 2`
- **Colors**: `bg-red-500` -> `bg: 'red-500'`, `text-white` -> `color: 'white'`
- **Layout**: `flex` -> `display: 'flex'`, `grid` -> `display: 'grid'`
- **Font**: `font-bold` -> `weight: 'bold'`
- **Modifiers**: `hover:` -> `hover: { ... }`, `md:` -> `md: { ... }`

> **Note**: Always verify the changes after running the CLI, especially for complex string template literals.

## Upgrading to v0.9.0

v0.9.0 changes the default `build.parser` from `"oxc"` to `"rust"`.
The native Rust engine is faster but requires platform-specific binaries
(`@csszyx/core-*` packages, declared as `optionalDependencies`).

### If your platform is supported

No action needed — `pnpm install` / `npm install` installs the native
binary automatically. Supported platforms: linux-x64-gnu, linux-x64-musl,
linux-arm64-gnu, linux-arm64-musl, darwin-x64, darwin-arm64,
win32-x64-msvc, win32-arm64-msvc.

### If your platform is not supported

The build will fail with `CsszyxNativeUnavailableError` showing the
expected package name. Ask for the WebAssembly build of the same engine,
which ships inside `@csszyx/core` and needs no per-platform download:

```ts
// vite.config.ts / next.config.js
csszyx({
  build: { parser: "wasm" },
});
```

Or set the environment variable for a single build:

```bash
CSSZYX_PARSER=wasm pnpm build
```

> On v0.9.0 through v0.13.0 the fallback here was `"oxc"`. That lane and
> `"babel"` were removed in v0.14.0; `"wasm"` replaces both, and unlike
> them it is the same engine, so it cannot change a class.
