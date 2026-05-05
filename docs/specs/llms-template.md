# CSSzyx

> Object-syntax Tailwind CSS. Type-safe. Zero runtime. SSR-safe.

CSSzyx is a build-time CSS framework that transforms JSX `sz` props into Tailwind v4 utility classes. The compiler runs at build time — no runtime overhead in the browser.

## Install

```bash
npm install csszyx
```

### Vite

```js
// vite.config.ts
import csszyx from "csszyx/vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    ...csszyx(), // csszyx MUST come before tailwindcss
    tailwindcss(),
  ],
});
```

### Next.js (Webpack)

```js
// next.config.js
const csszyxWebpack = require("@csszyx/unplugin/webpack").default;

module.exports = {
  webpack(config) {
    config.plugins.unshift(...csszyxWebpack());
    return config;
  },
};
```

## Core Syntax

### Basic usage

```tsx
// Before (Tailwind)
<div className="flex items-center p-4 bg-blue-500 rounded-lg" />

// After (CSSzyx)
<div sz={{ flex: true, items: 'center', p: 4, bg: 'blue-500', rounded: 'lg' }} />
```

The compiler transforms `sz` props → Tailwind classes at build time. The browser never sees `sz`.

### Boolean shorthand

Many display/position properties accept `true`:

```tsx
<div sz={{ flex: true, relative: true, hidden: true }} />
// → className="flex relative hidden"
```

### Arbitrary values

```tsx
<div sz={{ w: "333px", top: "-1px", bg: "#316ff6" }} />
// → className="w-[333px] top-[-1px] bg-[#316ff6]"
// Note: compiler auto-wraps in [] — no need to add them yourself
```

### CSS variables

```tsx
<div sz={{ color: "--ds-primary", p: "--spacing-4" }} />
// → className="text-(--ds-primary) p-(--spacing-4)"
// Sugar: any value starting with -- is auto-wrapped in ()
```

### Color with opacity

```tsx
<div sz={{ bg: { color: 'blue-500', op: 50 } }} />
// → className="bg-blue-500/50"

// Hex/rgb/hsl values are auto-wrapped in brackets
<div sz={{ bg: { color: '#0d0d12', op: 90 } }} />
// → className="bg-[#0d0d12]/90"

// Sub-half-step decimals use arbitrary brackets
<div sz={{ bg: { color: 'black', op: 0.05 } }} />
// → className="bg-black/[0.05]"
```

## Variants

Variants are nested objects:

```tsx
<div
  sz={{
    bg: "white",
    hover: { bg: "blue-100" },
    dark: { bg: "gray-800" },
    md: { p: 8 },
    focus: { outline: "none", ring: 2 },
  }}
/>
```

### Responsive

```tsx
sz={{ w: 'full', md: { w: '1/2' }, lg: { w: '1/3' } }}
// → className="w-full md:w-1/2 lg:w-1/3"
```

### State modifiers

```tsx
sz={{
  hover: { bg: 'sky-700' },
  focus: { outline: 'none' },
  active: { opacity: 80 },
  disabled: { opacity: 50 },
  focusVisible: { ring: 2 },
}}
```

### Dark mode

```tsx
sz={{ bg: 'white', dark: { bg: 'gray-900' } }}
```

### Group / Peer

```tsx
sz={{ group: { hover: { color: 'white' } } }}
// → className="group-hover:text-white"

sz={{ peer: { checked: { bg: 'blue-500' } } }}
// → className="peer-checked:bg-blue-500"
```

### Group Data / ARIA (parent data-_and aria-_ attributes)

