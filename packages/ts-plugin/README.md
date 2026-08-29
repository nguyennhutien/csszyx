# `@csszyx/ts-plugin`

Bounded csszyx key and value completions for compatible TypeScript language-service
hosts. This package is a TypeScript project plugin, not a universal LSP and not a
replacement for the csszyx VS Code extension.

## Setup

```bash
pnpm add -D @csszyx/ts-plugin typescript
```

```jsonc
{
  "compilerOptions": {
    "plugins": [{ "name": "@csszyx/ts-plugin" }],
  },
}
```

Use the workspace TypeScript version, then restart the host's TypeScript service.
In a monorepo, configure the leaf `tsconfig` that owns the edited source file.

The supported peer range is TypeScript `>=5.9 <7`. Certification is versioned per
host and release; hosts decide whether project plugins are loaded. Absence of
csszyx entries does not imply an LSP or editor bug.

## Authoring experience

The plugin completes keys and curated values in JSX `sz`, nested variants,
`szv()` style objects, imported `szr()` objects, and inside each component
`szs` slot. Numeric suggestions are inserted without quotes; Tailwind 4 numbers
remain open-ended, so values such as `{ p: 13, w: 137 }` work even when they are
not listed in the dropdown.

```tsx
import { szv } from "csszyx";

const buttonSz = szv({
  base: { px: 4, rounded: "md" },
  variants: {
    tone: {
      primary: { bg: "blue-600", color: "white" },
      danger: { bg: "red-600", color: "white" },
    },
  },
});

const card = <Card szs={{ header: { bg: "gray-100", p: 4 } }} />;
```

The outer `szs` keys are slot names, so CSS suggestions begin inside a slot's
object. Generated theme values are available through the opt-in preview below;
hover, diagnostics, and syntax highlighting are not provided by this package.

### Generated theme values (preview)

Set `themeValues: true` and include `.csszyx/theme.d.ts` in the leaf TypeScript
project. The plugin adds its custom colors, spacings, fonts, text sizes, font
weights, radii, shadows, and breakpoints to the existing curated suggestions.

The plugin reads the declaration already present in TypeScript's current
Program. It does not read CSS, access the filesystem directly, create a watcher,
or execute Tailwind/config code. Missing, malformed, oversized, or stale
declarations leave the normal suggestions unchanged.

## Configuration

```jsonc
{
  "name": "@csszyx/ts-plugin",
  "enabled": true,
  "values": true,
  "themeValues": false,
  "maxEntries": 512,
  "deadlineMs": 20,
  "failureThreshold": 3,
}
```

Invalid values are replaced with bounded defaults. Repeated internal failures open
a per-project circuit breaker while leaving base TypeScript completions untouched;
changing plugin configuration resets it.

## Rollback

Remove the plugin entry and restart the TypeScript service. The plugin performs no
network access, telemetry, project-code execution, Tailwind-plugin execution, or
synchronous theme-file I/O.
