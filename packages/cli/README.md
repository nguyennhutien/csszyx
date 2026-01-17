# @csszyx/cli

> Command-line tools for csszyx.

Review usage stats, diagnose issues, and initialize projects.

## Installation

```bash
npm install -g @csszyx/cli
# or run via npx
npx csszyx <command>
```

## Commands

### `init`

Initialize csszyx in a new or existing project.

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

Convert Tailwind `className="..."` to csszyx `sz={...}` props. Phase 1 supports static string classNames.

```bash
npx csszyx migrate src/
npx csszyx migrate --dry-run          # preview changes
npx csszyx migrate --ignore "*.test.*"  # skip test files
```

## License

MIT © [csszyx contributors](https://github.com/nguyennhutien/csszyx)
