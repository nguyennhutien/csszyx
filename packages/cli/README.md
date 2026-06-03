# @csszyx/cli

> Command-line tools for CSSzyx.

Review usage stats, diagnose issues, and initialize projects.

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
