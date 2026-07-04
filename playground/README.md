# CSSzyx Playgrounds

Real app fixtures for validating the CSSzyx pipeline end-to-end — transform,
safelisting, production mangling, and SSR hydration in actual bundler + framework
combinations. The Playwright suites in [`packages/e2e`](../packages/e2e) start
these apps and assert against the served output.

## Playgrounds

| Directory                           | Stack                         | Exercises                                                                                                 |
| ----------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| [`vite-react/`](./vite-react)       | React + Vite                  | The primary fixture: `sz` transform, HMR class discovery, mangling, hydration recovery routes (`?page=…`) |
| [`nextjs-ssr/`](./nextjs-ssr)       | Next.js (Webpack)             | SSR + RSC: server-rendered mangled classes, checksum injection, hydration safety                          |
| [`nextjs-16/`](./nextjs-16)         | Next.js 16                    | Webpack production parity plus the Turbopack dev path (`csszyx next watch` safelist maintenance)          |
| [`webpack-react/`](./webpack-react) | React + raw Webpack           | The standalone Webpack adapter outside Next.js                                                            |
| [`react17/`](./react17)             | React 17 + Vite               | Peer-range floor: `@csszyx/dynamic` and runtime helpers on pre-18 React                                   |
| [`live-style/`](./live-style)       | React + Vite + `@csszyx/vars` | Runtime-driven values through CSS custom properties (config panel → live form styling)                    |
| [`vanilla-html/`](./vanilla-html)   | No bundler                    | The CDN/IIFE runtime (`csszyx/browser`): `sz="…"` attributes compiled in the browser                      |
| [`astro-solid/`](./astro-solid)     | Astro + SolidJS               | Solid JSX integration: `csszyx/vite` ordering, `<For>`/`<Show>` control flow, `sz` type augmentation      |

## Running one

Each playground is a workspace package:

```bash
cd playground/vite-react
pnpm dev
```

Build packages first (playgrounds import from `dist/`, not `src/`):

```bash
pnpm build   # from the repo root
```

## Running the e2e suites against them

```bash
pnpm test:e2e          # from the repo root
# or:
cd packages/e2e && pnpm exec playwright test --project=vite-react
```

The Playwright config starts the right playground dev server per project — see
[`packages/e2e/playwright.config.ts`](../packages/e2e/playwright.config.ts).

## What to check in a production build

- Classes in the DOM are mangled (`.z`, `.y` — not `.p-4`, `.bg-red-500`)
- The emitted CSS contains the same mangled selectors
- `data-sz-checksum` is present in the HTML and hydration passes cleanly
- No csszyx warnings or errors in the console
