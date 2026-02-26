# csszyx

## 0.1.3

### Patch Changes

- Strict color string validation — zero mismatch between TypeScript and Rust.
  String slash opacity (`bg: 'blue-500/20'`) now warns and is suppressed; use
  object form `{ bg: { color: 'blue-500', op: 20 } }` instead.
- `needs_brackets()` in Rust core expanded to match TypeScript exactly: added
  `ch`, `dvh`, `dvw`, `rad`, `turn`, `fr` units and color function prefixes
  (`rgb`, `hsl`, `oklch`, etc.).
- Removed redundant `| (string & {})` union on `bg` type in `sz-props.ts`.

## 0.1.2

### Patch Changes

- `csszyx` README: corrected architecture diagram, feature list, and usage examples.
- `@csszyx/unplugin` README: fixed plugin setup instructions and configuration options.
- `@csszyx/core` README: updated WASM API documentation and build instructions.

## 0.1.1

### Minor Changes

- CSS variable type hints for ambiguous properties — `fontFamily: '--var'` now
  emits `font-(family-name:--var)`, `fontWeight: '--var'` emits
  `font-(weight:--var)`, `text: '--var'` emits `text-(length:--var)`.
- Text/leading shorthand merge — `{ text: 'lg', leading: 7 }` compiles to `text-lg/7`.
- `insetShadowColor` property mapping (`inset-shadow-{color}`).

### Breaking Changes

- `text` key restricted to font-size only. Use `color` for text color, `textAlign`
  for alignment.
- `border` key restricted to width only. Use `borderColor` for border colors.
- `font` catch-all key removed. Use `fontWeight` or `fontFamily`. Using `font`
  now emits a dev warning.

## 0.1.0

### Minor Changes

- Initial public release.
- Build-time `sz` prop transform → Tailwind class strings via `@csszyx/unplugin`
  (Vite + Webpack + esbuild).
- Runtime helpers: `_sz`, `_szIf`, `_szSwitch`, `_szMerge`.
- SSR hydration safety: SHA-256 checksum verification via `@csszyx/core` WASM.
- Production class name mangling: reversed tier encoding (`p-4` → `z`).
- Full TypeScript types with autocomplete for all ~200 `sz` props.
- Tailwind CSS v4 compatibility (JIT engine).