```tsx
// group-data: style children based on data-* attr on group parent
sz={{ group: { data: { active: { color: 'blue-600' } } } }}
// → className="group-data-[active]:text-blue-600"

sz={{ group: { data: { 'state=open': { bg: 'green-50' } } } }}
// → className="group-data-[state=open]:bg-green-50"

// named group + data
sz={{ group: { card: { data: { active: { color: 'blue-600' } } } } }}
// → className="group-data-[active]/card:text-blue-600"

// group-aria: standard states use bare form, non-standard use brackets
sz={{ group: { aria: { expanded: { color: 'blue-600' } } } }}
// → className="group-aria-expanded:text-blue-600"

sz={{ group: { aria: { 'current=page': { fontWeight: 'bold' } } } }}
// → className="group-aria-[current=page]:font-bold"

// peer-data / peer-aria work the same way
sz={{ peer: { data: { error: { color: 'red-600' } } } }}
// → className="peer-data-[error]:text-red-600"

sz={{ peer: { aria: { checked: { bg: 'blue-100' } } } }}
// → className="peer-aria-checked:bg-blue-100"
```

### Data / ARIA attributes

```tsx
sz={{ data: { active: { bg: 'blue' } } }}
// → className="data-[active]:bg-blue"

sz={{ aria: { expanded: { color: 'blue' } } }}
// → className="aria-expanded:text-blue"
```

### Pseudo-elements

```tsx
sz={{ before: { content: '""' }, after: { bg: 'blue-500' } }}
// content: '""' → content-[''] (compiler normalizes double-quote form to single-quote)
// content: "''" also works → content-[''] (same output)
sz={{ placeholder: { color: 'gray-400' } }}
```

### Container queries

```tsx
sz={{ '@container': true, '@md': { flex: true } }}
// → className="@container @md:flex"
```

## Critical Rules — Common Mistakes

```tsx
// ❌ CSS property names as keys — use sz keys
{ padding: 4 }               // Wrong → { p: 4 }
{ backgroundColor: 'blue' }  // Wrong → { bg: 'blue' }
{ flexDirection: 'col' }     // Wrong → { flexDir: 'col' }
{ marginTop: 4 }             // Wrong → { mt: 4 }
{ fontSize: 'lg' }           // Wrong → { text: 'lg' }

// ❌ Manual brackets — compiler auto-wraps arbitrary values
{ w: '[333px]' }             // Wrong → { w: '333px' }
{ top: '[-1px]' }            // Wrong → { top: '-1px' }

// ❌ Tailwind class strings as values
{ p: 'p-4' }                 // Wrong → { p: 4 }
{ bg: 'bg-blue-500' }        // Wrong → { bg: 'blue-500' }

// ❌ Mixing className= and sz= on the same element
<div className="p-4" sz={{ m: 2 }} />  // Wrong — use sz only

// ✅ Correct
{ p: 4, bg: 'blue-500', flex: true, flexDir: 'col', w: '333px', mt: 4, text: 'lg' }
```

{{CONTENT_SLOT}}

## css: {} — Arbitrary CSS Escape Hatch

For CSS properties with no sz prop or Tailwind equivalent. Keys are camelCase; the compiler
converts to kebab-case. CSS custom properties (`--*`) are passed through unchanged.

```tsx
<div sz={{ p: 4, css: { writingMode: 'vertical-lr', touchAction: 'none' } }} />
// → p-4 [writing-mode:vertical-lr] [touch-action:none]

<div sz={{ hover: { css: { cursor: 'crosshair' } } }} />
// → hover:[cursor:crosshair]

<div sz={{ css: { '--my-color': 'red' } }} />
// → [--my-color:red]
```

TypeScript: `css?` is typed as `CSS.Properties` — full IDE autocomplete, typo protection.
Works inside `dynamic()` at runtime.

## sz Array Syntax

Pass an array to the `sz` prop to compose multiple sz objects with conditional items.
Static items are pre-computed at build time; conditional items use `_szMerge` at runtime:

```tsx
<div
  sz={[
    { flex: true, items: "center", p: 4 }, // always — extracted at build time
    isActive && { bg: "blue-500" }, // runtime conditional
    isDisabled && { opacity: 50, cursor: "not-allowed" },
  ]}
/>
```

## Reusing Styles

CSSzyx resolves style variables at build time — same output as inline objects, zero runtime.

