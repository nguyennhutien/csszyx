# @csszyx/cli

> Command-line tools for CSSzyx.

Initialize projects, migrate Tailwind classNames to `sz`, diagnose configuration
and mangling issues, and maintain the Next.js Turbopack safelist.

## Installation

```bash
npm install -g @csszyx/cli
# or run via npx
npx csszyx <command>
```

## Commands

### `init`

Initialize CSSzyx in a new or existing project.

```bash
npx csszyx init
```

### `doctor`

Diagnose configuration and mangling issues.

```bash
npx csszyx doctor
```

### `check`

Scan the whole project for unknown or aliased `sz` keys, then ask your own
Tailwind whether every class csszyx emitted actually produces CSS — CI-friendly
(non-zero exit on findings).

```bash
npx csszyx check
```

The second pass loads the stylesheet that imports Tailwind, so your `@theme`
tokens, custom breakpoints and `@utility` definitions all count as real. That
catches the mistakes a key check cannot see: a canonical key whose value has no
utility behind it, or a breakpoint spelled `tablt:` instead of `tablet:`. Both
ship a class that sits in the DOM and styles nothing.

It needs Tailwind v4 resolvable from the project. Without it — no v4, no
stylesheet importing Tailwind — the pass reports why it was skipped and the key
check still runs. It never reports a class dead because it could not find the
design system.

### `explain`

Print the Tailwind className an sz object compiles to — quick one-off checks
without a build.

```bash
npx csszyx explain '{ p: 4, hover: { bg: "blue-500" } }'
# → p-4 hover:bg-blue-500
```

### `scan-collisions`

Find app-owned class names that could collide with a production mangle token
(short names like `x`, `y` in hand-written CSS of a hybrid Tailwind setup).
Feed the results to `production.mangleExclude`.

```bash
npx csszyx scan-collisions --pattern "src/**/*.css"
```

### `next-prebuild` / `next-watch`

Maintain the Tailwind `@source` safelist for the Next.js Turbopack dev path:
`next-prebuild` seeds it before `next build --turbopack`; `next-watch` runs
beside `next dev --turbo` and keeps it fresh as sources change.

```bash
npx csszyx next-prebuild
npx csszyx next-watch
```

### `audit`

View performance statistics and mangle compression rates.

```bash
npx csszyx audit
```

### `generate-types`

> **Not applicable for Tailwind v4 projects.**
>
> CSSzyx requires Tailwind v4, which replaces `tailwind.config.js` with `@theme {}` blocks
> in CSS. This command uses Tailwind v3's `resolveConfig()` API to parse JS config files —
> that API does not exist in v4.
>
> For v4 projects, use the plugin's `build.scanCss` option instead. See
> [Plugin Config docs](/docs/reference/config).
>
> This command is kept for potential future Tailwind v3 compatibility support.
> If your project needs it, open an issue.

```bash
npx csszyx generate-types
npx csszyx generate-types --config ./path/to/tailwind.config.js
npx csszyx generate-types --output ./src/csszyx.d.ts
```

### `migrate`

Convert Tailwind `className="..."` to CSSzyx `sz={...}` props. Phase 1 supports static string classNames.
Display utilities migrate to canonical `display` props (`flex` →
`{ display: 'flex' }`) instead of boolean sugar, and conflicting display
utilities in the same variant scope stay unresolved for manual review.

```bash
npx csszyx migrate src/
npx csszyx migrate --dry-run          # preview changes
npx csszyx migrate --ignore "*.test.*"  # skip test files
```

## License

MIT © [CSSzyx contributors](https://github.com/nguyennhutien/csszyx)
