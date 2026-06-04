# csszyx Next.js 16 Playground

This fixture covers the safe Next.js 16 contracts:

- `pnpm build && pnpm start` uses `next build --webpack` and the existing
  csszyx Webpack adapter. This is the full-parity path for `sz`, production
  mangling, and hydration metadata.
- `pnpm dev:source` uses `next dev --turbo` only to probe Tailwind v4 `@source`
  live regeneration. It does not claim `sz` transform support under Turbopack.

Turbopack production class/CSS-variable mangling stays unsupported until csszyx
has a safe public finalization path for CSS/JS asset rewriting.