```tsx
const card = { p: 6, rounded: 'xl', shadow: 'md' } as const;

sz={card}                          // direct — no override needed
sz={{ ...card, p: 4 }}             // spread — override p, keep rest
sz={[card, isActive && { bg: 'blue-50' }]}  // array — conditional composition
sz={on ? activeStyle : inactiveStyle}        // ternary — both branches resolved
sz={{ scale: shrunk ? 75 : 100 }}            // inline prop ternary — both literal values compiled at build time
```

**Rules:**

- Use `sz={var}` when no override needed (simpler)
- Use `sz={{ ...var, key: val }}` only when overriding/adding
- Variables in array elements, ternary branches, and chained initializers all resolve at build time
- `sz={{ key: cond ? a : b }}` — both literal branches compiled to static Tailwind classes; CSS variable fallback only when a branch is a runtime expression
- `sz={{ ...(cond ? a : b), static: val }}` — conditional spread hoist: compiler resolves both branches at build time
- Imported variables / function call results fall back to `_sz()` runtime — dev mode emits a build-time compiler warning explaining the fallback reason and suggesting `szv()` or `dynamic()`

Full guide: `/docs/reusing-styles`

## szv() — Variant Authoring

CVA-equivalent that returns sz objects. TypeScript infers valid keys/values from config — no
manual type annotations needed. Numeric variant keys are supported.

```tsx
import { szv } from "csszyx";

const buttonSz = szv({
  base: {
    inlineFlex: true,
    items: "center",
    rounded: "md",
    fontWeight: "medium",
  },
  variants: {
    variant: {
      default: { bg: "primary", text: "primary-foreground" },
      outline: { border: true, borderColor: "blue-500", bg: "transparent" },
      ghost: { hover: { bg: "accent" } },
    },
    size: {
      sm: { h: 9, px: 3, text: "sm" },
      md: { h: 10, px: 4 },
      lg: { h: 11, px: 8 },
    },
  },
  defaultVariants: { variant: "default", size: "md" },
});

<button sz={buttonSz({ variant: "outline", size: "sm" })} />;

// Numeric keys — e.g. index-based opacity variants
const itemSz = szv({
  base: { rounded: "sm", shrink: 0 },
  variants: {
    idx: { 0: { opacity: 50 }, 1: { opacity: 70 }, 2: { opacity: 90 } },
  },
  defaultVariants: { idx: 0 },
});
<div sz={itemSz({ idx: 1 })} />; // → "rounded-sm shrink-0 opacity-70"

// TypeScript catches invalid values:
buttonSz({ variant: "invalid" }); // ❌ TS error: '"invalid"' not assignable
```

All variant class combinations are catalogued at build time (compiler prescan) — Tailwind
generates CSS for every combination, no runtime injection needed.

## @csszyx/dynamic — Runtime CSS Injection

For styles from JSON / API / CMS / form renderer schemas:

```tsx
import { dynamic, preloadManifest } from "@csszyx/dynamic";
// or: import { dynamic } from 'csszyx/dynamic';

// Optional: preload at app startup for zero-latency first inject
await preloadManifest("/csszyx-manifest.json");

// Apply runtime sz object — CSS injected only for missing classes
const cls = dynamic({
  p: 4,
  bg: "white",
  hover: { bg: "gray-50" },
  dark: { bg: "gray-900" },
});
```

**Build-time extraction (Layer-1 prescan):** When `dynamic()` receives a static literal or
module-level const, the compiler extracts classes at build time → Tailwind generates CSS
ahead of time → no runtime injection needed. Works in Astro SSR without `client:*`.

```tsx
const boxStyles = { w: 7, h: 8, rounded: "sm" } as const;
<div className={dynamic(boxStyles)} />; // CSS pre-generated, zero runtime inject
```

### React hook

```tsx
import { useSz } from "@csszyx/dynamic/react";
// or: import { useSz } from 'csszyx/dynamic/react';

function DynamicCard({ style }) {
  const { sz } = useSz();
  return <div className={sz(style)} />;
}
```

Delta injection: CSS is injected only for classes not already in the pre-built stylesheet.
SSR-safe: on the server, returns class names without CSSOM access.

## Runtime Helpers

