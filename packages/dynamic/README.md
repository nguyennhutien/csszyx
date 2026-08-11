# @csszyx/dynamic

Runtime CSS injection for [CSSzyx](https://github.com/nguyennhutien/csszyx) —
turn sz objects into class strings **at runtime**, injecting CSS only for
classes not already in your pre-built stylesheet.

Static styles belong in the build (`sz` prop / `szv` — zero runtime cost).
`dynamic()` is the escape hatch for values that genuinely cannot be known at
build time: styling driven by a CMS, an API response, or user configuration.

```tsx
import { dynamic } from "@csszyx/dynamic";

const cls = dynamic(apiResponse.field.style); // e.g. { p: 4, bg: 'blue-500' }
<div className={cls} />;
```

## How it works

1. **Manifest delta check** — a build-generated manifest lists every class in
   the built CSS. Classes already covered are returned as-is (mangled in
   production), with no injection.
2. **CSS generation** — classes NOT in the manifest get a CSS rule generated in
   the browser using Tailwind v4 variable patterns.
3. **21-tier injection** — rules insert into per-breakpoint
   `CSSStyleSheet`s whose order matches the Tailwind cascade, so
   `sm:`/`md:`/`max-*`/container-query variants win in the right order
   regardless of injection timing.

SSR-safe: on the server, `dynamic()` returns class names without touching the
CSSOM (and applies the build's mangle map during SSG so classes match the
mangled CSS).

## Installation

```bash
pnpm add @csszyx/dynamic
```

## API

```ts
import { dynamic, dynamicReport, cleanup, purifySz } from "@csszyx/dynamic";

// Untrusted input (JSON from a CMS)? Sanitize before injecting:
const cls = dynamic(purifySz(untrustedSzObject));

// Development: did the build-time manifest earn its transfer here?
console.log(dynamicReport().summary);

// Release injected sheets + manifest cache (e.g. on route teardown)
cleanup();
```

### The manifest is opt-in

`dynamic()` can consult `csszyx-manifest.json` to skip injecting rules the built
CSS already has, but the build does not emit it unless asked
(`build: { emitManifest: true }`). Without one, `dynamic()` treats nothing as
pre-built and generates its own rules — identical styles, different bytes.

The file lists the whole class census to answer questions about the few classes
`dynamic()` renders, so it only pays off once most of the app is styled at
runtime. If you enable it, `await preloadManifest()` before the first render:
`dynamic()` is synchronous and the fetch is not, so an unawaited manifest
arrives after everything has already been injected and the build pays both
costs.

```ts
import { preloadManifest } from "@csszyx/dynamic";

await preloadManifest(); // before the first render
```

## React

```tsx
import { useSz, CsszyxProvider } from "@csszyx/dynamic/react";

function FormField({ schema }) {
  const { sz } = useSz(); // stable reference; manages manifest + cleanup
  return <div className={sz(schema.style)}>{schema.label}</div>;
}

// Custom manifest URL, for a non-root deployment that opted into the manifest:
<CsszyxProvider manifest="/assets/csszyx-manifest.json">
  <App />
</CsszyxProvider>;
```

`useSz` handles manifest preloading on mount and releases the shared
stylesheets when the **last** consumer unmounts (StrictMode-safe).

## When NOT to use this

- A finite set of styles selected by a prop → use `szv` (build-time, typed).
- Literal styles → use the `sz` prop.
- A runtime **value** inside an otherwise static rule (`bg-(--user-color)`) →
  consider [`@csszyx/vars`](https://www.npmjs.com/package/@csszyx/vars) + a CSS
  variable instead of generating rules per value.

Injected rules live for the session and are not individually removed — apps
that feed continuously varying values (a new arbitrary width per animation
frame) will grow the CSSOM. In development, a one-time warning fires if a
session crosses a large number of unique injected classes.

## Documentation

<https://csszyx.com/docs/dynamic/>

## License

MIT
