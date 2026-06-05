# csszyx Next.js 16 Playground

This fixture covers the safe Next.js 16 contracts:

- `pnpm build && pnpm start` uses `next build --webpack` and the existing
  csszyx Webpack adapter. This is the full-parity path for `sz`, production
  mangling, and hydration metadata.
- `pnpm dev:source` uses `next dev --turbo` only to probe Tailwind v4 `@source`
  live regeneration. It does not claim `sz` transform support under Turbopack.
- `pnpm dev:turbo` runs `csszyx next watch` beside `next dev --turbo`. The
  watcher seeds the development safelist, batches shard updates, and removes
  classes after source deletion. The loader still materializes newly discovered
  classes synchronously so JavaScript HMR cannot arrive before matching CSS.

For process debugging, run the same flow in two terminals:

```bash
pnpm run watch:turbo
pnpm run dev:turbo:next
```

Turbopack production class/CSS-variable mangling stays unsupported until csszyx
has a safe public finalization path for CSS/JS asset rewriting.