For dynamic classes at runtime (the only runtime overhead):

```tsx
import { _sz, _szIf, _szSwitch, _szMerge } from '@csszyx/runtime';

// Concatenate class strings
<div className={_sz('base-class', conditionalClass)} />

// Conditional class
<div className={_szIf(isActive, 'active-class', 'inactive-class')} />

// Switch/enum
<div className={_szSwitch(status, {
  loading: 'opacity-50',
  error: 'border-red-500',
  success: 'border-green-500',
})} />

// Merge (last wins for conflicts)
<div className={_szMerge(baseClasses, overrideClasses)} />
```

For color CSS variables:

```tsx
import { __szColorVar } from "csszyx/lite";
// Usage: __szColorVar('--ds-primary') → 'var(--ds-primary)'
//        __szColorVar('blue-500')      → 'var(--color-blue-500)'
//        __szColorVar('#ff0000')       → '#ff0000'
```

## SSR Hydration

CSSzyx validates that server and client use the same mangle map:

```tsx
// Server (Next.js app/layout.tsx)
import { initRuntime } from "@csszyx/runtime";
import { headers } from "next/headers";

const hdrs = await headers();
initRuntime({ checksum: hdrs.get("x-csszyx-checksum") ?? "" });
```

If the checksum mismatches, the runtime aborts hydration to prevent CSS corruption.

### szRecover — per-element recovery opt-in

By default a hydration mismatch aborts the entire page. For specific
subtrees where re-rendering on the client is cheaper than aborting,
opt in per-element with the `szRecover` JSX attribute:

```tsx
<section szRecover="csr">
  {/* mismatch in this subtree triggers a client re-render instead of abort */}
  <UserGeneratedContent />
</section>

<aside szRecover="dev-only">
  {/* same, but only in development; stripped from prod manifest */}
  <DebugPanel />
</aside>
```

The build emits a `data-sz-recovery-token` attribute on each element
plus a `<script id="__SZ_RECOVERY_MANIFEST__">` JSON tag in `<head>`.
The runtime's `verifyRecoveryToken` matches the two at hydration time.

`szRecover` is typed on `React.HTMLAttributes` via `@csszyx/types/jsx` —
no tsconfig change needed.

## Production Build (Mangling)

In production, class names are mangled for maximum compression:

```js
// vite.config.ts (production)
...csszyx({ production: { mangle: true } })
```

Output: `<div class="z y x" />` — the CSS `.z { padding: 1rem }` etc. is injected automatically.

### AST budget guard

Files larger than 50 000 AST nodes throw `ASTBudgetExceededError` at
build time — pathologically large generated files (json-as-ts fixtures,
GraphQL schemas) would otherwise hang the build. Raise the cap when you
need:

```js
...csszyx({ build: { astBudgetLimit: 100_000 } })
```

Or exclude the file from csszyx processing entirely via the bundler's
`exclude` filter.

## Theme Auto-Scan (Custom Tokens → TypeScript Types)

When using Tailwind v4 `@theme` blocks for custom design tokens, enable `build.scanCss`
to generate `.csszyx/theme.d.ts` — surfaces custom tokens in `sz` prop IntelliSense:

```ts
// vite.config.ts
...csszyx({ build: { scanCss: 'src/index.css' } })
```

```css
/* src/index.css */
@theme {
  --color-brand-500: #6d28d9;
  --spacing-prose: 65ch;
}
```

After the build, add `.csszyx/theme.d.ts` to your `tsconfig.json` `"include"` array.
Result: `{ bg: 'brand-500' }` gets autocomplete and type-checking.

## Tailwind v4 Compatibility

- Requires `@tailwindcss/vite` or `@tailwindcss/postcss` v4.x
- `csszyx` Vite plugin MUST come before `tailwindcss` in plugins array
- All spacing values are dynamic (any integer, 0.5-step decimals work bare)
- Arbitrary values: `{ p: '5px' }` → `p-[5px]` (auto-wrapped)
- CSS variables: `{ p: '--my-var' }` → `p-(--my-var)` (auto-wrapped)

