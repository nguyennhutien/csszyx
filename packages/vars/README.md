# @csszyx/vars

CSS custom-property helpers for [CSSzyx](https://github.com/nguyennhutien/csszyx)
— inject and patch CSS variables for runtime-driven values.

Zero-runtime CSSzyx handles static `sz` props at build time. This package
handles the **values** that arrive at runtime (API, CMS, user config): inject
them as CSS custom properties so build-time Tailwind classes like
`bg-(--cfg-bg)` resolve against them. The classes stay static, safelisted, and
mangled — only the variable values move at runtime.

```tsx
// Build time (static, zero runtime):
<form sz={{ bg: "--cfg-bg", p: "--cfg-p" }} />;

// Runtime — point the variables at the config values:
import { applySzVars } from "@csszyx/vars";
applySzVars(
  { "cfg-bg": config.background, "cfg-p": `${config.padding}px` },
  formEl,
);
```

## Installation

```bash
pnpm add @csszyx/vars
```

## API

### `applySzVars(vars, element?)`

Sets each entry as a CSS custom property on `element` (defaults to `:root`).
Keys are auto-prefixed with `--`. Returns a cleanup function that removes
everything it set.

```ts
const cleanup = applySzVars({ "form-bg": "#fff", "form-p": "24px" }, formEl);
// formEl.style: --form-bg: #fff; --form-p: 24px
cleanup(); // removes them
```

### `patchSzVars(vars, element?)`

Sets values without tracking a cleanup — for frequent updates (drag sliders,
animation-driven values) where you overwrite the same properties each tick.

## React

```tsx
import { useSzVars } from "@csszyx/vars/react";

function ConfigurableForm({ config }) {
  const ref = useRef<HTMLFormElement>(null);
  // Re-applies whenever the values change; targets :root if no ref given.
  useSzVars({ "form-bg": config.bg, "form-p": `${config.p}px` }, ref);
  return <form ref={ref} sz={{ bg: "--form-bg", p: "--form-p" }} />;
}
```

Requires React ≥ 18. The core helpers work standalone — no React needed.

## vars vs `@csszyx/dynamic`

- **`@csszyx/vars`** — the _rule_ is known at build time, only the _value_
  changes: `bg-(--cfg-bg)` with a runtime-fed variable. Cheapest option; no CSS
  is generated at runtime.
- **[`@csszyx/dynamic`](https://www.npmjs.com/package/@csszyx/dynamic)** — the
  _rule itself_ is unknown until runtime (arbitrary sz objects from a CMS).
  Generates and injects CSS in the browser.

Prefer vars when a CSS variable can express the change.

## License

MIT
