# CSSzyx Astro Solid Playground

Small validation app for the Astro + SolidJS integration path.

It intentionally covers only the risky integration points:

- Astro 6 + `@astrojs/solid-js`
- `csszyx/vite` before `@tailwindcss/vite`
- Solid JSX components using static `sz` objects
- Solid control flow with `<For>` and `<Show>`
- Local Solid JSX type augmentation for `sz`

Run:

```bash
pnpm --filter @csszyx/playground-astro-solid build
pnpm --filter @csszyx/playground-astro-solid dev
```