## Migrate CLI

Convert `className=` (JSX/TSX) or `class=` (HTML) to `sz=` props:

### Basic usage

```bash
npx csszyx migrate src/           # migrate all JSX/TSX/HTML under src/
npx csszyx migrate --dry-run      # preview changes without writing files
npx csszyx migrate --ignore "**/*.test.tsx,**/fixtures/**"
npx csszyx migrate --pattern "src/components/**/*.tsx"
```

Migration logs are written to `.csszyx/logs/`. Add `.csszyx/` to `.gitignore`.

### Audit — discover unrecognized classes

```bash
npx csszyx migrate --audit        # scan + write .csszyx-todo.json (no file edits)
```

`.csszyx-todo.json` is a snapshot map of every class csszyx couldn't recognize.
Each entry starts as `"sz:todo"` (not yet decided):

```json
{
  "btn": "sz:todo",
  "custom-card": "sz:todo"
}
```

### `.csszyx-todo.json` resolution routes

Edit the file to tell csszyx what to do with each class:

| Value                      | Meaning                                          |
| -------------------------- | ------------------------------------------------ |
| `"sz:todo"`                | Not yet decided — skip, surface in reports       |
| `"sz:keep"`                | Keep in `className`, acknowledged as intentional |
| `"sz:remove"`              | Drop from output entirely                        |
| `{ p: 4, bg: 'blue-500' }` | Direct sz object — merge into sz prop            |
| `"p-4 bg-blue-500"`        | Tailwind string — auto-converted to sz           |
| `null` / `false`           | Same as `"sz:todo"` (backwards compat)           |

`sz:todo` entries always skip conversion — they are never silently parsed, even if
the class happens to be a valid Tailwind class. This prevents accidental conversion
of classes the developer has explicitly flagged as "not yet decided."

### `--resolve-todos` — apply the resolution map

```bash
npx csszyx migrate --resolve-todos .csszyx-todo.json
```

Reads `.csszyx-todo.json` and applies it during migration.
`--resolve-todos` is **read-only**: it never writes to the todo file.
Still-unresolved classes appear in the console and log only.
Re-run `--audit` to get a fresh snapshot when ready.

### `--inject-todos` — mark unrecognized classes in code

```bash
npx csszyx migrate --inject-todos
```

Inserts `{/* @sz-todo: classname1, classname2 */}` above elements with unrecognized
classes — a visual marker so you can grep or skim the diff to find what still needs
attention. When `--resolve-todos` is active, `--inject-todos` is automatically enabled
for still-unresolved classes.

### Full workflow

```bash
# 1. Dry run to preview
npx csszyx migrate --dry-run

# 2. Audit to find unknowns
npx csszyx migrate --audit
# → writes .csszyx-todo.json

# 3. Edit .csszyx-todo.json
# → set "sz:keep", "sz:remove", or direct sz objects for each entry

# 4. Apply with resolution map
npx csszyx migrate --resolve-todos .csszyx-todo.json

# 5. Re-audit if anything remains unresolved
npx csszyx migrate --audit
```

### HTML files

Converts `class="..."` → `sz="..."`. FOUC prevention CSS is injected into
`<head>` by default. Runtime script injection is **opt-in** — without it,
`[sz]` elements stay hidden (FOUC CSS hides them until the runtime sets
`body.sz-ready`).

```bash
# CDN runtime (default URL: https://cdn.csszyx.com/runtime.js)
npx csszyx migrate public/ --inject-runtime cdn
# Local runtime (default path: csszyx-runtime.js)
npx csszyx migrate public/ --inject-runtime local
# Custom URLs
npx csszyx migrate public/ --inject-runtime cdn --cdn-url https://my-cdn.com/csszyx.js
npx csszyx migrate public/ --inject-runtime local --local-path ./vendor/csszyx-runtime.js
# Format and FOUC options
npx csszyx migrate public/ --braces    # sz="{ p: 4 }" instead of sz="p: 4"
npx csszyx migrate public/ --no-fouc  # skip FOUC prevention CSS injection
```
