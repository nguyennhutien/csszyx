# csszyx

## 0.3.1

### Patch Changes

- **fix(compiler):** `color` + `leading` props no longer merge into an invalid `text-color/leading` shorthand — the text/leading shorthand regex is now restricted to font-size suffixes only.
- **fix(compiler):** `content` (CSS content property) and `alignContent` (align-content layout) are now separate handlers — previously both mapped to `content-*` causing a naming collision. A single sz object can now express both simultaneously.

## 0.3.0

### Minor Changes

- feat(compiler): add sz props — scheme, fieldSizing, rotateX/Y/Z, skewX/Y, proseInvert; improve arbitrary value and negative number handling

  fix(unplugin): resolve class mangling collision — negative lookahead prevents re-encoding of already-mangled symbols; Babel piggyback prescan eliminates false positives from JSDoc and string literals

  feat: add @csszyx/vars package — low-level CSS custom property helpers (applySzVars, patchSzVars for vanilla JS; useSzVars hook via @csszyx/vars/react)

### Patch Changes

- @csszyx/compiler@0.3.0
- @csszyx/runtime@0.3.0
- @csszyx/core@0.3.0
- @csszyx/types@0.3.0
- @csszyx/unplugin@0.3.0
- @csszyx/vars@0.3.0

## 0.2.0

### Minor Changes

- Add 21 Tailwind v4.2 logical/block props: pbs/pbe, mbs/mbe, blockSize/inlineSize families,
  insetS/E/Bs/Be, borderBs/Be, scrollPbs/Pbe/Mbs/Mbe, fontFeatures. New color names: mauve,
  olive, mist, taupe. The `start`/`end` props now emit `inset-s-*`/`inset-e-*` (TW v4.2
  deprecation; CSS output unchanged).

### Patch Changes

- Updated dependencies
  - @csszyx/compiler@0.2.0
  - @csszyx/runtime@0.2.0
  - @csszyx/core@0.2.0
  - @csszyx/types@0.2.0
  - @csszyx/unplugin@0.2.0

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
