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

Generate TypeScript definitions from your `tailwind.config.js`.

```bash
npx csszyx generate-types
```

### `migrate`

Convert Tailwind `className="..."` to CSSzyx `sz={...}` props. Phase 1 supports static string classNames.

```bash
npx csszyx migrate src/
npx csszyx migrate --dry-run          # preview changes
npx csszyx migrate --ignore "*.test.*"  # skip test files
```

## License

MIT © [CSSzyx contributors](https://github.com/nguyennhutien/csszyx)
