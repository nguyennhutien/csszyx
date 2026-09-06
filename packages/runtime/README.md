# @csszyx/runtime

Runtime helpers for [CSSzyx](https://github.com/nguyennhutien/csszyx) — className
composition, mangle-aware merging, variant authoring, box-model class routing,
and SSR hydration guards.

Most CSSzyx styling is **zero-runtime**: the build plugin compiles `sz` props to
static class strings. This package is what runs in the browser for the parts
that can't be static — resolving variant factories, merging overrides, routing
classes to nested elements, and verifying the mangle map during hydration.

## Installation

```bash
pnpm add @csszyx/runtime
```

Keep it a **direct** dependency: the build transform injects bare
`@csszyx/runtime` imports into your modules, which strict package managers
(pnpm) only resolve for direct dependencies.

## The helpers you author with

> Helpers with a `_` prefix (`_sz`, `_szMerge`, …) are **compiler-injected** —
> the build transform emits calls to them. Don't hand-author them; use the
> public names below.

The full-runtime `_szMerge` uses the same mangle-aware, utility-group last-wins
engine as `szcn`; generated `className + sz` merges therefore follow the same
override contract. The deliberately tiny `@csszyx/runtime/lite` compatibility
helper only removes exact duplicate tokens—it avoids the classification graph
that would grow the built lite entry from about 1.7 kB to about 59 kB.

### `szr(...inputs)` — resolve to a className

Resolves sz objects and/or class strings into one mangle-aware className.
Concatenates, filters falsy — the hand-written name for what the compiler
injects as `_sz`.

```tsx
import { szr, szv } from "@csszyx/runtime";

const cardSz = szv({ variants: { pad: { lg: { p: 8 } } } });

<div className={szr(cardSz({ pad: "lg" }), isActive && "active")} />;
```

### `szcn(...classes)` — merge with last-wins override

Merges className strings so a later class **overrides** an earlier one of the
same utility — the merge for the single resolution point of a layered
component, and for combining a part's defaults with a consumer override.

```ts
import { szcn } from "@csszyx/runtime";

szcn("gap-2 p-4", "gap-8"); // → 'p-4 gap-8'   (gap-8 wins)
szcn("pb-4", "p-8"); // → 'p-8'         (shorthand covers the longhand)
szcn("text-base", "text-sm"); // → 'text-sm'     (same property group)
szcn("text-red-500", "text-sm"); // → 'text-red-500 text-sm' (color vs size co-exist)
```

Unlike `tailwind-merge`, `szcn` keeps working in production builds where CSSzyx
**mangles** class names — it decodes tokens through the runtime mangle map
before grouping. Fail-safe contract: a class it cannot confidently group is
kept, never dropped.

Custom `@theme` tokens join the merge groups automatically when the build
plugin scans your CSS (`build.scanCss`); for utility-shaped classes written in
plain CSS, register them once with `registerSzcnGroups({ colors: [...] })`.

### `szv(config)` — variant authoring

Type-safe variant factory (the CVA equivalent for sz objects). Every variant
combination is extracted and safelisted at build time.

```tsx
import { szv } from "@csszyx/runtime";

const buttonSz = szv({
  base: { display: "inline-flex", rounded: "md" },
  variants: {
    intent: {
      primary: { bg: "blue-500", color: "white" },
      danger: { bg: "red-500", color: "white" },
    },
  },
  defaultVariants: { intent: "primary" },
});

<button sz={buttonSz({ intent: "danger" })} />;
```

### `splitBox(className)` — route one className to nested elements

Partitions a flat className at the CSS box-model border line: margin/position
onto the outer element, padding/overflow/text onto the inner one. Comes with a
class toolkit — `classify`, `has`, `pick`, `omit` — and sz-object analogs
(`splitBoxSz`, `hasSz`, `pickSz`, `omitSz`).

```ts
import { splitBox } from "@csszyx/runtime";

const { outer, inner } = splitBox("m-4 px-2 md:flex");
// outer: "m-4"   inner: "px-2 md:flex"
```

The vocabulary is atomic utilities — a class whose name states one feature. A
custom `@utility` declaring several properties at once is out of scope on
purpose: `classify` returns `undefined` for it and the helpers leave it where
it is, rather than guessing which element half of its declarations belong to.

For a project that only reads className strings, `@csszyx/runtime/split`
publishes these five without the sz-object adapters — worth 27% under
`require()`, and within 76 B of the main entry under a bundler that
tree-shakes.

### `stripSzProps(props)` — safe prop forwarding

Removes `sz`/`szs`/`szRecover` from a props object before spreading onto a DOM
element, so wrappers don't leak framework props into the DOM.

## SSR hydration guards

In production, CSSzyx injects a mangle map and SHA-256 checksum into the HTML.
These helpers verify integrity during hydration and abort — preserving the
server-rendered HTML — instead of hydrating against a mismatched map:

```ts
import { guardHydration, loadManifestFromDOM } from "@csszyx/runtime";

const manifest = loadManifestFromDOM();
if (manifest && !guardHydration(manifest)) {
  console.error("Hydration guard failed — mangle map mismatch");
}
```

The full surface — `verifyMangleChecksum` / `verifyMangleChecksumAsync`,
`abortHydration`, `isHydrationAborted`, `attemptCSRRecovery`,
`verifyRecoveryToken`, `getHydrationErrors` — is documented in the
[runtime reference](https://csszyx.com/docs/reference/runtime/). Per-element
recovery is opted in via the `szRecover` JSX attribute (`"csr"` or
`"dev-only"`), not a global flag.

## Lite entry

`@csszyx/runtime/lite` ships only the injected concatenation helpers (`_sz`,
`_sz2`, `_sz3`, `_szMerge`, `__szColorVar`) with no hydration machinery — for
edge/serverless bundles that only need the compiled output to run.

## Documentation

Full API reference with worked examples:
<https://csszyx.com/docs/reference/runtime/>

## License

MIT
